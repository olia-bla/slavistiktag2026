# Contributing

Danke, dass du beitragen möchtest! Die App läuft ohne Build-Step – Änderungen
an `js/`, `css/` oder `index.html` wirken direkt. Ein paar Regeln halten den
Betrieb stabil:

## Setup

```
npm install
npx playwright install chromium   # nur für die Layout-Suite nötig
npm run test
```

Alle 7 Test-Suiten müssen grün sein, bevor ein PR gemergt wird. Die
Layout-Suite startet einen eigenen Server auf Port 8127 (lokal kein Konflikt
mit einem auf 8000 laufenden Dev-Server).

## Wichtig: generierte Dateien nicht händisch ändern

- `data/program.json` – generiert aus dem ConfTool der Tagung
  (GitHub Action `update.yml`, alle 6 h; Validierungs-Gate davor).
- `data/changes.json` – Diff des letzten Syncs, ebenfalls vom CI geschrieben.
- `data/llm_tags.json` – LLM-Themen-Zuordnung, erzeugt mit `tools/llm_tagging.py`.

PRs, die diese Dateien händisch anfassen, werden beim nächsten Sync
überschrieben. Ausnahme `data/content.json`: Diese Datei ist **kuratiert**
(Podien, Rahmenprogramm, Venues, Links) und darf per PR korrigiert/ergänzt
werden – das ist sogar ausdrücklich willkommen (z. B. wenn der Lageplan
nachgereicht wird).

## Gute Einstiegspunkte

- `js/lexicon.js` – Keyword-Lexikon der 27 Themenfelder. Neue Begriffe
  ergänzen und anschließend `node tools/verify_lexicon.mjs` laufen lassen,
  damit Fehltreffer gegen echte Titel geprüft sind.
- `js/rooms.js` – Raum-Mapping; wenn die Tagung neue Räume bekannt gibt,
  hier ergänzen (Stadtplan-PDF als Referenz).
- `js/mining.js` – Sprachheuristik und Clustering; Änderungen bitte in
  `tests/mining.test.mjs` mit Fällen festhalten.
- `data/content.json` – inhaltliche Korrekturen zum Rahmenprogramm.

## Konventionen

- Vanilla JS (ES-Module), kein Framework, kein Build-Step, keine neuen
  Runtime-Abhängigkeiten. Dev-Dependencies (jsdom, playwright) nur für Tests.
- Neue `js/`-Module müssen in die `SHELL`-Liste von `sw.js` eingetragen
  werden – der Test `tests/shell.test.mjs` schlägt sonst fehl (Offline-Fähigkeit).
- Deutsche UI-Texte, typografische Anführungszeichen („…“), Vielfalt bei
  Sprecher:innen-Namen so wie im Quellmaterial.
- Lizenz: MIT – mit einem PR bestätigst du, dass dein Beitrag unter MIT steht.

## Fragen

Issue im Repo öffnen: https://github.com/olia-bla/slavistiktag2026/issues
