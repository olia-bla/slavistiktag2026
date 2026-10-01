#!/usr/bin/env python3
"""Lädt das Programm des Slavistiktags 2026 aus ConfTool und schreibt data/program.json.

Quelle ist die öffentliche ConfTool-Pro-Instanz der Tagung
(https://www.conftool.com/slavistiktag2026/). Pro Tag wird die
Tabellenansicht gelesen (Sitzungen pro Zeitslot, Räume, Pausen,
besondere Formate), je Sitzung die Detailseite mit Präsentationen,
Abstracts und Zugehörigkeiten.

Schema entspricht dem bisherigen data/program.json (meta/blocks/panels/
sessions/events), zusätzlich pro Vortrag: abstract + affiliations.
Sektions-Codes (SEK_*), die ConfTool nicht führt, werden aus der bisherigen
program.json per Titel-Matching übernommen.

Usage:
    python tools/fetch_conftool.py -o data/program.json [--codes data/program.json]
    python tools/fetch_conftool.py -o /tmp/p.json --compare data/program.json   # Exit 1 = geändert
    python tools/fetch_conftool.py -o /tmp/p.json --changes /tmp/c.json --history data/changes.json
"""
from __future__ import annotations

import argparse
import difflib
import hashlib
import html as htmlmod
import json
import re
import sys
import time
import urllib.request
from collections import defaultdict
from pathlib import Path
from datetime import date, datetime, timezone

BASE = "https://www.conftool.com/slavistiktag2026/index.php"
DAYS = ["2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03"]
UA = ("Mozilla/5.0 (compatible; slavistiktag2026/1.0; "
      "Programm-Sync; +https://github.com/)")

# Zellen-Hintergrundfarben der Tabellenansicht → Track (aus dem Tagungs-PDF verifiziert:
# b2b3cb/d5f0f8 = SW+DID-Blöcke, e6e6fa/f8b773/fad3a2 = LKW, e0ffdd = besondere Formate)
COLOR_TRACK = {
    "#b2b3cb": "SW+DID",
    "#d5f0f8": "SW+DID",
    "#e6e6fa": "LKW",
    "#f8b773": "LKW",
    "#fad3a2": "LKW",
}
COLOR_SPECIAL = {"#e0ffdd", "#e0f8ff"}

# App-only editorial order for a jointly authored talk. ConfTool is read-only;
# keep this ordering through later imports without reporting it as a new change.
APP_FIRST_AUTHORS = {"342": "Chingiz Poletaev"}

WEEKDAYS = {"Montag": 0, "Dienstag": 1, "Mittwoch": 2, "Donnerstag": 3,
            "Freitag": 4, "Samstag": 5, "Sonntag": 6}

sys.stdout.reconfigure(encoding="utf-8")


def warn(warnings: list, msg: str) -> None:
    warnings.append(msg)
    print(f"  [WARN] {msg}")


# ---------------------------------------------------------------- fetch

def fetch(url: str, retries: int = 4) -> str:
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=60) as res:
                return res.read().decode("utf-8", errors="replace")
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"fetch fehlgeschlagen nach {retries} Versuchen: {url}: {last}")


# ---------------------------------------------------------------- html helpers

def strip_tags(s: str) -> str:
    s = re.sub(r"<sup[^>]*>.*?</sup>", "", s, flags=re.S)
    s = re.sub(r"<br\s*/?>", "\n", s, flags=re.I)
    s = re.sub(r"<[^>]+>", " ", s)
    s = htmlmod.unescape(s)
    s = s.replace("\u00a0", " ")
    return re.sub(r"[ \t]+", " ", s)


def one_line(s: str) -> str:
    return re.sub(r"\s+", " ", strip_tags(s)).strip()


# ---------------------------------------------------------------- day table

def parse_day_page(page: str, day: str, warnings: list) -> dict:
    """→ {sessions: {sid: {...}}, breaks: [...], specials: [...], rooms: {rid: name}}"""
    rooms: dict[str, str] = {}
    for rid, name in re.findall(r"form_room=(\d+)[^>]*>\s*([^<]+?)\s*</a>", page):
        name = re.sub(r"\*$", "", htmlmod.unescape(name)).strip()
        rooms.setdefault(rid, name)

    sessions: dict[str, dict] = {}
    breaks: list[dict] = []
    specials: list[dict] = []
    slot: tuple[str, str] | None = None

    for row in re.split(r"<tr", page):
        if "<th" in row:
            times = re.findall(r"\d{1,2}:\d{2}", row)
            if len(times) >= 2:
                slot = (norm_hm(times[0]), norm_hm(times[-1]))
        if slot is None:
            continue
        # Pausen: Zelle über die volle Breite (colspan); Sonderformate ebenfalls,
        # aber nur Pausen werden als break geführt, der Rest als Event
        if re.search(r"colspan=\d{2,}", row):
            m = re.search(r"<b>([^<]+)</b>", row)
            title = one_line(m.group(1)) if m else one_line(row)[:80]
            rm = re.search(r"form_room=(\d+)", row)
            room = rooms.get(rm.group(1)) if rm else None
            if re.search(r"kaffeepause|mittagspause|pause", title, re.I):
                breaks.append({
                    "day": day, "start": slot[0], "end": slot[1],
                    "room": room, "title": title,
                })
            else:
                text = one_line(row)
                parts = re.split(r"\sOrt:\s", text, maxsplit=1)
                note = parts[1] if len(parts) > 1 else None
                if note and room:
                    note = re.sub(r"^" + re.escape(room) + r"\s*", "", note).strip() or None
                specials.append({
                    "day": day, "start": slot[0], "end": slot[1],
                    "room": room, "title": title, "note": note,
                })
            continue
        # Sitzungszellen (mit Farbklassifikation)
        for m in re.finditer(
                r"<td[^>]*style=\"background:(#[0-9a-fA-F]{6})[^>]*>(.*?)</td>", row, re.S):
            color, body = m.group(1).lower(), m.group(2)
            sm = re.search(r"form_session=(\d+)", body)
            if sm:
                sid = sm.group(1)
                rm = re.search(r"form_room=(\d+)", body)
                sessions[sid] = {
                    "color": color,
                    "room": rooms.get(rm.group(1)) if rm else None,
                    "slot": slot,
                }
            elif color in COLOR_SPECIAL:
                # besondere Formate ohne Sitzungs-Link: Titel vor "Ort:", Rest als Notiz
                text = one_line(body)
                parts = re.split(r"\sOrt:\s", text, maxsplit=1)
                title = parts[0].strip()
                rest = parts[1] if len(parts) > 1 else ""
                room = None
                rm = re.search(r"form_room=(\d+)", body)
                if rm:
                    room = rooms.get(rm.group(1))
                if rest:
                    rest = re.sub(r"^" + re.escape(room or "") + r"\s*", "", rest).strip()
                specials.append({
                    "day": day, "start": slot[0], "end": slot[1],
                    "room": room, "title": title, "note": rest or None,
                })
    if not sessions and not specials:
        warn(warnings, f"Tag {day}: keine Sitzungen gefunden")
    return {"sessions": sessions, "breaks": breaks, "specials": specials, "rooms": rooms}


def norm_hm(t: str) -> str:
    h, m = t.split(":")
    return f"{int(h):02d}:{int(m):02d}"


# ---------------------------------------------------------------- session detail

def parse_detail(page: str, sid: str, warnings: list) -> dict | None:
    title = None
    m = re.search(r"class='font11'><b>(.*?)</b>", page, re.S)
    if m:
        title = one_line(m.group(1))
    if not title:
        warn(warnings, f"Sitzung {sid}: Titel nicht gefunden")
        return None

    zi = page.find("Zeit: ")
    dm = None
    if zi >= 0:
        win = page[zi:zi + 400]
        d1 = re.search(r"(\d{2})\.(\d{2})\.(\d{4})", win)
        d2 = re.search(r"(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})", win)
        if d1 and d2:
            dm = d1, d2
    if not dm:
        warn(warnings, f"Sitzung {sid}: Datum/Zeit nicht gefunden")
        return None
    d1, d2 = dm
    day = f"{d1.group(3)}-{int(d1.group(2)):02d}-{int(d1.group(1)):02d}"
    start, end = norm_hm(d2.group(1)), norm_hm(d2.group(2))

    chairs: list[str] = []
    header = page[page.find("Sitzung"):page.find("Präsentationen")] if "Präsentationen" in page else page
    for cm in re.finditer(r"Chair der Sitzung:\s*</i>.*?<b>(.*?)</b>", header, re.S):
        chairs.append(one_line(cm.group(1)))

    room = None
    rm = re.search(r"Ort:\s*</i>.*?<b>(.*?)</b>", header, re.S)
    if rm:
        room = re.sub(r"\*$", "", one_line(rm.group(1)))

    papers = []
    chunks = re.split(r"<div id='paperID(\d+)'>", page)
    for i in range(1, len(chunks), 2):
        pid, chunk = chunks[i], chunks[i + 1]
        pm = re.search(r"paper_time_value.[^>]*>\s*(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})", chunk)
        tm = re.search(r"paper_title[\"'][^>]*>(.*?)</p>", chunk, re.S)
        am = re.search(r"paper_author[\"'][^>]*>(.*?)</p>", chunk, re.S)
        om = re.search(r"paper_organisation[\"'][^>]*>(.*?)</p>", chunk, re.S)
        if not tm:
            warn(warnings, f"Sitzung {sid}, paper {pid}: Titel fehlt")
            continue
        authors: list[str] = []
        affis: list[str | None] = []
        if am:
            # Autoren + ihre Affiliations-Nummern: '<u>Name</u><sup>1,5</sup>, Name2<sup>2</sup>'.
            # Kommas innerhalb von <sup>…</sup> (Affiliations-Listen) dürfen nicht
            # splitten → Sup-Inhalte vorher durch Platzhalter schützen.
            sups: list[str] = []

            def _keep(m: re.Match) -> str:
                sups.append(m.group(1))
                return f"\x00{len(sups) - 1}\x00"

            protected = re.sub(r"<sup>(.*?)</sup>", _keep, am.group(1), flags=re.S)
            for part in protected.split(","):
                part = re.sub(r"\x00(\d+)\x00",
                              lambda m: f"<sup>{sups[int(m.group(1))]}</sup>", part).strip()
                if not part:
                    continue
                nums_m = re.search(r"<sup>([^<]+)</sup>", part)
                name = one_line(re.sub(r"<sup>.*?</sup>", "", part))
                nums = [int(n) for n in re.findall(r"\d+", nums_m.group(1))] if nums_m else []
                authors.append(name)
                affis.append(nums)
        orgs: dict[int, str] = {}
        unnumbered: list[str] = []
        if om:
            org_text = htmlmod.unescape(re.sub(r"<[^>]+>", "", om.group(1))).replace("\u00a0", " ")
            for part in org_text.split(";"):
                part = part.strip()
                nm = re.match(r"^(\d+):\s*(.+)$", part)
                if nm:
                    orgs[int(nm.group(1))] = nm.group(2).strip()
                elif part:
                    unnumbered.append(part)
        affiliations: list[str | None] = []
        for nums in affis:
            got = [orgs[n] for n in nums if n in orgs]
            if not got and unnumbered:
                got = unnumbered
            affiliations.append(" · ".join(got) if got else None)
        abstract = "\n\n".join(
            one_line(a) for a in re.findall(r"paper_abstract[\"'][^>]*>(.*?)</p>", chunk, re.S))
        papers.append({
            "pid": pid,
            "start": norm_hm(pm.group(1)) if pm else None,
            "end": norm_hm(pm.group(2)) if pm else None,
            "title": one_line(tm.group(1)),
            "speakers": authors,
            "affiliations": affiliations if any(affiliations) else None,
            "abstract": abstract or None,
        })
    if not papers:
        warn(warnings, f"Sitzung {sid}: keine Präsentationen")
    return {"title": title, "day": day, "start": start, "end": end,
            "room": room, "chairs": chairs, "papers": papers}


# ---------------------------------------------------------------- SEK-Codes

def load_code_map(path: str | None) -> dict[str, str]:
    if not path:
        return {}
    try:
        old = json.load(open(path, encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    out = {}
    for p in old.get("panels", []):
        if p.get("code") and p.get("title"):
            out[p["title"].strip().lower()] = p["code"]
    return out


def match_code(title: str, code_map: dict[str, str], warnings: list, ctx: str) -> str | None:
    if not code_map:
        return None
    key = title.strip().lower()
    if key in code_map:
        return code_map[key]
    hits = difflib.get_close_matches(key, code_map, n=1, cutoff=0.8)
    if hits:
        return code_map[hits[0]]
    return None


# ---------------------------------------------------------------- build

def hhmm(s: str) -> str:
    return s


def build(days_data: dict, details: dict, code_map: dict, warnings: list) -> dict:
    panels_out: dict[str, dict] = {}
    sessions: list[dict] = []
    breaks: list[dict] = []
    events: list[dict] = []
    block_rooms: dict[tuple, set] = defaultdict(set)
    block_span: dict[tuple, list] = defaultdict(list)

    for day in DAYS:
        dd = days_data.get(day)
        if not dd:
            continue
        for br in dd["breaks"]:
            breaks.append({
                "id": f"{day}-break-{br['start']}",
                "day": day, "start": br["start"], "end": br["end"],
                "room": br["room"], "track": None, "panel_id": None,
                "speakers": [], "title": br["title"], "type": "break",
            })
        for sp in dd["specials"]:
            events.append({
                "day": day, "start": sp["start"], "end": sp["end"],
                "title": sp["title"], "room": sp["room"],
                "people": sp.get("note"),
            })
        for sid, meta in sorted(dd["sessions"].items(), key=lambda kv: (kv[1]["slot"], int(kv[0]))):
            det = details.get(sid)
            color = meta["color"]
            if color in COLOR_SPECIAL:
                track = "X"
            else:
                track = COLOR_TRACK.get(color)
                if track is None:
                    warn(warnings, f"Sitzung {sid}: unbekannte Farbe {color} → Track '?'")
                    track = "?"
            if not det:
                continue
            pid = f"{det['day']}|{det['start']}|ct{sid}"
            code = match_code(det["title"], code_map, warnings, f"ct{sid}")
            panels_out[pid] = {
                "id": pid, "day": det["day"], "block_start": det["start"],
                "code": code, "title": det["title"],
                "chair": ", ".join(det["chairs"]) or None,
                "room": det["room"], "track": track,
            }
            key = (det["day"], det["start"])
            block_rooms[key].add(det["room"])
            block_span[key].append((det["start"], det["end"]))
            used_ids: dict[str, int] = {}
            for pp in det["papers"]:
                # A speakerless copy of the panel title is not a talk.
                if not pp["speakers"] and one_line(pp["title"]).casefold() == one_line(det["title"]).casefold():
                    warn(warnings, f"Sitzung {sid}: Paneltitel nicht als Vortrag uebernommen")
                    continue
                base = f"{det['day']}-{det['start']}-{(det['room'] or '').replace(' ', '')}-{pp['start'] or det['start']}"
                # Eindeutigkeit: mehrere Vorträge im selben Slot (parallele
                # Kurzvorträge, Panel-Intro + erster Vortrag) bekommen -2, -3 …
                n = used_ids.get(base, 0) + 1
                used_ids[base] = n
                sessions.append({
                    "id": base if n == 1 else f"{base}-{n}",
                    "conftool_paper_id": pp["pid"],
                    "day": det["day"],
                    "start": pp["start"] or det["start"],
                    "end": pp["end"] or det["end"],
                    "room": det["room"], "track": track, "panel_id": pid,
                    "speakers": pp["speakers"], "title": pp["title"], "type": "talk",
                    "abstract": pp["abstract"], "affiliations": pp["affiliations"],
                })

    blocks = []
    for (day, start) in sorted(block_span):
        ends = [e for _, e in block_span[(day, start)]]
        tracks = sorted({p["track"] for p in panels_out.values()
                         if p["day"] == day and p["block_start"] == start})
        blocks.append({
            "day": day,
            "day_label": day_label(day),
            "start": start,
            "end": max(ends),
            "track": "+".join(tracks),
            "rooms": sorted(block_rooms[(day, start)], key=lambda r: (r or "")),
        })

    breaks.sort(key=lambda b: (b["day"], b["start"]))
    sessions.sort(key=lambda s: (s["day"], s["start"], s["room"] or ""))
    return {
        "meta": {},  # von write_out ergänzt
        "blocks": blocks,
        "panels": sorted(panels_out.values(),
                         key=lambda p: (p["day"] or "", p["block_start"] or "", p["code"] or p["title"] or "")),
        "sessions": sessions + breaks,
        "events": events,
    }


def day_label(day: str) -> str:
    names = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"]
    d = date.fromisoformat(day)
    return f"{names[d.weekday()]}, {d.strftime('%d.%m.')}"


# ---------------------------------------------------------------- validation

def validate(data: dict, warnings: list) -> list[str]:
    problems = []
    talks = [s for s in data["sessions"] if s["type"] == "talk"]
    breaks = [s for s in data["sessions"] if s["type"] == "break"]
    if len(talks) < 250:
        problems.append(f"nur {len(talks)} Vorträge (Mindestanzahl 250)")
    if len(data["panels"]) < 80:
        problems.append(f"nur {len(data['panels'])} Panels (Mindestanzahl 80)")
    days = {b["day"] for b in data["blocks"]}
    if len(days) != 3:
        problems.append(f"erwartet 3 Programmtage (Do–Sa), gefunden {len(days)}: {sorted(days)}")
    for s in talks:
        for f in ("day", "start", "end", "room", "title"):
            if not s.get(f):
                problems.append(f"Vortrag {s.get('id')}: Feld {f} fehlt")
                break
        if not s.get("speakers"):
            warn(warnings, f"Vortrag {s.get('id')} ohne Sprecher: {s.get('title', '')[:60]!r}")
    if not breaks:
        problems.append("keine Pausen erkannt")
    abs_count = sum(1 for s in talks if s.get("abstract"))
    if abs_count < len(talks) * 0.9:
        problems.append(f"Abstracts nur für {abs_count}/{len(talks)} Vorträge")
    return problems


# ---------------------------------------------------------------- Diff

def _talk_key(t: dict) -> tuple:
    """Identität eines Vortrags unabhängig von Tag/Zeit/Raum:
    (normalisierter Titel, sortierte Sprecher).
    Sprecher-Namen werden normalisiert (klein, ohne angehängte Affiliations-
    Ziffern wie 'Name 2', ohne Leerstrings) — sonst erscheint ein reiner
    Parser-Fix an den Namen als entfallen+neu statt als (keine) Änderung."""
    title = re.sub(r"\s+", " ", t.get("title", "")).strip().lower()
    speakers = tuple(sorted(
        re.sub(r"\s+\d+$", "", s.strip().lower())
        for s in (t.get("speakers") or [])
        if s and s.strip() and not s.strip().isdigit()
    ))
    return (title, speakers)


def _mini(t: dict) -> dict:
    return {k: t.get(k) for k in ("id", "title", "speakers", "day", "start", "end", "room", "status")}


def _slot(t: dict) -> dict:
    return {k: t.get(k) for k in ("day", "start", "end", "room")}


def diff_programs(old: dict, new: dict) -> dict:
    """Changed names/titles/slots and newly cancelled talks in one diff."""
    old_talks = {s["id"]: s for s in old.get("sessions", []) if s.get("type") == "talk"}
    new_talks = {s["id"]: s for s in new.get("sessions", []) if s.get("type") == "talk"}

    added, changed, removed = [], [], []
    for ident, s in new_talks.items():
        o = old_talks.get(ident)
        if s.get("status") == "cancelled":
            if o and o.get("status") != "cancelled":
                removed.append(_mini(s))
            continue
        if o is None:
            added.append(_mini(s))
        elif o.get("status") == "cancelled":
            added.append(_mini(s))
        elif any(o.get(k) != s.get(k) for k in ("title", "speakers", "day", "start", "end", "room")):
            changed.append({**_mini(s), "old": _mini(o)})

    added.sort(key=lambda t: (t.get("day") or "", t.get("start") or "", t.get("room") or ""))
    changed.sort(key=lambda t: (t.get("day") or "", t.get("start") or "", t.get("room") or ""))
    removed.sort(key=lambda t: (t.get("day") or "", t.get("start") or "", t.get("room") or ""))
    return {
        "counts": {"new": len(added), "changed": len(changed), "removed": len(removed)},
        "new": added,
        "changed": changed,
        "removed": removed,
    }


CHANGE_FIELDS = ("counts", "new", "changed", "removed", "generated_at")


def _has_changes(batch: dict | None) -> bool:
    return bool(batch and any(batch.get(kind) for kind in ("new", "changed", "removed")))


def with_change_history(previous: dict | None, latest: dict) -> dict:
    """Keep every real change batch; no-change syncs never become history entries.

    Top-level fields stay the latest diff for older app versions. ``history``
    contains earlier batches, oldest first, so the current batch is not stored
    twice. A legacy changes.json without ``history`` is migrated automatically.
    """
    history = list(previous.get("history") or []) if previous else []
    history = [batch for batch in history if _has_changes(batch)]
    if _has_changes(previous):
        prior_batch = {key: previous.get(key) for key in CHANGE_FIELDS}
        if not history or history[-1].get("generated_at") != prior_batch.get("generated_at"):
            history.append(prior_batch)
    return {**latest, "history": history}


def _real_talks(data: dict) -> list[dict]:
    panels = {p["id"]: p for p in data.get("panels", [])}
    return [s for s in data.get("sessions", []) if s.get("type") == "talk" and not (
        not s.get("speakers") and
        one_line(s.get("title", "")).casefold() ==
        one_line(panels.get(s.get("panel_id"), {}).get("title", "")).casefold())]


def apply_app_author_order(data: dict) -> None:
    """Move locally designated first authors together with their affiliations."""
    for session in data.get("sessions", []):
        first = APP_FIRST_AUTHORS.get(str(session.get("conftool_paper_id")))
        speakers = session.get("speakers") or []
        if not first or first not in speakers or speakers[0] == first:
            continue
        index = speakers.index(first)
        order = [index, *(i for i in range(len(speakers)) if i != index)]
        session["speakers"] = [speakers[i] for i in order]
        affiliations = session.get("affiliations")
        if affiliations:
            session["affiliations"] = [affiliations[i] if i < len(affiliations) else None
                                       for i in order]


def reconcile_programs(old: dict, fresh: dict, warnings: list) -> dict:
    """Keep vanished talks as cancelled and preserve IDs across edits/moves."""
    available = {s["id"]: s for s in _real_talks(old)}
    current = [s for s in fresh["sessions"] if s.get("type") == "talk"]
    for s in current:
        candidates = list(available.values())
        rules = [
            lambda o: bool(s.get("conftool_paper_id") and o.get("conftool_paper_id") == s["conftool_paper_id"]),
            lambda o: _talk_key(o) == _talk_key(s),
            lambda o: bool(s.get("title") and o.get("title", "").casefold() == s["title"].casefold()),
            lambda o: bool(s.get("speakers") and _talk_key(o)[1] == _talk_key(s)[1] and
                           o.get("day") == s.get("day") and o.get("start") == s.get("start")),
            lambda o: bool(s.get("speakers") and _talk_key(o)[1] == _talk_key(s)[1]),
        ]
        match = None
        for rule in rules:
            hits = [o for o in candidates if rule(o)]
            if len(hits) == 1:
                match = hits[0]
                break
        if match:
            s["id"] = match["id"]
            available.pop(match["id"])
        elif s.get("conftool_paper_id"):
            s["id"] = f"ct-paper-{s['conftool_paper_id']}"

    used = {s["id"] for s in current}
    if len(used) != len(current):
        raise ValueError("Doppelte Vortrags-IDs nach ConfTool-Abgleich")
    old_panels = {p["id"]: p for p in old.get("panels", [])}
    new_panels = {p["id"]: p for p in fresh["panels"]}
    newly_cancelled = 0
    for o in available.values():
        cancelled = dict(o)
        if cancelled.get("status") != "cancelled":
            newly_cancelled += 1
            cancelled["cancelled_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
        cancelled["status"] = "cancelled"
        if cancelled["id"] in used:
            raise ValueError(f"Doppelte ID eines abgesagten Vortrags: {cancelled['id']}")
        used.add(cancelled["id"])
        old_panel = old_panels.get(cancelled.get("panel_id"))
        if old_panel and (old_panel["id"] not in new_panels or
                          new_panels[old_panel["id"]]["title"] != old_panel["title"]):
            panel = dict(old_panel)
            if panel["id"] in new_panels:
                panel["id"] += "|cancelled"
                cancelled["panel_id"] = panel["id"]
            fresh["panels"].append(panel)
            new_panels[panel["id"]] = panel
        fresh["sessions"].append(cancelled)
    if newly_cancelled > 8:
        raise ValueError(f"{newly_cancelled} Beitraege verschwunden: moeglicher Importfehler")
    if newly_cancelled:
        warn(warnings, f"{newly_cancelled} nicht mehr akzeptierte Beitraege bleiben als abgesagt sichtbar")
    fresh["sessions"].sort(key=lambda s: (s.get("day") or "", s.get("start") or "", s.get("room") or ""))
    fresh["panels"].sort(key=lambda p: (p.get("day") or "", p.get("block_start") or "", p.get("title") or ""))
    return fresh


# ---------------------------------------------------------------- io

def canonical(data: dict) -> str:
    core = {k: v for k, v in data.items() if k != "meta"}
    serialized = json.dumps(core, ensure_ascii=False, sort_keys=True, indent=1)
    # ConfTool setzt bei jedem Abruf neue IDs in das verschleierte Kontakt-
    # Skript im Footer. Sie sind kein Programminhalt und dürfen allein keinen
    # Programm-Commit oder ein leeres Änderungsverzeichnis auslösen.
    return re.sub(r"ctmail[0-9a-f]+", "ctmail", serialized)


def write_out(data: dict, out_path, warnings: list) -> None:
    data["meta"] = {
        "source": "conftool",
        "source_url": BASE,
        "source_sha256": hashlib.sha256(canonical(data).encode("utf-8")).hexdigest()[:16],
        "generated_at": datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
        "stats": {
            "sessions": sum(1 for s in data["sessions"] if s["type"] == "talk" and s.get("status") != "cancelled"),
            "cancelled": sum(1 for s in data["sessions"] if s.get("status") == "cancelled"),
            "breaks": sum(1 for s in data["sessions"] if s["type"] == "break"),
            "panels": len(data["panels"]),
            "footer_events": len(data["events"]),
            "abstracts": sum(1 for s in data["sessions"] if s.get("abstract") and s.get("status") != "cancelled"),
        },
        "warnings": warnings,
    }
    out_path.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("-o", "--out", default="data/program.json")
    ap.add_argument("--codes", default="data/program.json",
                    help="bisherige program.json als Quelle für SEK-Codes (Titel-Matching)")
    ap.add_argument("--compare", metavar="FILE",
                    help="nur vergleichen: Exit 1, wenn Programminhalt geändert ist")
    ap.add_argument("--changes", metavar="FILE",
                    help="Diff gegen den bisherigen Stand (--codes) als changes.json schreiben")
    ap.add_argument("--history", metavar="FILE",
                    help="bisherige changes.json für die fortlaufende Änderungshistorie")
    ap.add_argument("--delay", type=float, default=0.4)
    args = ap.parse_args()

    warnings: list[str] = []
    days_data = {}
    for day in DAYS:
        print(f"Tag {day} …")
        days_data[day] = parse_day_page(fetch(f"{BASE}?page=browseSessions&form_date={day}&mode=table&presentations=show"),
                                        day, warnings)
        time.sleep(args.delay)

    sids = sorted({sid for dd in days_data.values() for sid in dd["sessions"]}, key=int)
    print(f"{len(sids)} Sitzungen, lade Details …")
    details = {}
    for i, sid in enumerate(sids, 1):
        details[sid] = parse_detail(
            fetch(f"{BASE}?page=browseSessions&form_session={sid}&mode=table&presentations=show&abstracts=show"),
            sid, warnings)
        if i % 20 == 0:
            print(f"  {i}/{len(sids)}")
        time.sleep(args.delay)

    code_map = load_code_map(args.codes)
    data = build(days_data, details, code_map, warnings)
    warnings2: list = []
    problems = validate(data, warnings2)
    warnings.extend(warnings2)
    try:
        old = json.load(open(args.codes, encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        old = None
    if not problems and old is not None:
        try:
            data = reconcile_programs(old, data, warnings)
        except ValueError as e:
            problems.append(str(e))
    apply_app_author_order(data)
    stats = {
        "talks": sum(1 for s in data["sessions"] if s["type"] == "talk" and s.get("status") != "cancelled"),
        "cancelled": sum(1 for s in data["sessions"] if s.get("status") == "cancelled"),
        "breaks": sum(1 for s in data["sessions"] if s["type"] == "break"),
        "panels": len(data["panels"]),
        "events": len(data["events"]),
        "abstracts": sum(1 for s in data["sessions"] if s.get("abstract") and s.get("status") != "cancelled"),
    }
    print(f"stats: {stats}")
    print(f"warnings: {len(warnings)}")
    for w in warnings[:40]:
        print("  -", w)

    if problems:
        print("\nVALIDIERUNG FEHLGESCHLAGEN - keine Ausgabe:")
        for p in problems:
            print("  !", p)
        return 1

    if args.compare:
        try:
            old = json.load(open(args.compare, encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            print("COMPARE: Zieldatei fehlt/unlesbar → geändert")
            return 1
        changed = canonical(old) != canonical(data)
        print(f"COMPARE: {'GEÄNDERT' if changed else 'unverändert'}")
        return 1 if changed else 0

    out = Path(args.out)
    if args.changes:
        if old is None:
            print("DIFF: kein alter Stand (--codes) – changes.json wird nicht geschrieben")
        else:
            changes = diff_programs(old, data)
            changes["generated_at"] = datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")
            if args.history:
                try:
                    previous_changes = json.load(open(args.history, encoding="utf-8"))
                except (OSError, json.JSONDecodeError):
                    previous_changes = None
                changes = with_change_history(previous_changes, changes)
            cpath = Path(args.changes)
            cpath.write_text(json.dumps(changes, ensure_ascii=False, indent=1), encoding="utf-8")
            print(f"Diff: +{changes['counts']['new']} neu, "
                  f"{changes['counts']['changed']} geändert, "
                  f"{changes['counts']['removed']} abgesagt → {cpath}")
    write_out(data, out, warnings)
    print(f"\nwrote {out} ({out.stat().st_size} bytes)")
    print("VALIDIERUNG OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
