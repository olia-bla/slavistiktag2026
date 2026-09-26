// Integrationstest: echte Daten durch die App-Logik. node tests/realdata.test.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildModel } from "../js/data.js";
import { normalize, filterSessions, makeSearchText } from "../js/search.js";
import { nowInfo } from "../js/now.js";
import { icsFor } from "../js/ics.js";

let n = 0;
let failed = 0;
const pending = [];
// t() trackt auch async-Callbacks: verlorene Rejections wären sonst stille Fails (Exit 0)
const t = (name, fn) => {
  try {
    const r = fn();
    if (r && typeof r.catch === "function") {
      pending.push(r.catch((e) => { failed++; console.error(`  FAIL ${name}: ${e.message}`); }));
    }
  } catch (e) {
    failed++; console.error(`  FAIL ${name}: ${e.message}`);
  }
  n++; console.log("  ok", name);
};

const program = JSON.parse(await readFile(new URL("../data/program.json", import.meta.url), "utf-8"));
const content = JSON.parse(await readFile(new URL("../data/content.json", import.meta.url), "utf-8"));
const m = buildModel(program, content);

t("Model: 3 Programmtage + Eröffnungstag", () => {
  assert.deepEqual(m.days, ["2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03"]);
});
t("Model: 311 Sessions, 102 Panels", () => {
  assert.equal(m.sessions.length, 318); // 311 Vorträge + 7 Pausen
  assert.equal(Object.keys(m.panels).length, 102);
});
t("Model: Räume mit Venue", () => {
  assert.ok(m.rooms.includes("MMZ 220"));
  for (const s of m.sessions) {
    if (s.room && s.room.startsWith("SR")) assert.equal(s.venue, "CZS3");
  }
});
t("Model: Events inklusive 10 Einträgen im Rahmenprogramm", () => {
  assert.ok(m.events.length >= 15, `nur ${m.events.length} Events`);
  assert.equal(m.events.filter((e) => e.type === "rahmen").length, 10);
  const podiums = m.events.filter((e) => e.type === "podium");
  assert.equal(podiums.length, 4, `${podiums.length} Podien`);
});
t("Eröffnung ist Rahmenprogramm und Sonderformat", () => {
  const opening = m.events.find((e) => e.title.startsWith("Eröffnung des Slavistiktages"));
  assert.ok(opening, "Eröffnung fehlt");
  assert.deepEqual(opening.formats, ["rahmen", "special"]);
});
t("Suchindex: Ukraine-Vortrag über Query findbar", () => {
  for (const s of m.sessions) s._search = makeSearchText(s, s.panel_title);
  const hits = filterSessions(m.sessions, { q: "suržyk" });
  assert.ok(hits.length >= 1, "Suržyk-Vortrag nicht gefunden");
  const hits2 = filterSessions(m.sessions, { q: "в том числе" });
  assert.ok(hits2.length >= 1, "Cyrillica-Titel nicht gefunden");
});
t("Filter: HS 8 am Freitag", () => {
  const hits = filterSessions(m.sessions, { day: "2026-10-02", room: "HS 8" })
    .filter((s) => s.type === "talk");
  assert.ok(hits.length >= 3, `nur ${hits.length}`);
});
t("Filter: alle LKW am Samstag", () => {
  const hits = filterSessions(m.sessions, { day: "2026-10-03", tracks: ["LKW"] });
  assert.ok(hits.length >= 10);
});
t("Fachfarben: SEK-Codes überschreiben fehlerhafte Quell-Tracks", () => {
  for (const discipline of ["LKW", "SW", "DID"]) {
    const hits = m.sessions.filter((s) => s.panel_code?.startsWith(`SEK_${discipline}_`));
    assert.ok(hits.length > 0, `${discipline}: keine Sektion`);
    assert.equal(hits.every((s) => s.discipline === discipline && s.track === discipline), true);
  }
});
t("Fachfarben: eingereichte Panels wie im offiziellen PDF", () => {
  const byTitle = (title) => m.sessions.filter((s) => s.panel_title === title);
  const did = [
    ...byTitle("Fremdsprachendidaktik slavischer Sprachen"),
    ...byTitle("Didaktik der Herkunftssprachen"),
  ];
  assert.ok(did.length > 0);
  assert.equal(did.every((s) => s.discipline === "DID" && s.track === "DID"), true);
  assert.equal(byTitle("Sprache und Krieg").every((s) => s.discipline === "SW" && s.track === "SW"), true);
  assert.equal(byTitle("Migration in Film: Theory, History, and Academic Practics").every((s) => s.discipline === "LKW" && s.track === "LKW"), true);
});
t("now: Sa 03.10. mittags → Podium läuft", () => {
  const info = nowInfo(m, new Date("2026-10-03T11:35:00"));
  assert.equal(info.status, "session");
  assert.equal(info.current.type, "podium");
  assert.equal(info.current.title.includes("Welt brennt"), true);
});
t("ICS: erster Favorit erzeugt validen VEVENT", () => {
  const s = m.byDay["2026-10-01"][0];
  const ics = icsFor([{ day: s.day, start: s.start, end: s.end, title: s.title, room: s.room }]);
  assert.match(ics, /BEGIN:VEVENT/);
  assert.match(ics, /DTSTART;TZID=Europe\/Berlin/);
});
t("ICS: alle Pausen+Vorträge eines Tages valide", () => {
  const events = m.byDay["2026-10-01"].map((s) => ({
    day: s.day, start: s.start, end: s.end, title: s.title, room: s.room || "",
  }));
  const ics = icsFor(events);
  const count = (ics.match(/BEGIN:VEVENT/g) || []).length;
  assert.equal(count, events.length);
});

await Promise.allSettled(pending);
console.log(`\n${n} Integrationstests bestanden.`);
process.exit(failed ? 1 : 0);
