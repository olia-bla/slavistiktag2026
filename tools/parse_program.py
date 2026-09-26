#!/usr/bin/env python3
"""Parse the Slavistiktag 2026 program PDF into data/program.json.

Strategy (verified against the actual PDF geometry):
- Every logical table cell is drawn as a filled rect (height > 20pt).
- Time labels are plain words in column 0 (no rect background).
- Room columns are identified from header words between the two top
  full-width horizontal rules.
- A program page is detected by its block header line
  ("<hh:mm-hh:mm> Sektionen und Panels ...") and a day header
  ("Vortragsprogramm <Tag>, DD. Monat" or "<Tag>, DD.MM.YYYY").

Usage:
    python tools/parse_program.py tools/source/<file>.pdf [-o data/program.json] [--debug]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import unicodedata
from collections import defaultdict
from datetime import datetime
from pathlib import Path

import pdfplumber

sys.stdout.reconfigure(encoding="utf-8")

# ---------------------------------------------------------------- constants

TIME_RE = re.compile(r"(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})")
TIME_ONLY_RE = re.compile(r"^\s*(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})\s*$")
ROOM_TOKEN_RE = re.compile(r"^(SR|HS|MMZ)$", re.I)
ROOM_FULL_RE = re.compile(r"^\s*(SR|HS|MMZ)\s*(\d{3}|\d)\s*$", re.I)
SEK_RE = re.compile(r"^\s*(SEK_[A-Z]+_\d+[ab]?)\b\s*(.*)$", re.S)
CHAIR_RE = re.compile(r"\[Chair:\s*([^\]]+)\]", re.I)
DAY_HEADER_RE = re.compile(
    r"Vortragsprogramm\s+(Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|Sonntag),?\s*(\d{1,2})\.\s*(\w+)", re.I)
DAY_SIDE_RE = re.compile(
    r"^\s*(Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|Sonntag),\s*(\d{1,2})\.(\d{2})\.(\d{4})\s*$", re.M)
BLOCK_RE = re.compile(
    r"(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})\s+Sektionen und Panels\s+(.+)", re.I)
BREAK_WORDS = ("kaffeepause", "mittagspause")
FOOTER_EVENT_RE = re.compile(
    r"^\s*(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})\s+(.*)$")

MONTHS = {
    "januar": 1, "februar": 2, "märz": 3, "maerz": 3, "april": 4, "mai": 5, "juni": 6,
    "juli": 7, "august": 8, "september": 9, "oktober": 10, "november": 11, "dezember": 12,
}

YEAR = 2026

MINOR_CONNECTIVES = {"und", "oder", "bzw", "a", "an", "auf", "aus", "bei", "da", "die", "das", "der", "du", "für", "in", "im", "mit", "nach", "von", "vor", "zu", "zum", "zur", "über"}


def warn(warnings: list, msg: str) -> None:
    warnings.append(msg)
    print(f"  [WARN] {msg}")


# ---------------------------------------------------------------- helpers

def hhmm(h: int, m: int) -> str:
    return f"{h:02d}:{m:02d}"


def norm_time_range(text: str) -> tuple[str, str] | None:
    m = TIME_ONLY_RE.match(text.strip())
    if not m:
        return None
    return hhmm(int(m.group(1)), int(m.group(2))), hhmm(int(m.group(3)), int(m.group(4)))


def norm_sek(code: str) -> str:
    m = re.match(r"^(SEK_[A-Z]+)_(\d+)([ab]?)$", code)
    if not m:
        return code
    return f"{m.group(1)}_{int(m.group(2)):02d}{m.group(3)}"


def dehyphenate(text: str) -> str:
    """Join soft-hyphenated line breaks inside cells."""
    lines = [ln.strip() for ln in text.splitlines()]
    out: list[str] = []
    for ln in lines:
        if not ln:
            continue
        if out and out[-1].endswith("-") and not out[-1].endswith(" -"):
            prev = out[-1]
            first = ln.split()[0] if ln.split() else ""
            core = prev[:-1]
            if first and first[0].isdigit():
                out[-1] = prev + first + (" " + " ".join(ln.split()[1:]) if len(ln.split()) > 1 else "")
                continue
            if first and first[0].islower() and first.lower() not in MINOR_CONNECTIVES:
                out[-1] = core + first + (" " + " ".join(ln.split()[1:]) if len(ln.split()) > 1 else "")
                continue
            if first and first[0].isupper():
                out[-1] = prev + first + (" " + " ".join(ln.split()[1:]) if len(ln.split()) > 1 else "")
                continue
        out.append(ln)
    return re.sub(r"\s+", " ", " ".join(out)).strip()


def clean_cell(text: str | None) -> str:
    return re.sub(r"[ \t]+", " ", (text or "")).strip()


def split_speaker_title(text: str) -> tuple[list[str], str] | None:
    """Split 'Speaker, Speaker: Title' on the first colon."""
    idx = text.find(":")
    if idx == -1:
        return None
    speakers_part, title = text[:idx].strip(), text[idx + 1:].strip()
    if not speakers_part or not title:
        return None
    # A title usually contains a space; a speaker list may not contain line ends.
    speakers = [s.strip() for s in speakers_part.split(",") if s.strip()]
    return speakers, title


def classify_track(block_text: str) -> str:
    t = block_text.lower()
    has_lkw = "literatur" in t
    has_did = "didaktik" in t
    has_sw = "sprachwissenschaft" in t
    parts = []
    if has_lkw:
        parts.append("LKW")
    if has_sw:
        parts.append("SW")
    if has_did:
        parts.append("DID")
    return "+".join(parts) if parts else "?"


# ---------------------------------------------------------------- page model

def full_width_hlines(page) -> list[float]:
    """Y positions of horizontal rules that span (in segments) the table width."""
    segs = defaultdict(list)
    for r in page.rects:
        if r["height"] <= 3:
            segs[round(r["top"])].append(r)
    ys = []
    for y, rs in segs.items():
        span = max(r["x1"] for r in rs) - min(r["x0"] for r in rs)
        if span > 400:
            ys.append(y)
    ys.sort()
    merged: list[float] = []
    for y in ys:
        if not merged or y - merged[-1] > 3:
            merged.append(y)
    return merged


class PageGrid:
    """Reconstructed table grid of one program page."""

    def __init__(self, page, warnings: list):
        self.warnings = warnings
        self.page = page
        hlines = full_width_hlines(page)
        self.header_top = hlines[0] if hlines else 0
        self.header_bottom = hlines[1] if len(hlines) > 1 else 0
        self.rooms: list[dict] = []  # {name, x0, x1}
        self.time_interval: tuple[float, float] = (0, 0)
        self.cells: list[dict] = []
        self.times: list[dict] = []  # {top, start, end}
        self._detect_rooms()
        if self.rooms and len(hlines) < 3:
            warn(warnings, f"page {page.page_number}: expected >=3 full-width rules, found {len(hlines)}")
        self._detect_times()
        self._collect_cells()
        self._detect_breaks()

    def _detect_breaks(self) -> None:
        """Break rows ('Kaffeepause', 'Mittagspause') are plain text lines at the
        bottom of the table, not rect cells."""
        self.break_text = None
        if not self.rooms:
            return
        words = [w for w in self.page.extract_words()
                 if w["top"] > self.header_bottom + 2 and w["top"] < (self.page.height or 10_000)]
        words.sort(key=lambda w: (w["top"], w["x0"]))
        lines: list[list] = []
        for w in words:
            if lines and w["top"] - lines[-1][-1]["top"] <= 5:
                lines[-1].append(w)
            else:
                lines.append([w])
        for ws in lines:
            text = " ".join(w["text"] for w in ws)
            if any(b in text.lower() for b in BREAK_WORDS):
                text = TIME_RE.sub("", text, count=1).strip()  # strip time prefix
                self.break_text = clean_cell(text)

    # -- header / columns -------------------------------------------------

    def _detect_rooms(self) -> None:
        """Column boundaries come from the PDF's vertical rules (header words are
        CENTERED inside their columns, so they cannot define boundaries)."""
        words = self.page.extract_words()
        # vertical rules: rects of width<=2 grouped by x, keep those with much total height
        vsegs = defaultdict(list)
        for r in self.page.rects:
            if r["width"] <= 2:
                vsegs[round(r["x0"] / 2) * 2].append(r)
        rule_xs = sorted(
            x for x, rs in vsegs.items()
            if sum(rr["height"] for rr in rs) > 80
        )
        merged_xs: list[float] = []
        for x in rule_xs:
            if not merged_xs or x - merged_xs[-1] > 4:
                merged_xs.append(x)
        if len(merged_xs) < 3:
            return
        # intervals between rules; wide intervals are columns
        intervals = [(merged_xs[i], merged_xs[i + 1]) for i in range(len(merged_xs) - 1)]
        intervals = [(a, b) for a, b in intervals if b - a > 40]
        if len(intervals) < 2:
            return
        self.time_interval = intervals[0]
        room_intervals = intervals[1:]
        # match header room words to intervals by word center
        band = [w for w in words
                if self.header_top - 1 <= w["top"] <= self.header_bottom + 2]
        i = 0
        headers: list[tuple[str, float, float]] = []
        while i < len(band):
            w = band[i]
            if ROOM_TOKEN_RE.match(w["text"]) and i + 1 < len(band) and band[i + 1]["text"].isdigit():
                headers.append((f"{w['text'].upper()} {band[i + 1]['text']}", w["x0"], band[i + 1]["x1"]))
                i += 2
                continue
            i += 1
        for (a, b) in room_intervals:
            center = (a + b) / 2
            match = next((h for h in headers if h[1] <= center <= h[2]), None)
            if match:
                self.rooms.append({"name": match[0], "x0": a, "x1": b})
            else:
                warn(self.warnings,
                     f"page {self.page.page_number}: column at x={round(a)}-{round(b)} has no room header")
        if len(self.rooms) != len(headers):
            warn(self.warnings,
                 f"page {self.page.page_number}: {len(headers)} room headers vs {len(self.rooms)} columns")

    # -- time labels ------------------------------------------------------

    def _detect_times(self) -> None:
        if not self.rooms:
            return
        a, b = self.time_interval
        words = self.page.extract_words()
        zone = [w for w in words if a <= w["x0"] < b and w["top"] > self.header_bottom + 2]
        buf = []
        for w in zone:
            buf.append(w["text"])
            joined = " ".join(buf)
            m = TIME_RE.search(joined)
            if m:
                self.times.append({
                    "top": w["top"],
                    "start": hhmm(int(m.group(1)), int(m.group(2))),
                    "end": hhmm(int(m.group(3)), int(m.group(4))),
                })
                buf = []
        if not self.times:
            warn(self.warnings, f"page {self.page.page_number}: no time labels found")

    # -- cells ------------------------------------------------------------

    def _collect_cells(self) -> None:
        rects = [r for r in self.page.rects
                 if r["height"] > 8 and r["width"] > 15
                 and r["top"] > self.header_bottom - 2]
        if not self.rooms:
            return
        hl = full_width_hlines(self.page)
        cutoff = hl[-1] if hl else None  # table + footer boxes end at last full-width rule
        # text per rect, then drop rects contained in a larger one (line-level dupes)
        cand = []
        for r in rects:
            if cutoff is not None and r["top"] > cutoff:
                continue  # side-tab legend etc.
            if (r["x1"] - r["x0"]) < 4 or (r["bottom"] - r["top"]) < 4:
                continue  # degenerate line rects
            cx = (r["x0"] + r["x1"]) / 2
            if self.time_interval[0] <= cx < self.time_interval[1]:
                continue  # time column (incl. footer event time labels)
            crop = self.page.crop((r["x0"] + 1, r["top"] + 1, r["x1"] - 1, r["bottom"] - 1))
            text = dehyphenate(clean_cell(crop.extract_text()))
            if not text:
                continue
            cand.append({"rect": r, "text": text})
        cand.sort(key=lambda c: c["rect"]["width"] * c["rect"]["height"], reverse=True)
        kept: list[dict] = []
        for c in cand:
            r = c["rect"]
            contained = any(
                k["rect"]["x0"] - 2 <= r["x0"] and r["x1"] <= k["rect"]["x1"] + 2
                and k["rect"]["top"] - 2 <= r["top"] and r["bottom"] <= k["rect"]["bottom"] + 2
                and k["rect"]["width"] * k["rect"]["height"] > r["width"] * r["height"]
                for k in kept)
            if not contained:
                kept.append(c)
        for c in kept:
            r, text = c["rect"], c["text"]
            cx = (r["x0"] + r["x1"]) / 2
            col = next((j for j, room in enumerate(self.rooms)
                        if room["x0"] <= cx < room["x1"]), None)
            if col is None:
                warn(self.warnings,
                     f"page {self.page.page_number}: cell at x={round(r['x0'])} y={round(r['top'])} "
                     f"not in any column: {text[:60]!r}")
                continue
            t = self.time_for(r["top"])
            if r["width"] > 300:
                kind = "footer"
                # footer time labels sit INSIDE the event cell, not above it
                t = next((x for x in self.times
                          if r["top"] - 2 <= x["top"] <= r["bottom"] + 2), None)
            else:
                kind = "panel" if t is None else "talk"
            self.cells.append({"col": col, "top": r["top"], "bottom": r["bottom"],
                               "text": text, "kind": kind, "room": self.rooms[col]["name"],
                               "time": t if kind in ("talk", "footer") else None})

    def time_for(self, top: float) -> dict | None:
        cand = [t for t in self.times if t["top"] <= top + 3]
        return cand[-1] if cand else None


# ---------------------------------------------------------------- parsing

def parse_program_page(page, warnings: list) -> dict | None:
    """Return {'day': ..., 'block': ..., 'track': ..., 'grid': PageGrid} or None."""
    text = page.extract_text() or ""
    dm = DAY_HEADER_RE.search(text)
    sm = DAY_SIDE_RE.search(text)
    bm = BLOCK_RE.search(text)
    if not bm:
        return None
    if dm:
        month = MONTHS.get(dm.group(3).lower().replace("ä", "ä"))
        day_date = f"{YEAR}-{month:02d}-{int(dm.group(2)):02d}" if month else None
        day_label = f"{dm.group(1)}, {int(dm.group(2)):02d}.{month:02d}."
    elif sm:
        day_date = f"{sm.group(4)}-{sm.group(3)}-{int(sm.group(2)):02d}"
        day_label = f"{sm.group(1)}, {int(sm.group(2)):02d}.{sm.group(3)}."
    else:
        return None  # block header without day header (e.g. table of contents)
    tr = norm_time_range(bm.group(1) + "-" + bm.group(2))
    grid = PageGrid(page, warnings)
    if not grid.rooms or not grid.times:
        return None  # looks like TOC or non-table page
    return {
        "day": day_date,
        "day_label": day_label,
        "block": {"start": tr[0], "end": tr[1]} if tr else None,
        "track": classify_track(bm.group(3)),
        "grid": grid,
    }


def parse_panel_cell(text: str) -> dict:
    chair = None
    cm = CHAIR_RE.search(text)
    if cm:
        chair = clean_cell(cm.group(1))
        text = (text[:cm.start()] + text[cm.end():]).strip()
    cont = False
    if re.search(r"[<\[]\s*Fortsetzung\s*[>\]]", text, re.I):
        cont = True
        text = re.sub(r"[<\[]\s*Fortsetzung\s*[>\]]", "", text, flags=re.I).strip()
    sek = None
    sm = SEK_RE.match(text)
    if sm:
        sek = norm_sek(sm.group(1))
        text = sm.group(2).strip()
    title = re.sub(r"^(Panel|Sektion)\b[\s:]*", "", text, flags=re.I).strip(" :")
    return {"code": sek, "title": title, "chair": chair, "continued": cont}


def parse_talk_cell(text: str, warnings: list, ctx: str) -> dict | None:
    st = split_speaker_title(text)
    if st is None:
        warn(warnings, f"{ctx}: cannot split speaker/title: {text[:70]!r}")
        return None
    speakers, title = st
    return {"speakers": speakers, "title": title}


def group_key(pp: dict) -> tuple:
    return (pp["day"], pp["block"]["start"] if pp["block"] else None, pp["track"])


def parse_pdf(pdf_path: Path, debug: bool = False) -> dict:
    warnings: list[str] = []
    meta_stats = defaultdict(int)
    blocks: dict[tuple, dict] = {}
    footer_events: list[dict] = []
    seen_footer: set[tuple] = set()

    with pdfplumber.open(pdf_path) as pdf:
        n_pages = len(pdf.pages)
        for page in pdf.pages:
            pp = parse_program_page(page, warnings)
            if pp is None:
                continue
            key = group_key(pp)
            blk = blocks.setdefault(key, {
                "day": pp["day"], "day_label": pp["day_label"],
                "start": pp["block"]["start"], "end": pp["block"]["end"],
                "track": pp["track"], "columns": {}, "pages": [],
            })
            blk["pages"].append(page.page_number)
            grid: PageGrid = pp["grid"]
            # columns keyed by ROOM NAME so pages of the same block with
            # different room sets merge cleanly
            for cell in grid.cells:
                col = cell["col"]
                room = cell["room"]
                if room in blk["columns"] and page.page_number != blk["columns"][room]["page"]:
                    warn(warnings, f"p{page.page_number}: room {room} appears twice in block "
                                   f"{blk['day']} {blk['start']}")
                entry = blk["columns"].setdefault(room, {"room": room, "page": page.page_number,
                                                         "panel": None, "talks": []})
                if cell["kind"] == "panel":
                    entry["panel"] = parse_panel_cell(cell["text"])
                elif cell["kind"] == "talk":
                    talk = parse_talk_cell(
                        cell["text"], warnings,
                        f"p{page.page_number} {blk['day']} {blk['start']} {room}")
                    if talk:
                        entry["talks"].append({
                            "talk": talk,
                            "start": cell["time"]["start"] if cell.get("time") else None,
                            "end": cell["time"]["end"] if cell.get("time") else None,
                        })
                elif cell["kind"] == "footer":
                    parts = re.split(r"(?=Podiumsdiskussion\s*:)", cell["text"])
                    for part in (clean_cell(p) for p in parts):
                        if not part:
                            continue
                        fkey = (pp["day"], part[:60])
                        if fkey in seen_footer:
                            continue
                        seen_footer.add(fkey)
                        footer_events.append({
                            "day": pp["day"],
                            "start": cell["time"]["start"] if cell.get("time") else None,
                            "end": cell["time"]["end"] if cell.get("time") else None,
                            "title": part,
                        })
            if grid.break_text:
                blk.setdefault("break_cell", grid.break_text)
            meta_stats["program_pages"] += 1

    # assemble sessions
    sessions, panels_out = [], {}
    for key, blk in sorted(blocks.items(), key=lambda kv: (kv[0][0] or "", kv[0][1] or "")):
        for col_idx, col in sorted(blk["columns"].items()):
            panel = col["panel"] or {}
            panel_key = panel.get("code") or (panel.get("title") or "").lower() or f"col-{col_idx}"
            pid = f"{blk['day']}|{blk['start']}|{panel_key}"
            panels_out[pid] = {
                "id": pid, "day": blk["day"], "block_start": blk["start"],
                "code": panel.get("code"), "title": panel.get("title"),
                "chair": panel.get("chair"), "room": col["room"], "track": blk["track"],
            }
            for item in col["talks"]:
                talk = item["talk"]
                sessions.append({
                    "id": f"{blk['day']}-{blk['start']}-{col['room'].replace(' ', '')}-{item['start']}",
                    "day": blk["day"], "start": item["start"], "end": item["end"],
                    "room": col["room"], "track": blk["track"],
                    "panel_id": pid, "speakers": talk["speakers"], "title": talk["title"],
                    "type": "talk",
                })

    # corrected block ends (the PDF mislabels 14:00-blocks as "14:00-14:30"):
    # assign each session to its block (latest block start <= session start)
    block_starts: dict[str, list[str]] = defaultdict(list)
    for b in blocks.values():
        block_starts[b["day"]].append(b["start"])
    for day in block_starts:
        block_starts[day] = sorted(set(block_starts[day]))
    block_max_end: dict[tuple, str] = {}
    for s in sessions:
        if not (s["start"] and s["end"] and s["day"]):
            continue
        starts = [x for x in block_starts.get(s["day"], []) if x <= s["start"]]
        if not starts:
            continue
        k = (s["day"], starts[-1])
        if k not in block_max_end or s["end"] > block_max_end[k]:
            block_max_end[k] = s["end"]

    # breaks in the gaps between blocks (text from the PDF's break rows)
    break_sessions: list[dict] = []
    by_day: dict[str, list[dict]] = defaultdict(list)
    for b in blocks.values():
        by_day[b["day"]].append(b)
    for day, blks in by_day.items():
        blks.sort(key=lambda b: b["start"])
        pairs = list(zip(blks, blks[1:]))
        if blks:
            # gap after the last block: anchored on the day's first footer event
            last = blks[-1]
            klast = (day, last["start"])
            if last.get("break_cell") and klast in block_max_end:
                nxt = [e["start"] for e in footer_events
                       if e["day"] == day and e["start"] and e["start"] > block_max_end[klast]]
                if nxt:
                    pairs.append((last, {"start": min(nxt)}))
        for b1, b2 in pairs:
            text = b1.get("break_cell")
            if text and (day, b1["start"]) in block_max_end and b2["start"] > block_max_end[(day, b1["start"])]:
                break_sessions.append({
                    "id": f"{day}-break-{b2['start']}",
                    "day": day, "start": block_max_end[(day, b1["start"])], "end": b2["start"],
                    "room": None, "track": None, "panel_id": None,
                    "speakers": [], "title": text, "type": "break",
                })

    result = {
        "meta": {
            "source_file": pdf_path.name,
            "source_sha256": hashlib.sha256(pdf_path.read_bytes()).hexdigest(),
            "generated_at": datetime.now().isoformat(timespec="seconds"),
            "pages": n_pages,
            "program_pages": meta_stats["program_pages"],
            "stats": {
                "sessions": len(sessions),
                "breaks": len(break_sessions),
                "panels": len(panels_out),
                "footer_events": len(footer_events),
            },
            "warnings": warnings,
        },
        "blocks": [
            {"day": b["day"], "day_label": b["day_label"],
             "start": b["start"],
             "end": max(b["end"], block_max_end.get((b["day"], b["start"]), b["end"])),
             "track": b["track"], "pages": b["pages"],
             "rooms": [c["room"] for c in b["columns"].values()]}
            for b in sorted(blocks.values(), key=lambda b: (b["day"] or "", b["start"]))
        ],
        "panels": sorted(panels_out.values(), key=lambda p: (p["day"] or "", p["block_start"] or "", p["code"] or "")),
        "sessions": sessions + break_sessions,
        "events": footer_events,
    }
    return result


def _t(s: str) -> tuple[int, int]:
    h, m = s.split(":")
    return int(h), int(m)


# ---------------------------------------------------------------- validation

def validate(data: dict) -> list[str]:
    problems = []
    s = data["meta"]["stats"]
    if s["sessions"] < 150:
        problems.append(f"only {s['sessions']} sessions parsed (expected ~200+)")
    if data["meta"]["program_pages"] < 20:
        problems.append(f"only {data['meta']['program_pages']} program pages detected (expected ~22)")
    missing_day = [b for b in data["blocks"] if not b["day"]]
    if missing_day:
        problems.append(f"{len(missing_day)} blocks without day")
    no_time = [x for x in data["sessions"] if not x["start"]]
    if no_time:
        problems.append(f"{len(no_time)} sessions without time, e.g. {no_time[0]['title'][:50]!r}")
    for x in data["sessions"]:
        if x.get("type") == "break":
            continue
        if not x["speakers"] or not x["title"]:
            problems.append(f"session {x['id']}: missing speaker/title")
    days = {b["day"] for b in data["blocks"]}
    if len(days) != 3:
        problems.append(f"expected 3 program days, found {len(days)}: {sorted(days)}")
    return problems


# ---------------------------------------------------------------- main

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("pdf", type=Path)
    ap.add_argument("-o", "--out", type=Path, default=Path("data/program.json"))
    ap.add_argument("--debug", action="store_true")
    args = ap.parse_args()

    data = parse_pdf(args.pdf, debug=args.debug)
    problems = validate(data)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\nwrote {args.out} ({args.out.stat().st_size} bytes)")
    print(f"stats: {data['meta']['stats']}")
    print(f"warnings: {len(data['meta']['warnings'])}")
    for w in data["meta"]["warnings"][:40]:
        print("  -", w)
    if problems:
        print("\nVALIDATION PROBLEMS:")
        for p in problems:
            print("  !", p)
        return 1
    print("\nVALIDATION OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
