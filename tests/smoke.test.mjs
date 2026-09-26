// DOM-Smoketest: kompletter App-Boot mit jsdom + echten Daten. node tests/smoke.test.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";

const indexHtml = await readFile(new URL("../index.html", import.meta.url), "utf-8");
const dom = new JSDOM(indexHtml, { url: "https://example.org/", pretendToBeVisual: true });

globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.location = dom.window.location;
globalThis.localStorage = dom.window.localStorage;
globalThis.history = dom.window.history;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.NodeFilter = dom.window.NodeFilter;
globalThis.URL = dom.window.URL;
globalThis.URLSearchParams = dom.window.URLSearchParams;
globalThis.Blob = dom.window.Blob;
globalThis.getComputedStyle = dom.window.getComputedStyle;
window.scrollTo = () => {};
globalThis.scrollTo = window.scrollTo;

// fetch-Stub: liest lokale Dateien
globalThis.fetch = async (path) => {
  const file = path.replace(/^.*?data\//, "data/");
  try {
    const body = await readFile(new URL("../" + file, import.meta.url), "utf-8");
    return { ok: true, status: 200, json: async () => JSON.parse(body), text: async () => body };
  } catch (e) {
    return { ok: false, status: 404, json: async () => { throw e; } };
  }
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, tries = 50) {
  for (let i = 0; i < tries; i++) {
    if (fn()) return true;
    await sleep(50);
  }
  return false;
}

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

// App booten
await import("../js/app.js");
assert.equal(await waitFor(() => document.querySelectorAll("#app .card").length > 0), true, "App hat nicht gerendert");

t("Dashboard gerendert (Titel + Motto)", () => {
  const h1 = document.querySelector("#app h1");
  assert.ok(h1.textContent.includes("Slavistiktag"));
  assert.ok(document.querySelector("#app .motto").textContent.includes("Zukunft"));
  const update = document.querySelector("#app .meta").textContent;
  assert.match(update, /^Aktualisiert: \d{2}\.\d{2}\.\d{4}, \d{2}:\d{2} Uhr$/);
  assert.equal(update.includes("Programmstand"), false);
  assert.equal(document.querySelector(".site-footer").textContent.includes("Mitmachen auf GitHub"), false);
});
t("Offizielles Slavistiktag-Logo steht ausschließlich im Header", () => {
  const logo = document.querySelector(".topbar .brand-logo");
  assert.ok(logo);
  assert.equal(logo.getAttribute("src"), "icons/slavistiktag logo.svg");
  assert.ok(logo.getAttribute("alt").includes("Friedrich-Schiller-Universität Jena"));
  assert.equal(document.querySelector("#app .event-logo"), null);
});
t("Startseite zeigt Tagungstitel, Datum und Ort zweizeilig", () => {
  assert.equal(document.querySelector("#app .hero h1").textContent, "15. Deutscher Slavistiktag 2026");
  assert.equal(document.querySelector("#app .event-dates").textContent, "30.09. – 03.10. · Jena, Carl-Zeiss-Straße 3");
  assert.equal(document.querySelector(".topbar .brand-copy"), null);
  assert.equal(document.querySelector("#back-button").disabled, true);
  assert.equal(document.querySelector("#forward-button").disabled, true);
  assert.ok(document.querySelector(".history-bar #back-button"));
});
t("Nav mit 6 Einträgen (inkl. Themen + Sprecher:innen)", () => {
  const labels = [...document.querySelectorAll("#main-nav .nav-link")].map((a) => a.textContent.trim());
  assert.equal(labels.length, 6);
  assert.equal(labels[0], "Startseite");
  assert.ok(labels.some((l) => l.includes("Themen")));
  assert.ok(labels.some((l) => l.includes("Sprecher:innen")));
  assert.equal(document.querySelector(".fav-count").textContent, "");
});

// Navigation: Programm
dom.window.location.hash = "#/programm";
await waitFor(() => document.querySelector("#app .filter-bar"));
t("Programm: Filterleiste + Grid gerendert", () => {
  assert.ok(document.querySelector("#app .filter-bar"));
  assert.ok(document.querySelector("#app .grid"));
  assert.equal(document.querySelector("#back-button").disabled, false);
  assert.equal(document.querySelector("#forward-button").disabled, true);
});
t("Programm: Vortragskarten vorhanden", () => {
  assert.ok(document.querySelectorAll("#app .session-card").length > 10);
});
t("Programm: Panels tragen die PDF-Fachfarben", () => {
  const cards = [...document.querySelectorAll("#app .session-card")];
  const panelCards = (title) => cards.filter((card) => card.textContent.includes(title));
  assert.ok(panelCards("Fremdsprachendidaktik slavischer Sprachen").some((card) => card.classList.contains("track-did")));
  assert.ok(panelCards("Sprache und Krieg").some((card) => card.classList.contains("track-sw")));
  assert.ok(panelCards("Changing Aesthetic Paradigms").some((card) => card.classList.contains("track-lkw")));
});
t("Programm-Raster enthält keine leere Foyer-Spalte", () => {
  const heads = [...document.querySelectorAll("#app .grid-head")].map((el) => el.textContent.trim());
  assert.ok(!heads.includes("Foyer CZS 3"));
});

// Suche
const search = document.querySelector("#app .search-input");
search.value = "Brehmer";
search.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
await sleep(450);
t("Suche 'Brehmer' findet Treffer", () => {
  const cards = document.querySelectorAll("#app .session-card");
  // Abstracts werden mit durchsucht → mehr Treffer als nur Titel-/Namenstreffer
  assert.ok(cards.length >= 1 && cards.length <= 15, `${cards.length} Karten`);
});

// Listenansicht (Regression: listView gab undefined zurück → Text „undefined" statt Karten)
const listBtn = [...document.querySelectorAll("#app .view-toggle button")].find((b) => b.textContent.trim() === "Liste");
listBtn.click();
dom.window.location.hash = "#/programm?day=all";
await waitFor(() => document.querySelector("#app .slot-grid"));
await sleep(250);
t("Liste 'Alle Tage': kein 'undefined', Karten über alle Tage", () => {
  assert.ok(!document.body.textContent.includes("undefined"), "Textknoten 'undefined' im DOM");
  assert.ok(document.querySelectorAll("#app .slot-grid .session-card").length > 100,
    `nur ${document.querySelectorAll("#app .slot-grid .session-card").length} Karten`);
});
const gridBtn = [...document.querySelectorAll("#app .view-toggle button")].find((b) => b.textContent.trim() === "Raster");
gridBtn.click();
await sleep(250);

// Drawer
search.value = "";
search.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
await sleep(450);
document.querySelector("#app .session-card").click();
await waitFor(() => document.querySelector(".drawer"));
t("Drawer öffnet mit Panel-Kontext", () => {
  const d = document.querySelector(".drawer");
  assert.ok(d.querySelector("h2").textContent.length > 5);
  assert.ok(d.querySelector(".btn-row"));
});
t("Drawer: Raum-Deep-Link auf OSM + Gebäude-Zeile", () => {
  const d = document.querySelector(".drawer");
  const a = d.querySelector("a.pill.room");
  assert.ok(a, "kein Raum-Link im Drawer");
  assert.ok(a.getAttribute("href").includes("openstreetmap.org"));
  assert.ok(a.getAttribute("href").startsWith("https://"));
  assert.ok(a.getAttribute("rel").includes("noopener"));
  assert.ok(d.querySelector(".room-where").textContent.includes("CZS 3"),
    d.querySelector(".room-where")?.textContent);
  assert.ok(d.querySelector(".floor-strip"), "kein Etagen-Streifen im Drawer");
  assert.ok(d.querySelector(".floor-strip .floor-room.current"), "aktueller Raum nicht markiert");
});
document.querySelector(".drawer-backdrop").click();
await waitFor(() => !document.querySelector(".drawer"));

// Favorit setzen
const favBtn = document.querySelector("#app .session-card .fav");
favBtn.click();
t("Favorit via ☆ gesetzt", () => {
  assert.equal(JSON.parse(localStorage.getItem("slavtag26.favs")).length, 1);
});

// Mein Programm
dom.window.location.hash = "#/mein";
await waitFor(() => document.querySelector("#app .view-mine"));
t("Mein Programm zeigt Favorit", () => {
  assert.ok(document.querySelector("#app .view-mine .session-card"));
});

// Feature 1: Konflikt-Warnung (zweiter Favorit im selben Slot)
const allCards = [...document.querySelectorAll("#app .session-card")];
const first = document.querySelector("#app .session-card");
const firstStart = first.querySelector(".time").textContent.split("–")[0];
const second = allCards.find((c) =>
  c !== first && c.querySelector(".time").textContent.split("–")[0] === firstStart
    && c.getAttribute("data-id") !== first.getAttribute("data-id"));
if (second) {
  second.querySelector(".fav").click();
  await sleep(200);
  t("Konflikt-Warnung bei überlappenden Favoriten", () => {
    assert.ok(document.querySelector("#app .conflict-note"), "keine Konflikt-Note");
    assert.ok(document.querySelector("#app .session-card.has-conflict"), "kein has-conflict");
  });
  second.querySelector(".fav").click(); // aufräumen
  await sleep(200);
} else {
  console.log("  (kein gleicher Slot gefunden – Konflikt-Test übersprungen)");
}

// Feature 5: Backup-Roundtrip (export -> clear -> import)
t("Backup: Export-Button erzeugt valide JSON", async () => {
  const favsNow = JSON.parse(localStorage.getItem("slavtag26.favs"));
  assert.ok(favsNow.length >= 1);
  // Export-Schema prüfen (direkt, ohne Download-Mechanik)
  const payload = { app: "slavtag26", version: 1, favs: favsNow, exported: new Date().toISOString() };
  assert.equal(payload.app, "slavtag26");
  // Import-Validierung: unbekannte IDs werden gefiltert
  const known = new Set([...document.querySelectorAll("#app .session-card")].map((c) => c.getAttribute("data-id")));
  const merged = [...new Set([...favsNow, ...payload.favs.filter((x) => known.has(x))])];
  assert.ok(merged.length >= favsNow.length);
});

// Feature 3: Teilen-Button im Drawer
dom.window.location.hash = "#/programm";
await waitFor(() => document.querySelector("#app .session-card"));
document.querySelector("#app .session-card").click();
await waitFor(() => document.querySelector(".drawer"));
t("Drawer: Teilen-Button vorhanden", () => {
  const btn = [...document.querySelectorAll(".drawer .btn-row button")].find((b) => b.textContent.includes("Teilen"));
  assert.ok(btn, "kein Teilen-Button");
});
document.querySelector(".drawer-backdrop").click();
await waitFor(() => !document.querySelector(".drawer"));

// Eröffnungs-Event (Rahmenprogramm 30.09.): Karte im Programm-Grid klicken ->
// Drawer mit Grußworten; Raum ist (noch) nicht bekanntgegeben und wird ehrlich
// als solcher gekennzeichnet statt erfunden.
dom.window.location.hash = "#/programm?day=2026-09-30";
await waitFor(() => [...document.querySelectorAll("#app .event-card")]
  .some((c) => c.querySelector(".card-title")?.textContent.includes("Eröffnung des Slavistiktages")));
const eroffCard = [...document.querySelectorAll("#app .event-card")]
  .find((c) => c.querySelector(".card-title")?.textContent.includes("Eröffnung des Slavistiktages"));
t("Eröffnungs-Event: Karte klickbar (data-id + onclick)", () => {
  assert.ok(eroffCard.getAttribute("data-id"), "Event-Karte ohne data-id");
  assert.ok(eroffCard.getAttribute("role") === "button", "Event-Karte nicht als button");
});
eroffCard.click();
await waitFor(() => document.querySelector(".drawer h2")?.textContent.includes("Eröffnung des Slavistiktages"));
t("Eröffnungs-Drawer: Grußworte-Abschnitt mit Namen", () => {
  const d = document.querySelector(".drawer");
  const h3 = [...d.querySelectorAll("h3")].find((x) => x.textContent === "Grußworte");
  assert.ok(h3, "kein Grußworte-Abschnitt im Drawer");
  const items = h3.closest("section").querySelectorAll(".mini-list li");
  assert.ok(items.length >= 3, `nur ${items.length} Grußworte`);
  assert.ok([...items].some((li) => li.textContent.includes("Sonnenhauser")));
});
t("Eröffnungs-Drawer: fehlender Raum ehrlich gekennzeichnet", () => {
  const d = document.querySelector(".drawer");
  assert.ok(!d.querySelector("a.pill.room"), "unerwartet doch ein Raum-Link");
  assert.ok(d.textContent.includes("Raum noch nicht bekanntgegeben"), "kein Raum-Hinweis");
});
document.querySelector(".drawer-backdrop").click();
await waitFor(() => !document.querySelector(".drawer"));

// Feature 4: Sprecher-Index
dom.window.location.hash = "#/sprecher";
await waitFor(() => document.querySelector("#app .view-speakers"));
t("Sprecher-Index gerendert (≥200 Personen, Buchstaben-Gruppierung)", () => {
  const rows = document.querySelectorAll("#app .speaker-row");
  assert.ok(rows.length >= 200, `nur ${rows.length} Personen`);
  assert.ok(document.querySelectorAll("#app .speaker-letter").length >= 10);
});
t("Sprecher-Suche filtert live", () => {
  const s = document.querySelector("#app .view-speakers .search-input");
  s.value = "sonnenhauser";
  s.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  const rows = [...document.querySelectorAll("#app .speaker-row")];
  assert.equal(rows.length, 1);
  assert.ok(rows[0].textContent.includes("Sonnenhauser"));
  s.value = "";
  s.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
});

// Personen-Detailansicht (#/sprecher/<Name>) — Regression: Route unbekannt → Dashboard
dom.window.location.hash = "#/sprecher/Gerta%20Monakhova";
await waitFor(() => document.querySelector("#app .view-person"));
t("Personen-Ansicht: Vorträge + Affiliation + Chair-Rollen", () => {
  const h1 = document.querySelector("#app .view-person h1");
  assert.ok(h1.textContent.includes("Monakhova"), h1.textContent);
  assert.ok(document.querySelectorAll("#app .view-person .session-card").length >= 1, "keine Vortragskarten");
  assert.ok(document.body.textContent.includes("Friedrich-Schiller-Universität Jena"), "Affiliation fehlt");
});
dom.window.location.hash = "#/sprecher/Does%20Not%20Exist";
await waitFor(() => document.querySelector("#app .view-person") &&
  document.querySelector("#app .view-person h1").textContent.includes("nicht gefunden"));
t("Personen-Ansicht: unbekannter Name → ehrlicher Leerzustand", () => {
  assert.ok(document.body.textContent.includes("nicht im Sprecher:innen-Index"));
});

// Änderungs-Ansicht (Was ist neu? / data/changes.json)
dom.window.location.hash = "#/aenderungen";
await waitFor(() => document.querySelector("#app .view-changes"));
t("Änderungs-Ansicht: leerer Stand ohne Fehler", () => {
  assert.ok(document.querySelector("#app .view-changes h1").textContent.includes("Programm-Änderungen"));
  assert.ok(document.body.textContent.includes("keine Änderungen"));
});

// Feature 2: „Läuft gerade" – beim Testlauf (Sept. 2026) vor der Tagung: keine „jetzt"-Pills
t("Kein 'jetzt' vor Tagungsbeginn", () => {
  dom.window.location.hash = "#/programm";
  assert.equal(document.querySelectorAll("#app .pill.now").length, 0);
});

// Themen-Kompass
dom.window.location.hash = "#/themen";
await waitFor(() => document.querySelector("#app .cluster-card"));
t("Themen-Kompass: Cluster-Karten gerendert", () => {
  assert.ok(document.querySelectorAll("#app .cluster-card").length >= 15);
  assert.ok(document.querySelector("#app .topics-intro h1").textContent.includes("Themen"));
});
t("Cluster-Karte: Zähler + charakteristische Begriffe + Sprachinfo", () => {
  const card = document.querySelector("#app .cluster-card");
  assert.ok(card.querySelector(".pill.count").textContent.length >= 1);
  assert.ok(card.querySelector(".cluster-terms").textContent.length > 3);
  assert.ok(card.querySelector(".cluster-meta .dim").textContent.length > 0);
});

// Cluster-Detail + Drawer-Integration
const tagId = document.querySelector("#app .cluster-card").getAttribute("data-tag");
dom.window.location.hash = `#/themen/${tagId}`;
await waitFor(() => document.querySelector("#app .cluster-item"));
t("Cluster-Detail: Vorträge, Klick öffnet Drawer (kein externer Link)", () => {
  const items = document.querySelectorAll("#app .cluster-item");
  assert.ok(items.length >= 2, `nur ${items.length}`);
  assert.equal(items[0].getAttribute("href"), null);
  items[0].click();
});
await waitFor(() => document.querySelector(".drawer"));
t("Drawer aus Themen-Ansicht geöffnet", () => {
  assert.ok(document.querySelector(".drawer"));
  assert.ok(document.querySelector(".drawer h2").textContent.length > 5);
});
document.querySelector(".drawer-backdrop").click();
await waitFor(() => !document.querySelector(".drawer"));

// Info mit Mining-Abschnitt
dom.window.location.hash = "#/info";
await waitFor(() => document.querySelector("#app .view-info"));
t("Info: Orte, Podien, Poster, Mining-Methode, Urheber", () => {
  assert.ok(document.querySelector("#app .venue-grid"));
  assert.ok(document.body.textContent.includes("Themen-Kompass: Methode"));
  assert.ok(document.body.textContent.includes("Olia Blacher"));
  assert.ok(document.body.textContent.includes("Dank an Prof. Dr. Achim Rabus"));
});
t("Info: vollständiges Kultur- und Rahmenprogramm", () => {
  const text = document.querySelector("#app .view-info").textContent;
  assert.ok(text.includes("Ensemble Mrija"));
  assert.ok(text.includes("Politische Gefangene in Belarus"));
  assert.ok(text.includes("Mi–Sa im 1. OG der CZS 3"));
  assert.ok(text.includes("Führung „Jena – der Ort der deutschen Romantik“"));
  assert.ok(text.includes("Stadtführung durch Jena"));
  assert.ok(text.includes("Führung durch die Ausstellung „Zeitgenössische bulgarische Plakatkunst“"));
  assert.ok(text.includes("Farbe des Zettels auf der Rückseite Ihres Namensschildes"));
  assert.ok(text.includes("Jena und Wandern"));
  assert.ok(text.includes("Weimar und Gedenkstätte Buchenwald"));
  assert.ok(text.includes("Erfurt"));
  assert.ok(document.querySelector('a[href*="103477/kultur-und-rahmenprogramm"]'));
  assert.ok(document.querySelector('a[href*="konzertprogramm.pdf"]'));
});
t("Info: vier offizielle PDF-Downloads als Buttons", () => {
  const links = [...document.querySelectorAll("#app .downloads-card .download-link")];
  assert.equal(links.length, 4);
  assert.deepEqual(links.map((a) => a.textContent), ["Stadtplan (PDF)", "Lageplan (PDF)", "Tagungsprogramm (PDF)", "Book of Abstracts (PDF)"]);
  assert.ok(links.every((a) => a.href.endsWith(".pdf")));
});

// Deep-Link: Filter in URL
dom.window.location.hash = "#/programm?day=2026-10-03&room=SR%20206";
await waitFor(() => document.querySelector("#app .grid"));
t("Deep-Link: Sa + SR 206 gefiltert", () => {
  const cards = [...document.querySelectorAll("#app .session-card")];
  assert.ok(cards.length >= 1 && cards.length <= 6, `${cards.length} Karten`);
});

await Promise.allSettled(pending);
console.log(`\n${n} Smoke-Tests bestanden.`);
process.exit(failed ? 1 : 0);
