// Integrationstest: echte Daten durch die App-Logik. node tests/realdata.test.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildModel } from "../js/data.js";
import { normalize, filterSessions, makeSearchText } from "../js/search.js";
import { nowInfo } from "../js/now.js";
import { icsFor } from "../js/ics.js";
import { buildSpeakerIndex } from "../js/views/speakers.js";

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
t("ConfTool-Titeländerung von Fabian Erlenmaier ist im Programm", () => {
  const talk = m.sessions.find((s) => s.id === "2026-10-02-09:00-SR125-10:00");
  assert.equal(talk?.title,
    "Einblicke in den Fernseh-Strudel: Dekonstruktionen der Surkovschen Propaganda im russischen Theater");
  assert.deepEqual(talk.speakers, ["Fabian Erlenmaier"]);
  assert.equal(talk.start, "10:00");
  assert.equal(talk.room, "SR 125");
});
t("Gemeinsamer Vortrag: Chingiz Poletaev steht mit richtiger Einrichtung zuerst", () => {
  const talk = program.sessions.find((s) => s.conftool_paper_id === "342");
  assert.deepEqual(talk?.speakers,
    ["Chingiz Poletaev", "Tatjana Kurbangulova", "Olia Blacher"]);
  assert.deepEqual(talk.affiliations,
    ["Universität Konstanz, Deutschland", "Universität Innsbruck, Österreich", "Universität Jena, Deutschland"]);
});
t("Model: Panel-Überschrift ist kein Vortrag; Ergänzungen bleiben erhalten", () => {
  const sourceTalks = program.sessions.filter((s) => s.type === "talk");
  const placeholders = sourceTalks.filter((s) => !s.speakers?.length &&
    s.title === program.panels.find((p) => p.id === s.panel_id)?.title);
  assert.equal(m.sessions.filter((s) => s.type === "talk").length,
    sourceTalks.length - placeholders.length + content.program_supplements.sessions.filter((s) => s.type === "talk").length);
  assert.ok(!m.sessions.some((s) => s.type === "talk" && !s.speakers?.length && s.title === s.panel_title));
  assert.equal(m.sessions.filter((s) => s.type === "discussion").length, 1);
  assert.equal(Object.keys(m.panels).length, program.panels.length + content.program_supplements.panels.length);
});
t("Mehrteilige Panels bilden eine Gruppe über Slots und Tage", () => {
  const title = "Fremdsprachendidaktik slavischer Sprachen";
  const parts = Object.values(m.panels).filter((p) => p.title === title);
  assert.equal(parts.length, 4);
  const key = m.sessions.find((s) => s.panel_id === parts[0].id).panel_group;
  assert.equal(m.panelGroups.get(key).length, 4);
  const hits = filterSessions(m.sessions, { panel: key });
  assert.deepEqual([...new Set(hits.map((s) => s.day))], ["2026-10-01", "2026-10-02"]);
  assert.deepEqual(new Set(hits.map((s) => s.panel_id)), new Set(parts.map((p) => p.id)));
  assert.ok(!hits.some((s) => !s.speakers?.length && s.title === title));
  const other = Object.values(m.panels).filter((p) => p.title ===
    "Quantitative und qualitative Methoden in der Forschung zu slavischen Heritage Languages in Deutschland");
  assert.equal(m.panelGroups.get(m.sessions.find((s) => s.panel_id === other[0].id).panel_group).length, 3);
});
t("Gastarbajteri: ConfTool-Tippfehler trennt das Panel nicht", () => {
  const sourceParts = program.panels.filter((p) => /gastarbaj/i.test(p.title));
  assert.equal(sourceParts.length, 2);
  const partIds = new Set(sourceParts.map((p) => p.id));
  const corrected = sourceParts.map((p) => m.panels[p.id]);
  assert.ok(corrected.every((p) => p.title === "gastarbajteri"));
  const key = m.sessions.find((s) => s.panel_id === sourceParts[0].id).panel_group;
  assert.equal(m.panelGroups.get(key).length, 2);
  const hits = filterSessions(m.sessions, { panel: key });
  assert.equal(hits.length, 6);
  assert.deepEqual(new Set(hits.map((s) => s.panel_id)), partIds);
  assert.ok(hits.every((s) => s.panel_title === "gastarbajteri"));
  assert.equal(filterSessions(m.sessions, { q: "gastarbajteri" })
    .filter((s) => partIds.has(s.panel_id)).length, 6);
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
  for (const event of m.events) {
    if (event.room) assert.ok(m.rooms.includes(event.room), `${event.room} aus dem Programm-PDF fehlt im Raumfilter`);
  }
  for (const s of m.sessions) {
    if (s.room && s.room.startsWith("SR")) assert.equal(s.venue, "CZS3");
  }
});
t("Model: Events inklusive 12 Einträgen im Rahmenprogramm", () => {
  assert.ok(m.events.length >= 15, `nur ${m.events.length} Events`);
  assert.equal(m.events.filter((e) => e.type === "rahmen").length, 12);
  const guidedExhibitions = m.events.filter((e) =>
    e.day === "2026-10-02" && e.start === "14:00" && e.end === "15:30"
    && e.type === "rahmen" && e.title.toLowerCase().includes("ausstellung"));
  assert.equal(guidedExhibitions.length, 2);
  assert.ok(guidedExhibitions.every((e) => e.room === "Foyer CZS 3"));
  assert.ok(guidedExhibitions.some((e) => e.note.includes("Christoph Giesel")));
  assert.ok(guidedExhibitions.some((e) => e.note.includes("Dimiter Peev")));
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
  const heldenEvent = m.events.find((e) => e.title.startsWith("Helden unserer Zeit?"));
  assert.equal(heldenEvent, undefined, "LKW-Panel wird noch als Extra-Veranstaltung geführt");
  const helden = m.sessions.filter((s) => s.panel_title?.startsWith("Helden unserer Zeit?"));
  assert.deepEqual(helden.map((s) => `${s.start}|${s.end}|${s.room}|${s.discipline}`).sort(), [
    "12:00|12:30|SR 125|LKW",
    "12:30|13:00|SR 125|LKW",
    "14:00|14:30|SR 125|LKW",
    "14:30|15:00|SR 125|LKW",
    "15:00|15:30|SR 125|LKW",
  ]);
  assert.equal(helden.some((s) => s.start === "11:30"), false, "SR 125 muss bis 12:00 leer bleiben");
  assert.equal(m.events.some((e) => e.type === "event"), false);
});
t("Alle 23 Podiumsbeteiligten sind einzeln dem richtigen Podium zugeordnet", () => {
  const podiums = m.events.filter((e) => e.type === "podium");
  assert.deepEqual(podiums.map((e) => e.participants?.length), [7, 7, 5, 4]);
  const people = new Map(buildSpeakerIndex(m).map((person) => [person.raw, person]));
  for (const podium of podiums) {
    assert.equal(new Set(podium.participants.map((person) => person.name)).size,
      podium.participants.length, `doppelte Namen in ${podium.title}`);
    for (const participant of podium.participants) {
      assert.ok(podium.people.includes(participant.name),
        `${participant.name} fehlt im Beschreibungstext von ${podium.title}`);
      const person = people.get(participant.name);
      assert.ok(person, `${participant.name} fehlt in Personen A–Z`);
      assert.ok(person.podiumOf.some(({ event, role }) =>
        event.id === podium.id && role === participant.role),
      `${participant.name} ist nicht ${podium.title} zugeordnet`);
    }
  }
  assert.equal([...people.values()].reduce((sum, person) => sum + person.podiumOf.length, 0), 23);
});
t("Sonderformate: alle 17 Mitwirkungen sind in Personen A–Z verknüpft", () => {
  const specials = m.events.filter((event) => event.type === "special");
  assert.deepEqual(specials.map((event) => event.participants?.length), [6, 5, 2, 2, 1, 1]);
  const people = new Map(buildSpeakerIndex(m).map((person) => [person.raw, person]));
  const names = new Set();
  for (const event of specials) {
    assert.equal(new Set(event.participants.map((person) => person.name)).size,
      event.participants.length, `doppelte Namen in ${event.title}`);
    for (const participant of event.participants) {
      names.add(participant.name);
      const person = people.get(participant.name);
      assert.ok(person, `${participant.name} fehlt in Personen A–Z`);
      assert.ok(person.specialOf.some(({ event: listed, participant: listedPerson }) =>
        listed.id === event.id && listedPerson.role === participant.role),
      `${participant.name} ist ${event.title} nicht zugeordnet`);
    }
  }
  assert.equal(names.size, 16);
  assert.equal([...people.values()].reduce((sum, person) => sum + person.specialOf.length, 0), 17);
  assert.equal(people.get("Andreas Umland").specialOf.length, 2);
  assert.equal(people.get("Helene Jessula Wczesniak").talks.length, 0,
    "derselbe DFG-Auftritt erscheint doppelt als Vortrag und Sonderformat");
  assert.equal(specials.find((event) => event.title.includes("Russia’s War"))
    .participants.find((person) => person.name === "Tamara Hunderova").location, "München/Kyjiw");
});
t("Bekannte Einrichtungen aus der Anmeldeliste gelten in der App, nicht in der ConfTool-Datei", () => {
  assert.equal(content.person_affiliations["Florian Wandl"], "Universität Tübingen");
  assert.equal(content.person_affiliations["Björn Hansen"], "Universität Regensburg");
  assert.equal(content.person_affiliations["Dennis Dierks"], "Universität Leipzig");
  assert.ok(buildSpeakerIndex(m).some((person) => person.raw === "Florian Wandl"));
  assert.ok(buildSpeakerIndex(m).some((person) => person.raw === "Björn Hansen"));
  const florian = m.sessions.find((session) => session.speakers?.includes("Florian Wandl"));
  const florianSource = program.sessions.find((session) => session.id === florian.id);
  assert.ok(florian.affiliations.includes("Universität Tübingen"));
  assert.ok(florianSource.affiliations.includes("Universität Zürich, Schweiz"));
});
t("LKW-Panel Exilliteraturen: Miriam Finkelstein ist um 10:30 Discussant", () => {
  const discussion = m.sessions.find((s) => s.id === "curated-2026-10-02-SR223-10:30-discussant");
  assert.ok(discussion, "Diskussionsbeitrag fehlt");
  assert.equal(discussion.type, "discussion");
  assert.equal(discussion.role, "Discussant");
  assert.equal(discussion.start, "10:30");
  assert.equal(discussion.end, "11:00");
  assert.equal(discussion.room, "SR 223");
  assert.equal(discussion.discipline, "LKW");
  assert.deepEqual(discussion.speakers, ["Miriam Finkelstein"]);
  assert.ok(discussion.panel_title.startsWith("Slawische Exilliteraturen:"));
  const person = buildSpeakerIndex(m).find((entry) => entry.raw === "Miriam Finkelstein");
  assert.equal(person?.discussantOf.length, 1);
  assert.equal(person?.discussantOf[0].id, discussion.id);
});
t("Aktualisierter ConfTool-Abstract von Dimiter Peev ist in der App", () => {
  const peev = m.sessions.find((s) => s.speakers?.includes("Dimiter Peev"));
  assert.ok(peev, "Peev-Vortrag fehlt");
  assert.match(peev.abstract, /Hristofor Žefarovićs „Stemmatographia“/);
  assert.match(peev.abstract, /eigenständiges bulgarisches historisches Narrativ/);
});
t("Eröffnung/Festvortrag und musikalisches Buffet sind getrennte Formate", () => {
  const opening = m.events.find((e) => e.title.startsWith("Eröffnung des Slavistiktages"));
  assert.ok(opening, "Eröffnung fehlt");
  assert.equal(opening.type, "special");
  assert.deepEqual(opening.formats, ["special"]);
  assert.equal(opening.start, "18:00");
  assert.equal(opening.end, "20:00");
  assert.equal(opening.room, "HS 2");
  const music = m.events.find((e) => e.title === "Buffet mit musikalischer Begleitung im Foyer");
  assert.ok(music, "Musikalische Begleitung fehlt");
  assert.equal(music.type, "rahmen");
  assert.deepEqual(music.formats, ["rahmen"]);
  assert.equal(music.start, "20:00");
  assert.equal(music.end, "22:00");
  assert.equal(music.room, "Foyer CZS 3");
  const choir = m.events.find((e) => e.title.startsWith("Ukrainischer Chor"));
  assert.equal(choir?.end, "19:00");
  assert.equal(choir?.room, "Aula UHG");
  const posterTour = m.events.find((e) => e.title.includes("bulgarische Plakatkunst"));
  assert.equal(posterTour?.room, "Haus auf der Mauer");
  const closing = m.events.find((e) => e.title.startsWith("Abschlussveranstaltung"));
  assert.equal(closing?.room, "Foyer CZS 3");
});
t("Vortragssprachen: ausdrückliche Angaben aus dem Book of Abstracts haben Vorrang", () => {
  const bySpeaker = (name) => m.sessions.find((s) => s.speakers?.includes(name));
  assert.equal(bySpeaker("Nadiya Kiss")?._lang, "uk");
  assert.equal(bySpeaker("Nadiya Kiss")?._langSource, "declared");
  assert.equal(bySpeaker("Uliana Retzlaff")?._lang, "ru");
  assert.equal(bySpeaker("Uliana Retzlaff")?._langSource, "declared");
  assert.equal(bySpeaker("Liudmyla Mobius (Pidkuimukha)")?._lang, "uk");
  assert.equal(bySpeaker("Liudmyla Mobius (Pidkuimukha)")?._langSource, "declared");
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
t("now: Donnerstag zeigt Kaffee- und Mittagspausen sowie Rahmenprogramm", () => {
  const morning = nowInfo(m, new Date("2026-10-01T11:05:00"));
  assert.equal(morning.status, "break");
  assert.equal(morning.current.title, "Kaffeepause am Vormittag und Kurzvorstellung der Poster");
  const lunch = nowInfo(m, new Date("2026-10-01T13:05:00"));
  assert.equal(lunch.current.title, "Mittagspause");
  const afternoon = nowInfo(m, new Date("2026-10-01T15:35:00"));
  assert.equal(afternoon.current.title, "Kaffeepause am Nachmittag");
  const evening = nowInfo(m, new Date("2026-10-01T18:05:00"));
  assert.equal(evening.currentItems.filter((x) => x.type === "rahmen").length, 3);
  assert.equal(evening.nextItems.length, 0);
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
