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
  assert.ok(m.rooms.includes("HS 2"), "HS 2 fehlt im Raumfilter");
  assert.equal(m.rooms.includes("HS 5"), false, "veralteter Raum HS 5 ist noch vorhanden");
  const sourceRooms = new Set([
    ...program.sessions.map((s) => s.room),
    ...program.panels.map((p) => p.room),
    ...program.events.map((e) => e.room),
  ].filter(Boolean));
  for (const room of sourceRooms) assert.ok(m.rooms.includes(room), `${room} aus ConfTool fehlt im Raumfilter`);
  for (const s of m.sessions) {
    if (s.room && s.room.startsWith("SR")) assert.equal(s.venue, "CZS3");
  }
});
t("Model: Events inklusive 10 Einträgen im Rahmenprogramm", () => {
  assert.ok(m.events.length >= 15, `nur ${m.events.length} Events`);
  assert.equal(m.events.filter((e) => e.type === "rahmen").length, 10);
  const podiums = m.events.filter((e) => e.type === "podium");
  assert.equal(podiums.length, 4, `${podiums.length} Podien`);
  assert.deepEqual(podiums.map((e) => `${e.day}|${e.start}|${e.room}`), [
    "2026-10-01|16:00|HS 2",
    "2026-10-02|16:00|HS 8",
    "2026-10-02|16:00|HS 2",
    "2026-10-03|11:30|HS 2",
  ]);
  const ohneRussland = podiums.find((e) => e.title.startsWith("Slavistik ohne Russland?"));
  assert.equal(ohneRussland?.room, "HS 2");
  assert.ok(ohneRussland?.people.includes("Emilia Nowak"));
  const specials = m.events.filter((e) => e.type === "special");
  assert.equal(specials.length, 6, `${specials.length} Sonderformate statt 6`);
  assert.deepEqual(specials.map((e) => e.title), [
    "Eröffnung des Slavistiktages mit Festvortrag von Dr. Andreas Umland (Kyjiw/Stockholm): „Panrussismus, Eurasismus und Imperialismus als Schlüsselkonzepte zur Erklärung des russischen Überfalls auf die Ukraine“",
    "Russia’s War on Ukraine and the Crisis of World Order — Book presentation and roundtable",
    "Präsentation des Buchs „Russische Schockwellen. Der Krieg in der Ukraine und die Lage in den angrenzenden Regionen\" (Hg. Olaf Leiße)",
    "Prof. Dr. Liliia Bezugla: „Wenn ich Heimweh sage…“ – Mascha Kaléko auf Ukrainisch",
    "Helene Jessula Wczesniak: Die Fördermöglichkeiten bei der DFG",
    "Impulsvortrag von Olaf Hamann (Staatsbibliothek zu Berlin, FID Slawistik): „Alles rechtens – alles bestens? Der Fachinformationsdienst Slawistik im Spannungsfeld zwischen Informationsfreiheit, Sanktionspolitik, Zensur und Propaganda“",
  ]);
  const helden = m.events.find((e) => e.title.startsWith("Helden unserer Zeit?"));
  assert.equal(helden?.type, "panel");
  assert.equal(helden?.track, "LKW");
  assert.equal(m.events.some((e) => e.type === "event"), false);
});
t("Eröffnung/Festvortrag und musikalisches Buffet sind getrennte Formate", () => {
  const opening = m.events.find((e) => e.title.startsWith("Eröffnung des Slavistiktages"));
  assert.ok(opening, "Eröffnung fehlt");
  assert.equal(opening.type, "special");
  assert.deepEqual(opening.formats, ["special"]);
  assert.equal(opening.start, "18:00");
  assert.equal(opening.end, "20:00");
  const music = m.events.find((e) => e.title === "Musikalische Begleitung mit Buffet im Foyer");
  assert.ok(music, "Musikalische Begleitung fehlt");
  assert.equal(music.type, "rahmen");
  assert.deepEqual(music.formats, ["rahmen"]);
  assert.equal(music.start, "20:00");
  assert.equal(music.room, "Foyer CZS 3");
});
t("Vortragssprachen: Nadiya Kiss Ukrainisch, fremdsprachige Zitate nicht fehlklassifiziert", () => {
  const bySpeaker = (name) => m.sessions.find((s) => s.speakers?.includes(name));
  assert.equal(bySpeaker("Nadiya Kiss")?._lang, "uk");
  assert.equal(bySpeaker("Nadiya Kiss")?._langSource, "declared");
  assert.equal(bySpeaker("Olga Bikkulova")?._lang, "en");
  assert.equal(bySpeaker("Nadine Menzel")?._lang, "de");
  assert.equal(bySpeaker("Schamma Schahadat")?._lang, "de");
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
