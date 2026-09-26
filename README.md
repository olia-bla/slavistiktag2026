# Slavistiktag 2026 – Programm-App mit Themen-Kompass

Experimentelle App zum 15. Deutschen Slavistiktag 2026 in Jena (30.09.–03.10.2026).
Eine Anwendung, zwei Ebenen:

- **Programm** – alle Vorträge, Panels, Podien und Rahmenveranstaltungen mit
  Volltextsuche (global über alle Tage), Filtern (Tag, Raum, Zeit, Panel,
  Disziplin, Format), Favoriten (★, localStorage), ICS-Export, „Jetzt läuft“-
  Ansicht, Sprecher:innen-Ansichten, Sync-Diff („Was ist neu?“) und
  Detail-Drawer pro Vortrag.
- **Themen-Kompass** (Data Mining) – alle Vorträge automatisch nach 27
  Themenfeldern gruppiert: kuratiertes Keyword-Lexikon über Titel und
  Sprechernamen, ergänzt durch eine LLM-Zuordnung, die automatisch gegen die
  Themenliste validiert wird; dazu charakteristische Begriffe (TF-IDF) und
  heuristische Sprachverteilung pro Cluster. Kein ML-Backend, alles im Browser.

Vanilla JS, kein Framework, kein Build-Step. Statisch auf GitHub Pages,
installierbar als PWA (Offline-Nutzung über Service Worker).

## Datenfluss

```
ConfTool der Tagung (slavistiktag2026)
   │  GitHub Action update.yml (Cron alle 6 h): Fetch → Parser →
   │  Validierungs-Gate → bei Änderung: Commit → Pages-Neubau
   ▼
data/program.json   (generiert, committed)
data/changes.json   (Diff des letzten Syncs, optional)
data/llm_tags.json  (LLM-Themen-Zuordnung, validiert)
data/content.json   (kuratiert: Podien, Rahmenprogramm, Venues, Eröffnung)
   │
   ▼
App (buildModel beim Laden: Venues, Panels, Suche, Mining-Tags, Cluster)
```

Validierung schlägt fehl → kein Commit, alte Daten bleiben online, die Action
scheitert sichtbar.

## Struktur

```
repo/
├── index.html                SPA, Hash-Routing (#/startseite, /programm, /mein,
│                             /themen, /sprecher, /aenderungen, /info)
├── sw.js                     Service Worker: Shell stale-while-revalidate,
│                             Daten network-first mit Cache-Fallback
├── manifest.json             PWA-Manifest (installierbar)
├── css/style.css
├── js/
│   ├── app.js                Router, State, Boot
│   ├── data.js               Laden + Verschmelzen + Mining-Pass
│   ├── lexicon.js            Kuratiertes Keyword-Lexikon (27 Themenfelder)
│   ├── mining.js             Tagging, Sprachheuristik, TF-IDF, Clustering
│   ├── search.js             Normalisierung, Filterung, Hervorhebung
│   ├── rooms.js              Raum-Mapping (Gebäude, Etage, Stadtplan-Link)
│   ├── favorites.js, ics.js, now.js, util.js
│   └── views/                dashboard, program, mine, info, drawer, topics,
│                             speakers, changes
├── data/                     program.json, content.json (kuratiert),
│                             changes.json, llm_tags.json (beide generiert)
├── tools/fetch_conftool.py   ConfTool → JSON (Cron-Sync, lokal/CI)
├── tools/parse_program.py    Legacy: PDF→JSON (pdfplumber; vor ConfTool-Umstellung)
├── tools/llm_tagging.py      LLM-Themen-Zuordnung → data/llm_tags.json
├── tools/verify_lexicon.mjs  Lexikon gegen echte Titel verifizieren
├── tests/                    mining, logic, realdata, rooms, shell, smoke
│                             (jsdom), layout (Playwright)
└── .github/workflows/        deploy.yml (Pages), update.yml (Cron 6 h),
                              test.yml (Tests bei Push/PR)
```

## Entwicklung / Tests

```
npm install
npx playwright install chromium        # für die Layout-Suite (einmalig)
npm run test        # 7 Suiten: Mining, Filter/ICS/Now, echte Daten, Räume,
                    # SW-Shell, jsdom-Smoke, Layout (echtes Chromium)
python -m http.server 8000   # lokal ansehen
```

Die Layout-Suite startet einen eigenen Testserver auf Port 8127.

Beiträge: siehe [CONTRIBUTING.md](CONTRIBUTING.md). Wichtig vorab: Die Dateien
`data/program.json`, `data/changes.json` und `data/llm_tags.json` werden vom
CI generiert – bitte nicht händisch im PR ändern (Änderungen würden beim
nächsten Sync überschrieben). Kuratierte Inhalte in `data/content.json` sind
ausdrücklich PR-würdig.

Die Vortragssprache folgt zuerst ausdrücklichen Angaben im Book of Abstracts
oder im öffentlichen ConfTool-Titel bzw. Abstract. Fehlt eine Angabe, werden ein deutscher
Beitragstitel, danach die Sprache des Abstracts und erst zuletzt eine
Titelheuristik ausgewertet. So werden fremdsprachige Werkzitate nicht mehr mit
der tatsächlichen Vortragssprache verwechselt.

Lizenz: MIT (siehe LICENSE). App-Adaption: Olia Blacher. Mit herzlichem Dank an Prof. Dr. Achim Rabus für die Idee und den ersten Entwurf.
