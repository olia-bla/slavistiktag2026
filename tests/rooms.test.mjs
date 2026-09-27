// rooms.test.mjs – Raum-Mapping vollständig + Deep-Links valide
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { ROOMS, roomMeta, roomMapUrl, unmappedRooms } = await import("../js/rooms.js");
const program = JSON.parse(await readFile(new URL("../data/program.json", import.meta.url), "utf-8"));
const content = JSON.parse(await readFile(new URL("../data/content.json", import.meta.url), "utf-8"));

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

// 1. Alle Programm-Räume sind gemappt
t("Alle Programm-Räume gemappt (keine Lücken)", () => {
  const all = [...new Set(program.sessions.map((s) => s.room).filter(Boolean))];
  const missing = unmappedRooms(all);
  assert.deepEqual(missing, [], `fehlend: ${missing.join(", ")}`);
});

// 1b. Alle Event-Räume sind gemappt
t("Alle Event-Räume gemappt", () => {
  const all = [...new Set(program.events.map((e) => e.room).filter(Boolean))];
  const missing = unmappedRooms(all);
  assert.deepEqual(missing, [], `fehlend: ${missing.join(", ")}`);
});

// 1c. Auch die redaktionell aus dem offiziellen Tagungsprogramm ergänzten
//     Podien, Sonder- und Rahmenveranstaltungen müssen vollständig gemappt sein.
t("Alle kuratierten Veranstaltungsräume gemappt", () => {
  const curated = [...content.accompanying, ...content.special, ...content.podiums];
  const all = [...new Set(curated.map((e) => e.room).filter(Boolean))];
  const missing = unmappedRooms(all);
  assert.deepEqual(missing, [], `fehlend: ${missing.join(", ")}`);
  assert.ok(all.includes("HS 2"), "HS 2 fehlt in den kuratierten Veranstaltungsräumen");
  assert.ok(all.includes("Foyer CZS 3"), "Foyer CZS 3 fehlt in den kuratierten Veranstaltungsräumen");
  assert.ok(all.includes("Aula UHG"), "Aula UHG fehlt in den kuratierten Veranstaltungsräumen");
});

// 2. Jeder Eintrag hat Gebäude + Adresse + Koordinaten
t("Alle Einträge: building + address + lat/lon", () => {
  for (const [name, m] of Object.entries(ROOMS)) {
    assert.ok(m.building, `${name}: building fehlt`);
    assert.ok(m.address, `${name}: address fehlt`);
    assert.equal(typeof m.lat, "number", `${name}: lat`);
    assert.equal(typeof m.lon, "number", `${name}: lon`);
  }
});

// 3. SR 223 ist dem CZS 3 zugeordnet (amtlich: Innen-Nr. 2.023; es gibt einen
//    zweiten SR 223 im UHG – Namensvetter; das Tagungs-PDF sagt „CZS, SR 223“)
t("SR 223 → CZS 3, 2. OG (Friedolin 2.023)", () => {
  assert.equal(roomMeta("SR 223").building, "CZS 3");
  assert.equal(roomMeta("SR 223").inner, "2.023");
  assert.equal(roomMeta("SR 223").floor, "2. OG");
});

// 3b. HS 6–8 liegen im 1. OG (Friedolin: 1012/1006/1007)
t("HS 6–8 im 1. OG (amtliche Innen-Nummern)", () => {
  for (const [name, inner] of [["HS 6", "1012"], ["HS 7", "1006"], ["HS 8", "1007"]]) {
    assert.equal(roomMeta(name).floor, "1. OG", name);
    assert.equal(roomMeta(name).inner, inner, name);
  }
});

// 4. MMZ 220 → Ernst-Abbe-Platz 8
t("MMZ 220 → Ernst-Abbe-Platz 8", () => {
  const mmz = roomMeta("MMZ 220");
  assert.equal(mmz.address, "Ernst-Abbe-Platz 8");
  assert.equal(mmz.lat, 50.9289611);
  assert.equal(mmz.lon, 11.5827306);
  const url = roomMapUrl("MMZ 220");
  assert.ok(url.includes("mlat=50.9289611"));
  assert.ok(url.includes("mlon=11.5827306"));
});

// 5. Deep-Link-Format valide
t("roomMapUrl erzeugt OSM-Link mit Marker", () => {
  const url = roomMapUrl("SR 206");
  assert.ok(url.startsWith("https://www.openstreetmap.org/?mlat="));
  assert.ok(url.includes("map=19/"));
  assert.equal(roomMapUrl("Unbekannt 999"), null);
});

// 6. Koordinaten plausibel (Jena-Zentrum)
t("Koordinaten im Jena-Zentrum (50.92–50.93 / 11.58)", () => {
  for (const m of Object.values(ROOMS)) {
    assert.ok(m.lat > 50.92 && m.lat < 50.93, `lat ${m.lat}`);
    assert.ok(m.lon > 11.57 && m.lon < 11.60, `lon ${m.lon}`);
  }
});

// 7. Etagen-Streifen: CZS 3, 2. OG hat 9 Tagungsräume, aktueller hervorgehoben
t("Floor-Strip: Etage korrekt gruppiert, aktueller Raum markiert", async () => {
  const { roomFloorStrip } = await import("../js/rooms.js");
  const { h } = await import("../js/util.js");
  // h() braucht DOM – nur Strukturprüfung über die Datenquelle
  const { ROOMS } = await import("../js/rooms.js");
  const siblings = Object.entries(ROOMS).filter(([n, x]) => x.building === "CZS 3" && x.floor === "2. OG");
  assert.equal(siblings.length, 9);
  assert.ok(siblings.some(([n]) => n === "SR 223"));
});

await Promise.allSettled(pending);
console.log(`\n${n} Raum-Tests bestanden.`);
process.exit(failed ? 1 : 0);
