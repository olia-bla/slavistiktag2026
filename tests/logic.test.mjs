// Logik-Tests für die DOM-freien Module. Ausführen: node tests/logic.test.mjs
import assert from "node:assert/strict";
import { normalize, matchesQuery, filterSessions, formatOf, matchesTimeSlot, TIME_SLOTS } from "../js/search.js";
import { matchesProgramCategories } from "../js/views/program.js";
import { icsFor } from "../js/ics.js";
import { nowInfo } from "../js/now.js";
import { buildModel, naturalRooms, panelDiscipline } from "../js/data.js";
import { minutes, dateLabel, isoDay } from "../js/util.js";
import fs from "node:fs";

// Gemeinsames Modell für die Feature-Tests (sync geladen)
const _prog = JSON.parse(fs.readFileSync(new URL("../data/program.json", import.meta.url), "utf8"));
const _content = JSON.parse(fs.readFileSync(new URL("../data/content.json", import.meta.url), "utf8"));
const _model = buildModel(_prog, _content);

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

// ---------- search
t("normalize faltet Diakritika", () => {
  assert.equal(normalize("Kovács übermäßig"), "kovacs ubermassig");
});
t("normalize: Cyrillica konsistent (Query matcht Text)", () => {
  assert.equal(normalize("Київ"), normalize("київ"));
  assert.equal(matchesQuery(normalize("Der Connector в том числе"), "в том числе"), true);
  assert.equal(normalize("Daten київ").includes("к"), true);
});
t("Fachzuordnung: Sektionen folgen dem SEK-Code", () => {
  assert.equal(panelDiscipline({ code: "SEK_LKW_09", track: "SW+DID" }), "LKW");
  assert.equal(panelDiscipline({ code: "SEK_SW_17", track: "LKW" }), "SW");
  assert.equal(panelDiscipline({ code: "SEK_DID_02", track: "X" }), "DID");
});
t("Fachzuordnung: Panels folgen den Farben des offiziellen PDFs", () => {
  assert.equal(panelDiscipline({ code: null, title: "Fremdsprachendidaktik slavischer Sprachen", track: "SW+DID" }), "DID");
  assert.equal(panelDiscipline({ code: null, title: "Didaktik der Herkunftssprachen", track: "SW+DID" }), "DID");
  assert.equal(panelDiscipline({ code: null, title: "Sprache und Krieg", track: "SW+DID" }), "SW");
  assert.equal(panelDiscipline({ code: null, title: "Migration in Film", track: "LKW" }), "LKW");
});
t("matchesQuery UND-Verknüpfung", () => {
  assert.equal(matchesQuery("polnisch herkunft russisch", "polnisch russisch"), true);
  assert.equal(matchesQuery("polnisch herkunft", "polnisch russisch"), false);
});
t("matchesQuery Bindestrich-Toleranz", () => {
  assert.equal(matchesQuery(normalize("Herkunftssprachlicher Unterricht"), "herkunfts"), true);
});
t("matchesQuery: Nachname zuerst, Komma und Buchstabendreher werden toleriert", () => {
  assert.equal(matchesQuery("nadiya kiss motivation ukrainian", "Kiss, Nadyia"), true);
  assert.equal(matchesQuery("nadine meier", "Kiss, Nadyia"), false);
});

const S = (over = {}) => ({
  id: "x", day: "2026-10-01", start: "09:00", end: "09:30",
  room: "SR 114", venue: "CZS3", track: "SW", type: "talk",
  panel_id: "p1", speakers: ["A Person"], title: "Ein Titel", ...over,
});
const sessions = [
  S(),
  S({ id: "b", day: "2026-10-02", track: "LKW", title: "Kino in Sarajevo", room: "HS 6" }),
  S({ id: "c", type: "break", title: "Mittagspause", room: null, track: null, start: "13:00", end: "14:00" }),
  S({ id: "d", track: "SW+DID", title: "Didaktik des Ukrainischen" }),
];
for (const s of sessions) s._search = normalize(s.title);

t("filter: Suche nach Titel", () => {
  assert.deepEqual(filterSessions(sessions, { q: "kino" }).map((s) => s.id), ["b"]);
});
t("filter: Tag", () => {
  assert.deepEqual(filterSessions(sessions, { day: "2026-10-02" }).map((s) => s.id), ["b"]);
});
t("filter: ohne day = alle Tage (Suche global)", () => {
  assert.deepEqual(filterSessions(sessions, { q: "kino" }).map((s) => s.id), ["b"]);
  assert.deepEqual(filterSessions(sessions, { q: "didaktik" }).map((s) => s.id), ["d"]);
  assert.deepEqual(filterSessions(sessions, {}).length, 4);
});
t("filter: Track-OR", () => {
  assert.deepEqual(filterSessions(sessions, { tracks: ["DID"] }).map((s) => s.id), ["d"]);
  assert.deepEqual(filterSessions(sessions, { tracks: ["SW", "LKW"] }).map((s) => s.id).sort().join(","), "b,d,x");
});
t("filter: Format pause", () => {
  assert.deepEqual(filterSessions(sessions, { formats: ["pause"] }).map((s) => s.id), ["c"]);
});
t("Zeitfilter: fünf Zeitfenster mit eindeutigen Grenzen", () => {
  assert.deepEqual(TIME_SLOTS.map((slot) => slot.label), [
    "09:00–11:00", "11:30–13:00", "14:00–15:30", "16:00–17:30", "nach dem Vortragsende",
  ]);
  assert.equal(matchesTimeSlot("09:00", "09:00-11:00"), true);
  assert.equal(matchesTimeSlot("11:00", "09:00-11:00"), true);
  assert.equal(matchesTimeSlot("11:30", "09:00-11:00"), false);
  assert.equal(matchesTimeSlot("11:30", "11:30-13:00"), true);
  assert.equal(matchesTimeSlot("13:00", "11:30-13:00"), true);
  assert.equal(matchesTimeSlot("14:30", "14:00-15:30"), true);
  assert.equal(matchesTimeSlot("15:30", "14:00-15:30"), true);
  assert.equal(matchesTimeSlot("16:00", "16:00-17:30"), true);
  assert.equal(matchesTimeSlot("17:30", "16:00-17:30"), true);
  assert.equal(matchesTimeSlot("17:30", "after-program", "2026-10-02"), false);
  assert.equal(matchesTimeSlot("18:00", "after-program", "2026-10-02"), true);
  assert.equal(matchesTimeSlot("18:00", "after-program", "2026-09-30"), false, "Eröffnung ist noch nicht nach dem Vortragsende");
  assert.equal(matchesTimeSlot("20:00", "after-program", "2026-09-30"), true, "Buffet nach der Eröffnung fehlt");
  assert.equal(matchesTimeSlot("13:00", "after-program", "2026-10-03"), true, "Abschlussveranstaltung am Samstag fehlt");
  assert.equal(matchesTimeSlot("09:00", "09:00"), true, "alter Deep-Link funktioniert nicht mehr");
});
t("formatOf: SEK-Code → sektion", () => {
  assert.equal(formatOf({ type: "talk", panel_code: "SEK_SW_01" }), "sektion");
});
t("formatOf: Vortrag ohne SEK-Code → panel (eingereichtes Panel)", () => {
  assert.equal(formatOf({ type: "talk" }), "panel");
});
t("formatOf: X-Veranstaltung ist kein eingereichtes Panel", () => {
  assert.equal(formatOf({ type: "talk", track: "X", discipline: "X" }), "special");
});
t("filter: Format panel → nur code-lose Panels (nicht Sektionen)", () => {
  const hit = filterSessions(sessions, { formats: ["panel"] }).map((s) => s.id);
  assert.deepEqual(hit.sort(), ["b", "d", "x"].sort(), "Talks ohne SEK-Code sind 'panel'");
});
t("filter: Format sektion → nur SEK_-Vorträge", () => {
  const s = S({ id: "sek1", panel_code: "SEK_SW_01" });
  s._search = normalize(s.title);
  assert.deepEqual(filterSessions([s], { formats: ["sektion"] }).map((x) => x.id), ["sek1"]);
  assert.deepEqual(filterSessions([s], { formats: ["panel"] }).map((x) => x.id), []);
});
t("Programmfilter: alle 128 Kombinationen aus Fachbereichen und Formaten", () => {
  const choices = [
    { group: "track", value: "DID", track: "DID", formats: ["panel"] },
    { group: "track", value: "SW", track: "SW", formats: ["sektion"] },
    { group: "track", value: "LKW", track: "LKW", formats: ["panel"] },
    { group: "format", value: "podium", track: "", formats: ["podium"] },
    { group: "format", value: "special", track: "X", formats: ["special"] },
    { group: "format", value: "rahmen", track: "", formats: ["rahmen"] },
    { group: "format", value: "pause", track: "", formats: ["pause"] },
  ];
  for (let mask = 0; mask < 2 ** choices.length; mask++) {
    const selected = choices.filter((_, index) => mask & (1 << index));
    const state = {
      tracks: selected.filter((x) => x.group === "track").map((x) => x.value),
      formats: selected.filter((x) => x.group === "format").map((x) => x.value),
    };
    choices.forEach((item, index) => {
      const expected = mask === 0 || Boolean(mask & (1 << index));
      assert.equal(
        matchesProgramCategories(item.track, item.formats, state),
        expected,
        `Kombination ${mask}, Kategorie ${item.value}`);
    });
  }
});

// ---------- ics
t("ICS enthält VTIMEZONE und korrekte DTSTART", () => {
  const ics = icsFor([{ day: "2026-10-01", start: "09:00", end: "09:30", title: "Vortrag; mit, Kommas", room: "SR 114" }]);
  assert.ok(ics.includes("DTSTART;TZID=Europe/Berlin:20261001T090000"));
  assert.ok(ics.includes("DTEND;TZID=Europe/Berlin:20261001T093000"));
  assert.ok(ics.includes("SUMMARY:Vortrag\\; mit\\, Kommas"));
  assert.ok(ics.includes("BEGIN:VTIMEZONE"));
});
t("ICS foldet lange Zeilen", () => {
  const ics = icsFor([{ day: "2026-10-01", start: "09:00", end: "09:30", title: "x".repeat(300) }]);
  for (const line of ics.split("\r\n")) assert.ok(line.length <= 75, `Zeile zu lang: ${line.length}`);
});

// ---------- now
const model = {
  conference: { start: "2026-09-30", end: "2026-10-03" },
  byDay: {
    "2026-10-01": [
      S({ id: "m1", start: "09:00", end: "09:30" }),
      S({ id: "m2", start: "09:30", end: "10:00" }),
      S({ id: "m3", start: "11:30", end: "13:00" }),
    ],
  },
};
t("now: laufende Session", () => {
  const info = nowInfo(model, new Date("2026-10-01T09:45:00"));
  assert.equal(info.status, "session");
  assert.equal(info.current.id, "m2");
  const info2 = nowInfo(model, new Date("2026-10-01T09:10:00"));
  assert.equal(info2.current.id, "m1");
});
t("now: parallele Veranstaltungen werden vollständig gruppiert", () => {
  const parallel = {
    conference: model.conference,
    byDay: {
      "2026-10-01": [
        S({ id: "a1", start: "09:00", end: "09:30", room: "HS 6" }),
        S({ id: "a2", start: "09:00", end: "09:30", room: "HS 8" }),
        S({ id: "b1", start: "09:30", end: "10:00", room: "HS 6" }),
        S({ id: "b2", start: "09:30", end: "10:00", room: "HS 8" }),
      ],
    },
  };
  const info = nowInfo(parallel, new Date("2026-10-01T09:15:00"));
  assert.deepEqual(info.currentItems.map((x) => x.id), ["a1", "a2"]);
  assert.deepEqual(info.nextItems.map((x) => x.id), ["b1", "b2"]);
});
t("now: Pause zwischen Slots", () => {
  const info = nowInfo(model, new Date("2026-10-01T11:05:00"));
  assert.equal(info.status, "break");
  assert.equal(info.next.id, "m3");
});
t("now: vor der Tagung", () => {
  const info = nowInfo(model, new Date("2026-09-15T10:00:00"));
  assert.equal(info.status, "before");
});
t("now: nach der Tagung", () => {
  const info = nowInfo(model, new Date("2026-10-05T10:00:00"));
  assert.equal(info.status, "after");
});

// ---------- data merge
const program = {
  meta: { stats: {} },
  blocks: [{ day: "2026-10-01", day_label: "Donnerstag, 01.10.", start: "09:00", end: "11:00", track: "SW", rooms: ["SR 114"] }],
  panels: [{ id: "p1", code: "SEK_SW_01", title: "Historische Ostslavistik", chair: "I. Podtergera", room: "SR 207", day: "2026-10-01", block_start: "09:00", track: "SW" }],
  sessions: [
    S(),
    { id: "e1", day: "2026-10-01", start: "16:00", end: "17:30", room: null, track: null, panel_id: null, speakers: [], title: "Podiumsdiskussion: Test", type: "talk" },
  ],
  events: [{ day: "2026-10-01", start: "18:00", end: "19:30", title: "Konzert des ukrainischen Chors (Aula, UHG)" }],
};
const content = {
  conference: { start: "2026-09-30", end: "2026-10-03" },
  room_venue: { SR: "CZS3", HS: "CZS3", MMZ: "MMZ" },
  venues: { CZS3: { name: "CZS3" }, UHG: { name: "UHG" }, MMZ: { name: "MMZ" }, HaM: {} },
  podiums: [{ day: "2026-10-01", start: "16:00", end: "17:30", title: "Podiumsdiskussion: Test (CZS 3, HS 2)", body: "…", people: "…" }],
  special: [{ day: "2026-10-01", start: "11:30", end: "13:00", room: "SR 222", title: "Book presentation" }],
  accompanying: [{ day: "2026-09-30", start: "18:00", title: "Eröffnung" }],
};
t("buildModel: Venue-Zuordnung", () => {
  const m = buildModel(program, content);
  assert.equal(m.sessions[0].venue, "CZS3");
  assert.equal(m.sessions[0].panel_code, "SEK_SW_01");
  assert.equal(m.sessions[0].chair, "I. Podtergera");
});
t("buildModel: Podium aus content dedupliziert PDF-Event nicht fälschlich", () => {
  const m = buildModel(program, content);
  const podiums = m.events.filter((e) => e.type === "podium");
  // PDF-Event ist 'Konzert' (kein Podium) + content-Podium → genau 1 Podium
  assert.equal(podiums.length, 1);
});
t("buildModel: Events nach Tag/Zeit sortiert", () => {
  const m = buildModel(program, content);
  const key = (e) => (e.day || "") + " " + (e.start || "99");
  const times = m.events.map(key);
  assert.deepEqual(times, [...times].sort());
});
t("naturalRooms sortiert numerisch", () => {
  assert.deepEqual(
    naturalRooms(["SR 209", "SR 114", "HS 8", "SR 113", "HS 6", "MMZ 220"]),
    ["HS 6", "HS 8", "MMZ 220", "SR 113", "SR 114", "SR 209"]);
});

// ---------- LLM-Tagging: Merge-Logik + echte data/llm_tags.json ----------
import { applyLlmTags } from "../js/data.js";
import { TAGS, TAG_BY_ID } from "../js/lexicon.js";
import { tagStats } from "../js/mining.js";

const TAX_IDS = new Set(TAGS.map((t) => t.id));
t("applyLlmTags: Überschreibt nur wo LLM-Tags vorliegen, unbekannte ids verworfen", () => {
  const m = buildModel(program, content); // frisches Modell, Lexikon-Tags aktiv
  const se1Before = m.sessions.find((s) => s.id === "e1")._tags.slice();
  const llm = {
    meta: { model: "test", generated: "2026-09-24T12:00:00" },
    tags: {
      // Session 'x' existiert; 'e1' wird nicht getaggt; unbekannte id im topics-Array
      x: ["krieg", "nicht-in-der-taxonomie"],
    },
  };
  applyLlmTags(m, llm);
  const sx = m.sessions.find((s) => s.id === "x");
  assert.deepEqual(sx._llm_tags, ["krieg"]); // unbekannte id gefiltert
  assert.deepEqual(sx._tags, ["krieg"]);
  assert.equal(sx._tagSource, "llm");
  const se1 = m.sessions.find((s) => s.id === "e1");
  assert.deepEqual(se1._tags, se1Before); // Lexikon-Tags unverändert
  assert.equal(se1._tagSource, "lexikon");
  assert.equal(m.llmTagsApplied, 1);
  assert.equal(m.llmTagsMeta.model, "test");
});
t("applyLlmTags: ohne llm_tags.json-Objekt bleibt Lexikon aktiv", () => {
  const m = buildModel(program, content);
  applyLlmTags(m, null);
  assert.equal(m.llmTagsApplied, 0);
  assert.equal(m.llmTagsMeta, null);
  assert.ok(m.sessions.every((s) => s._tagSource === "lexikon"));
});
t("Kuratierte Sprachfelder bleiben bei LLM-Zuordnung erhalten", () => {
  const m = buildModel(program, { ...content, theme_tags: { x: ["suedslavisch", "unbekannt"] } });
  assert.ok(m.byId.x._tags.includes("suedslavisch"));
  applyLlmTags(m, { tags: { x: ["krieg"] } });
  assert.deepEqual(m.byId.x._tags, ["krieg", "suedslavisch"]);
  assert.equal(m.byId.x._tagSource, "llm+curated");
});
t("llm_tags.json: alle Vorträge vorhanden, alle tags ⊆ Taxonomie", () => {
  const llm = JSON.parse(fs.readFileSync(new URL("../data/llm_tags.json", import.meta.url), "utf8"));
  assert.ok(llm.meta && llm.meta.model, "Meta-Block fehlt");
  const talkIds = _model.sessions.filter((s) => s.type === "talk").map((s) => s.id);
  assert.equal(Object.keys(llm.tags).length, talkIds.length);
  for (const id of talkIds) assert.ok(Array.isArray(llm.tags[id]), `id fehlt: ${id}`);
  for (const [id, tags] of Object.entries(llm.tags)) {
    for (const t of tags) assert.ok(TAX_IDS.has(t), `unbekannte tag-id '${t}' bei ${id}`);
  }
});
t("llm_tags.json via applyLlmTags: Mining-Cluster übernehmen die LLM-Tags", () => {
  const llm = JSON.parse(fs.readFileSync(new URL("../data/llm_tags.json", import.meta.url), "utf8"));
  const m = buildModel(_prog, _content);
  applyLlmTags(m, llm);
  const talks = m.sessions.filter((s) => s.type === "talk");
  const stats = tagStats(talks); // Seam: nutzt s._tags
  const totalTags = [...stats.values()].reduce((a, b) => a + b, 0);
  const llmTagCount = talks.reduce((a, s) => a + s._tags.length, 0);
  assert.equal(totalTags, llmTagCount);
  assert.ok(m.llmTagsApplied >= talks.length * 0.9, `nur ${m.llmTagsApplied} von ${talks.length} LLM-getaggt`);
  for (const tagId of stats.keys()) assert.ok(TAG_BY_ID[tagId]);
});

// ---------- util
t("minutes", () => {
  assert.equal(minutes("09:30"), 570);
});
t("isoDay", () => {
  assert.equal(isoDay(new Date(2026, 9, 1, 7, 30)), "2026-10-01");
});
t("dateLabel", () => {
  assert.equal(dateLabel("2026-10-01"), "Donnerstag, 01.10.");
});

// ---------- Feature 1: Konflikt-Erkennung
import { conflictsByDay } from "../js/views/mine.js";
t("Konflikte: überlappende Favoriten erkannt", () => {
  const day = "2026-10-01";
  const pairs = _model.sessions.filter((x) => x.day === day);
  const a = pairs.find((x) => x.start === "14:00" && x.end === "14:30" && x.type !== "break");
  const b = pairs.find((x) => x.start === "14:00" && x.end === "14:30" && x !== a && x.type !== "break");
  assert.ok(a && b, "Testdaten: kein gleichzeitiges Paar gefunden");
  const { conflicts } = conflictsByDay(_model, [a.id, b.id]);
  // Konflikt-Map: beide IDs verweisen aufeinander
  assert.deepEqual((conflicts[a.id] || []).sort(), [b.id].sort());
  assert.deepEqual((conflicts[b.id] || []).sort(), [a.id].sort());
});
t("Konflikte: nacheinander = kein Konflikt", () => {
  const day = "2026-10-01";
  const a = _model.sessions.find((x) => x.day === day && x.start === "14:00" && x.end === "14:30" && x.type !== "break");
  const b = _model.sessions.find((x) => x.day === day && x.start === "14:30" && x.end === "15:00" && x.type !== "break");
  assert.ok(a && b, "Testdaten: kein 14:00/14:30-Paar gefunden");
  const { conflicts } = conflictsByDay(_model, [a.id, b.id]);
  assert.equal(conflicts[a.id], undefined);
  assert.equal(conflicts[b.id], undefined);
});

// ---------- Feature 2: isRunningNow
import { isRunningNow } from "../js/views/program.js";
t("isRunningNow: laufender Vortrag ja, davor/danach nein, außerhalb der Tagung nein", () => {
  const s = _model.sessions.find((x) => x.day === "2026-10-01" && x.start === "14:00" && x.end === "14:30");
  assert.ok(s, "Testdaten: Session fehlt");
  assert.equal(isRunningNow(_model, s, new Date("2026-10-01T14:10:00")), true);
  assert.equal(isRunningNow(_model, s, new Date("2026-10-01T13:59:00")), false);
  assert.equal(isRunningNow(_model, s, new Date("2026-10-01T14:30:00")), false);
  assert.equal(isRunningNow(_model, s, new Date("2026-09-20T14:10:00")), false);
});

// ---------- Feature 4: Sprecher-Index (Nachname-first)
import { nameParts, splitPeople, buildSpeakerIndex } from "../js/views/speakers.js";
t("nameParts: Nachname, Vorname", () => {
  assert.equal(nameParts("Barbara Sonnenhauser").display, "Sonnenhauser, Barbara");
  assert.equal(nameParts("Jakub M. Zygalski").display, "Zygalski, Jakub M.");
});
t("nameParts: Klammern-Zusatz bleibt erhalten", () => {
  assert.equal(nameParts("Liudmyla Mobius (Pidkuimukha)").display, "Mobius, Liudmyla (Pidkuimukha)");
  assert.equal(nameParts("Liudmyla Mobius (Pidkuimukha)").sortKey, "mobius, liudmyla");
});
t("splitPeople: Mehrpersonen-Feld wird gesplittet, Namen nicht", () => {
  assert.deepEqual(splitPeople("Arkady Kruglov, Tim-Robin Rösler-Bartsch"),
    ["Arkady Kruglov", "Tim-Robin Rösler-Bartsch"]);
  assert.deepEqual(splitPeople("Barbara Sonnenhauser"), ["Barbara Sonnenhauser"]);
});
t("Sprecher-Index: sortiert nach Nachname (erste 5 alphabetisch)", () => {
  const idx = buildSpeakerIndex(_model);
  assert.ok(idx.length >= 300, `nur ${idx.length} Einträge`);
  const keys = idx.map((p) => p.sortKey);
  assert.deepEqual(keys.slice(0, 5), [...keys.slice(0, 5)].sort((a, b) => a.localeCompare(b, "de")));
  assert.ok(idx[0].display.includes(","), "Anzeige im Format Nachname, Vorname");
});

await Promise.allSettled(pending);
console.log(`\n${n} Tests bestanden.`);
process.exit(failed ? 1 : 0);
