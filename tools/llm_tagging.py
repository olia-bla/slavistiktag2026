#!/usr/bin/env python3
# llm_tagging.py – Multi-Label-Tagging der Vorträge via LiteLLM (Uni-Freiburg-OpenWebUI).
#
# Liest data/program.json (sessions[].type == 'talk') und die Taxonomie aus
# js/lexicon.js (ids + labels), schickt Batches von ~12 Vorträgen (Titel + Sprecher)
# an ein Text-Modell und schreibt data/llm_tags.json:
#   {"meta": {...}, "tags": {session_id: [tag_id, ...]}}
#
# INCREMENTAL: existierende data/llm_tags.json wird geladen, nur fehlende ids
# werden getaggt (--full erzwingt Neutagging aller Vorträge).
#
# Verwendung:
#   python tools/llm_tagging.py            # inkrementell
#   python tools/llm_tagging.py --full     # alles neu taggen
#   python tools/llm_tagging.py --dry-run  # nur Plan ausgeben, keine API-Calls
#
# API-Key aus env OPENWEBUI_API_KEY oder LLMLB_API_KEY (wird nie ausgegeben).
# Wichtig: chat_template_kwargs {"enable_thinking": False}, sonst frisst das
# Reasoning das Token-Budget und content bleibt leer.

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PROGRAM = ROOT / "data" / "program.json"
LEXICON = ROOT / "js" / "lexicon.js"
OUT = ROOT / "data" / "llm_tags.json"

BATCH_SIZE = 12
MAX_RETRIES = 3          # Versuche pro Batch (gesamt, inkl. Erstversuch)
BACKOFF_S = [2, 5, 10]   # Wartezeit vor Wiederholung

BASE_URLS = [
    "https://llmlb.ael.intra.uni-freiburg.de/v1",
    "https://openwebui.ael.intra.uni-freiburg.de/v1",
]
MODEL_CANDIDATES = [
    "ufr/coding-standard",   # bevorzugt, falls irgendwann vorhanden
    "ufr/chat-standard",     # Text-Standard-Modell (aktuell verfügbar)
    "ufr/coding-complex",
]

# ---------- Taxonomie aus js/lexicon.js parsen ----------

def parse_lexicon(path: Path):
    """Liefert [(id, label, group)] für alle TAGS-Einträge."""
    src = path.read_text(encoding="utf-8")
    start = src.index("export const TAGS")
    end = src.index("export const TAG_BY_ID")
    body = src[start:end]
    entries = []
    for m in re.finditer(
        r"id:\s*\"([^\"]+)\"\s*,\s*label:\s*\"([^\"]+)\"\s*,\s*group:\s*\"([^\"]+)\"",
        body,
    ):
        entries.append((m.group(1), m.group(2), m.group(3)))
    if len(entries) < 20:
        raise SystemExit(f"Taxonomie-Parsing verdächtig: nur {len(entries)} Einträge in {path}")
    return entries


# ---------- Programm laden ----------

def load_talks(path: Path):
    data = json.loads(path.read_text(encoding="utf-8"))
    talks = [s for s in data.get("sessions", []) if s.get("type") == "talk"]
    if not talks:
        raise SystemExit(f"Keine Vorträge in {path}")
    return talks


# ---------- Prompt ----------

def build_prompt(taxonomy, batch):
    lines = [
        "Du klassifizierst Vortragstiteln eines Slavistik-Kongresses in ein festes Themen-Schema (Multi-Label).",
        "",
        "Verfügbare Themen-IDs (nur diese verwenden, exakt so geschrieben):",
    ]
    cur_group = None
    for tid, label, group in taxonomy:
        if group != cur_group:
            lines.append(f"  // {group}")
            cur_group = group
        lines.append(f'  - "{tid}" ({label})')
    lines += [
        "",
        "Regeln:",
        "- Ordne jeden Vortrag allen passenden Themen zu (meist 1-3, nie mehr als 4).",
        '- Passt kein Thema, gib ein leeres Array zurück ("topics": []).',
        "- Verwende ausschließlich die oben gelisteten IDs.",
        "- Antworte AUSSCHLIESSLICH mit einem JSON-Array, keine Erklärung, kein Markdown.",
        "",
        "Format der Antwort:",
        '[{"id": "<vortrags-id>", "topics": ["<tag-id>", ...]}, ...]',
        "",
        "Vorträge:",
    ]
    for s in batch:
        speakers = ", ".join(s.get("speakers") or [])
        lines.append(f'- id: {s["id"]}')
        lines.append(f'  titel: {s.get("title") or ""}')
        if speakers:
            lines.append(f"  sprecher: {speakers}")
    return "\n".join(lines)


# ---------- JSON-Antwort parsen + validieren ----------

def parse_reply(text, valid_session_ids, valid_tag_ids):
    """Extrahiert {session_id: [tag_id,...]} aus der Modellantwort.
    Unbekannte tag-ids werden verworfen, unbekannte session-ids ignoriert."""
    if not text or not text.strip():
        return None
    t = text.strip()
    # Code-Fences entfernen
    t = re.sub(r"^```(?:json)?\s*", "", t)
    t = re.sub(r"\s*```$", "", t).strip()
    try:
        data = json.loads(t)
    except json.JSONDecodeError:
        # erster [{...}]-Block als Fallback
        m = re.search(r"\[\s*\{.*\}\s*\]", t, re.DOTALL)
        if not m:
            return None
        try:
            data = json.loads(m.group(0))
        except json.JSONDecodeError:
            return None
    if not isinstance(data, list):
        return None
    out = {}
    for item in data:
        if not isinstance(item, dict):
            continue
        sid = item.get("id")
        if not isinstance(sid, str) or sid not in valid_session_ids:
            continue
        topics = item.get("topics")
        if topics is None:
            topics = item.get("tags")
        if topics is None:
            topics = []
        if not isinstance(topics, list):
            topics = []
        clean = [x for x in topics if isinstance(x, str) and x in valid_tag_ids]
        # dedup, Reihenfolge stabil
        seen = set()
        dedup = []
        for x in clean:
            if x not in seen:
                seen.add(x)
                dedup.append(x)
        out[sid] = dedup
    return out or None


# ---------- litellm-Call ----------

def make_completer():
    from litellm import completion

    # Beide Keys testen: nicht jeder Key gilt für jede Base (401 sonst fälschlich
    # als "Modell fehlt" interpretiert). Reihenfolge: OPENWEBUI_API_KEY zuerst.
    keys = [k for k in (os.environ.get("OPENWEBUI_API_KEY"),
                        os.environ.get("LLMLB_API_KEY")) if k]
    if not keys:
        raise SystemExit("Kein API-Key: OPENWEBUI_API_KEY oder LLMLB_API_KEY setzen.")

    base_url = None
    model = None
    api_key = None
    # Key/Modell verfügbar + erreichbar? (Mini-Call als Healthcheck)
    for base in BASE_URLS:
        for key in keys:
            for cand in MODEL_CANDIDATES:
                try:
                    resp = completion(
                        model=f"openai/{cand}",
                        base_url=base,
                        api_key=key,
                        messages=[{"role": "user", "content": "Antworte mit genau einem Wort: ok?"}],
                        max_tokens=10,
                        temperature=0,
                        extra_body={"chat_template_kwargs": {"enable_thinking": False}},
                    )
                    if resp.choices and (resp.choices[0].message.content or "").strip():
                        base_url, model, api_key = base, cand, key
                        break
                except Exception as e:
                    print(f"  [setup] {cand} @ {base}: {type(e).__name__}", flush=True)
                    continue
            if model:
                break
        if model:
            break
    if not model:
        raise SystemExit("Kein funktionierendes Modell gefunden (siehe setup-Log oben).")
    print(f"Setup OK: model={model} base_url={base_url}", flush=True)

    def call(prompt: str) -> str:
        resp = completion(
            model=f"openai/{model}",
            base_url=base_url,
            api_key=api_key,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=2000,
            temperature=0,
            extra_body={"chat_template_kwargs": {"enable_thinking": False}},
        )
        return (resp.choices[0].message.content or "").strip()

    host = re.sub(r"^https?://", "", base_url).rstrip("/")
    return call, model, host


# ---------- Haupt ----------

def main():
    ap = argparse.ArgumentParser(description="LLM-Tagging der Vorträge (litellm).")
    ap.add_argument("--full", action="store_true", help="alle Vorträge neu taggen")
    ap.add_argument("--dry-run", action="store_true", help="nur Plan ausgeben, keine API-Calls")
    args = ap.parse_args()

    taxonomy = parse_lexicon(LEXICON)
    tax_ids = {t[0] for t in taxonomy}
    talks = load_talks(PROGRAM)
    talk_ids = {s["id"] for s in talks}

    # Bestehende Datei laden (inkrementell)
    existing = {}
    prev_meta = {}
    if OUT.exists():
        try:
            prev = json.loads(OUT.read_text(encoding="utf-8"))
            prev_meta = prev.get("meta", {})
            for sid, tags in (prev.get("tags") or {}).items():
                clean = [t for t in tags if t in tax_ids]
                if clean != list(tags):
                    print(f"  [warn] unbekannte tag-ids in {sid} verworfen")
                existing[sid] = clean
        except (json.JSONDecodeError, OSError) as e:
            print(f"  [warn] {OUT.name} unlesbar ({e}), starte neu")

    if args.full:
        pending = list(talk_ids)
    else:
        pending = [sid for sid in talk_ids if sid not in existing]

    batches = [pending[i:i + BATCH_SIZE] for i in range(0, len(pending), BATCH_SIZE)]
    print(f"Vorträge gesamt: {len(talk_ids)} | bereits getaggt: {len(existing)} | "
          f"offen: {len(pending)} → {len(batches)} Batches à ≤{BATCH_SIZE}")
    if args.dry_run:
        print("DRY-RUN: keine API-Calls, keine Datei geschrieben.")
        return 0

    call, model, host = make_completer()
    api_calls = 0

    tags = dict(existing)
    for bi, batch in enumerate(batches, 1):
        batch_ids = set(batch)
        batch_talks = [s for s in talks if s["id"] in batch_ids]
        prompt = build_prompt(taxonomy, batch_talks)
        got = None
        for attempt in range(1, MAX_RETRIES + 1):
            try:
                api_calls += 1
                reply = call(prompt)
                got = parse_reply(reply, batch_ids, tax_ids)
            except Exception as e:
                print(f"  Batch {bi}/{len(batches)} Versuch {attempt}: API-Fehler "
                      f"{type(e).__name__}: {str(e)[:120]}", flush=True)
                got = None
            missing = [sid for sid in batch_ids if got is None or sid not in got]
            if got is not None and not missing:
                break
            if attempt < MAX_RETRIES:
                wait = BACKOFF_S[min(attempt - 1, len(BACKOFF_S) - 1)]
                print(f"  Batch {bi}/{len(batches)}: {len(missing)} ids fehlen → "
                      f"Retry in {wait}s", flush=True)
                time.sleep(wait)
        if got is None:
            print(f"  Batch {bi}/{len(batches)}: KEINE verwertbare Antwort nach "
                  f"{MAX_RETRIES} Versuchen – Batch übersprungen", flush=True)
            continue
        for sid, tl in got.items():
            tags[sid] = tl
        done = sum(1 for sid in batch_ids if sid in tags and tags[sid] is not None)
        print(f"Batch {bi}/{len(batches)} ok: {len(got)} ids, "
              f"{sum(len(t) for t in got.values())} Tags (getaggt gesamt: {len(tags)})", flush=True)

    # Meta-Block
    counts = {}
    for sid, tl in tags.items():
        if sid in talk_ids:
            for t in tl:
                counts[t] = counts.get(t, 0) + 1
    meta = {
        "model": model,
        "base_url_host": host,
        "generated": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "api_calls": int(prev_meta.get("api_calls") or 0) + api_calls,
        "counts": counts,
        "tagged_sessions": sum(1 for sid in tags if sid in talk_ids),
        "total_talks": len(talk_ids),
    }
    OUT.write_text(
        json.dumps({"meta": meta, "tags": tags}, ensure_ascii=False, indent=1) + "\n",
        encoding="utf-8",
    )
    print(f"Geschrieben: {OUT.name} | getaggt: {meta['tagged_sessions']}/{meta['total_talks']} "
          f"| api_calls (kumuliert): {meta['api_calls']}")
    print("Counts:", json.dumps(counts, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
