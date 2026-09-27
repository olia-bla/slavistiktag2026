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
  assert.ok(document.querySelector(".site-footer").textContent.includes("Konferenz-App zum 15. Deutschen Slavistiktag"));
  assert.ok(document.querySelector(".site-footer").textContent.includes(
    "Diese App basiert auf einer von Prof. Dr. Achim Rabus entwickelten Vorlage. Dafür danken wir ihm herzlich."));
});
t("Startseite: kompakte Orientierung ohne doppelte Programmübersicht", () => {
  const actions = [...document.querySelectorAll("#app .dashboard-actions .btn")].map((el) => el.textContent);
  const resources = [...document.querySelectorAll("#app .dashboard-resource")].map((el) => el.textContent);
  assert.equal(document.querySelector("#app .dashboard-important h2")?.textContent, "Pläne & Downloads");
  assert.deepEqual(actions, []);
  assert.equal(document.querySelector("#app .now-card h2").textContent, "Jetzt / Als Nächstes");
  const nowText = document.querySelector("#app .now-card").textContent;
  assert.ok(nowText.includes("Die Tagung beginnt am Mittwoch, 30.09.2026."));
  assert.ok(nowText.includes("ab 12:00RegistrierungFoyer CZS 3"));
  assert.ok(nowText.includes("14:00–17:00Jahrestag des SlavistikverbandesHS 2"));
  assert.ok(nowText.includes("18:00–20:00Eröffnung des Slavistiktages mit FestvortragHS 2"));
  assert.equal(resources.length, 4);
  assert.ok(resources.some((text) => text.includes("Lageplan")));
  assert.ok(resources.some((text) => text.includes("Book of Abstracts")));
  const cityMap = [...document.querySelectorAll("#app .dashboard-resource")]
    .find((link) => link.textContent.includes("Stadtplan"));
  assert.equal(cityMap.href, "https://www.gw.uni-jena.de/phifakmedia/197439/stadtplan-jena-slavtag.pdf");
  assert.equal(document.querySelector("#app .highlight-list"), null);
  assert.equal([...document.querySelectorAll("#app h2")].some((el) => el.textContent === "Tage"), false);
  assert.equal([...document.querySelectorAll("#app h2")].some((el) => el.textContent === "Schnellzugriff"), false);
  assert.equal(document.querySelector("#app .dashboard-notice"), null, "leerer Änderungshinweis wird angezeigt");
});
t("Startseite: Notfallnummer und Kontakt-E-Mail sind direkt nutzbar", () => {
  const contact = document.querySelector("#app .dashboard-contact");
  assert.ok(contact.textContent.includes("Notfälle während der Tagung"));
  assert.equal(contact.querySelector('a[href="tel:+4915125881153"]')?.textContent, "☎ +49 151 25881153");
  assert.equal(contact.querySelector('a[href="mailto:slavistiktag2026@uni-jena.de"]')?.textContent,
    "✉ slavistiktag2026@uni-jena.de");
});
t("Startseite: Begrüßungen stehen zwischen Kontakt und App-Installation", () => {
  const contact = document.querySelector("#app .dashboard-contact");
  const welcome = document.querySelector("#app .welcome-wall");
  const install = document.querySelector("#app .dashboard-install");
  assert.equal(contact.nextElementSibling, welcome);
  assert.equal(welcome.nextElementSibling, install);
  assert.equal(install.querySelector("h2")?.textContent, "App installieren");
  assert.ok(install.textContent.includes("iPhone / iPad"));
  assert.ok(install.textContent.includes("Android"));
  assert.ok(install.textContent.includes("Computer"));
  assert.ok(install.textContent.includes("Zum Home-Bildschirm"));
});
t("Startseite: 14 Begrüßungen gleichmäßig auf zwei Zeilen verteilt", () => {
  const rows = [...document.querySelectorAll("#app .welcome-row")];
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.querySelectorAll(".welcome-word").length), [7, 7]);
  assert.equal(document.querySelectorAll("#app .welcome-word").length, 14);
  assert.ok(document.querySelector("#app .welcome-wall").textContent.includes("Herzlich willkommen in Jena!"));
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
  assert.equal(document.querySelector("#app .event-dates").textContent, "30.09. – 03.10. · Jena · Carl-Zeiss-Straße 3");
  assert.equal(document.querySelector(".topbar .brand-copy"), null);
  assert.equal(document.querySelector("#back-button"), null);
  assert.equal(document.querySelector("#forward-button"), null);
  assert.equal(document.querySelector(".history-bar"), null);
});
t("Nav mit 6 Einträgen (inkl. Themen + Sprecher:innen)", () => {
  const labels = [...document.querySelectorAll("#main-nav .nav-link")].map((a) => a.textContent.trim());
  assert.equal(labels.length, 6);
  assert.equal(labels[0], "Startseite");
  assert.equal(document.querySelector("#main-nav .nav-link")?.getAttribute("href"), "#/startseite");
  assert.equal(document.querySelector(".brand")?.getAttribute("href"), "#/startseite");
  assert.ok(labels.some((l) => l.includes("Themen")));
  assert.ok(labels.some((l) => l.includes("Sprecher:innen")));
  assert.ok(labels.includes("Orte"));
  assert.equal(document.querySelector(".fav-count").textContent, "");
});
dom.window.location.hash = "#/heute";
assert.equal(await waitFor(() => dom.window.location.hash === "#/startseite"), true);
t("Alte #/heute-Adresse wird auf #/startseite weitergeleitet", () => {
  assert.ok(document.querySelector("#app .view-dashboard"));
});

// Navigation: Programm
dom.window.location.hash = "#/programm";
await waitFor(() => document.querySelector("#app .filter-bar"));
t("Programm: Filterleiste + Grid gerendert", () => {
  assert.ok(document.querySelector("#app .filter-bar"));
  assert.ok(document.querySelector("#app .grid"));
  assert.equal(document.querySelector(".history-bar"), null);
  assert.ok(document.querySelector("#program-advanced-filters"));
  assert.equal(document.querySelector(".filter-toggle"), null);
});
t("Programmfilter: alle Auswahlfilter starten leer; Panel- und Sektionsfilter fehlen", () => {
  const categories = ["podium", "special", "rahmen", "pause"];
  assert.equal(categories.some((value) => document.querySelector(`input[value="${value}"]`)?.checked), false);
  assert.equal(document.querySelector('input[value="panel"]'), null);
  assert.equal(document.querySelector('input[value="sektion"]'), null);
  assert.equal(document.querySelector(".filter-bar").textContent.includes("Eingereichte Panels"), false);
  assert.equal(document.querySelector(".filter-bar").textContent.includes("Thematische Sektionen"), false);
});
t("Programm: Vortragskarten vorhanden", () => {
  assert.ok(document.querySelectorAll("#app .session-card").length > 10);
});
t("Programm: Tagesregister enthält alle Tage ohne Scroll-Steuerung", () => {
  const tabs = [...document.querySelectorAll("#app .day-tabs .chip")];
  assert.equal(tabs.length, 5);
  assert.equal(tabs[0].textContent, "Alle Tage");
  assert.equal(document.querySelector("#app .day-tabs").getAttribute("role"), "tablist");
});
t("Programm: Raumfilter enthält HS 2 aus dem offiziellen Programm, nicht den veralteten HS 5", () => {
  const rooms = [...document.querySelectorAll('select[aria-label="Raum"] option')]
    .map((option) => option.value).filter(Boolean);
  assert.ok(rooms.includes("HS 2"));
  assert.equal(rooms.includes("HS 5"), false);
});
t("Programm: Panels tragen die PDF-Fachfarben", () => {
  const cards = [...document.querySelectorAll("#app .session-card")];
  const panelCards = (title) => cards.filter((card) => card.textContent.includes(title));
  assert.ok(panelCards("Fremdsprachendidaktik slavischer Sprachen").some((card) => card.classList.contains("track-did")));
  assert.ok(panelCards("Sprache und Krieg").some((card) => card.classList.contains("track-sw")));
  assert.ok(panelCards("Changing Aesthetic Paradigms").some((card) => card.classList.contains("track-lkw")));
});
t("Programm-Raster: Pausen stehen chronologisch zwischen den Vortragsblöcken", () => {
  const children = [...document.querySelector("#app .grid").children];
  const indexOfTime = (time) => children.findIndex((el) => el.classList.contains("grid-time") && el.textContent === time);
  const indexOfPause = (title) => children.findIndex((el) =>
    el.classList.contains("grid-full") && el.querySelector(".event-card.type-break")?.textContent.includes(title));
  assert.ok(indexOfPause("Kaffeepause am Vormittag") > indexOfTime("10:30"));
  assert.ok(indexOfPause("Kaffeepause am Vormittag") < indexOfTime("11:30"));
  assert.ok(indexOfPause("Mittagspause") > indexOfTime("12:30"));
  assert.ok(indexOfPause("Mittagspause") < indexOfTime("14:00"));
});
t("Programm: Trefferzahl zählt sichtbare Pausen mit", () => {
  const visibleCards = document.querySelectorAll("#app .session-card, #app .event-card").length;
  const reported = Number.parseInt(document.querySelector("#app .results-head > span").textContent, 10);
  assert.equal(reported, visibleCards);
  assert.ok(document.querySelectorAll("#app .event-card.type-break").length > 0);
});
t("Programmfilter: Fachdidaktik blendet fachfremde Vorträge und Events aus", async () => {
  const did = document.querySelector('input[value="DID"]');
  did.click();
  await sleep(400);
  const cards = [...document.querySelectorAll("#app .session-card")];
  assert.ok(cards.length > 0);
  assert.equal(cards.every((card) => card.classList.contains("track-did")), true);
  assert.equal(document.querySelectorAll("#app .event-card").length, 0);
});
await sleep(450);
document.querySelector(".filter-options .btn").click();
await sleep(100);
t("Programmfilter: Zurücksetzen leert Fachfilter und blendet alle Kategorien ein", () => {
  const disciplines = ["DID", "SW", "LKW"];
  const categories = ["podium", "special", "rahmen", "pause"];
  assert.equal(disciplines.some((value) => document.querySelector(`input[value="${value}"]`)?.checked), false);
  assert.equal(categories.some((value) => document.querySelector(`input[value="${value}"]`)?.checked), false);
  assert.equal([...document.querySelectorAll(".filter-bar select")].some((select) => select.value), false);
  assert.ok(document.querySelector("#program-advanced-filters"));
  assert.ok(document.querySelectorAll("#app .session-card").length > 10);
  assert.equal([...document.querySelectorAll(".day-tabs .chip.active")]
    .some((el) => el.textContent === "Alle Tage"), true);
});
dom.window.location.hash = "#/programm?day=all";
await waitFor(() => [...document.querySelectorAll(".day-tabs .chip.active")].some((el) => el.textContent === "Alle Tage"));
t("Programm: Vortrag von Nadiya Kiss ist als Ukrainisch markiert", () => {
  const card = [...document.querySelectorAll(".session-card")]
    .find((el) => el.textContent.includes("Nadiya Kiss"));
  assert.ok(card, "Vortrag von Nadiya Kiss fehlt");
  assert.equal(card.querySelector(".pill.lang")?.textContent, "UK");
  assert.equal(card.querySelector(".pill.lang")?.title, "Vortragssprache: Ukrainisch");
});
const typoSearch = document.querySelector("#app .search-input");
typoSearch.value = "Kiss, Nadyia";
typoSearch.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
await sleep(400);
t("Programmsuche findet Nadiya Kiss auch als ‚Kiss, Nadyia‘", () => {
  const cards = [...document.querySelectorAll(".session-card")];
  assert.equal(cards.length, 1);
  assert.ok(cards[0].textContent.includes("Nadiya Kiss"));
});
typoSearch.value = "";
typoSearch.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
await sleep(400);
t("Programm: russische und weitere ukrainische Vortragssprache aus dem Abstractband", () => {
  const bySpeaker = (name) => [...document.querySelectorAll(".session-card")]
    .find((el) => el.textContent.includes(name));
  const russian = bySpeaker("Uliana Retzlaff");
  const ukrainian = bySpeaker("Liudmyla Mobius");
  assert.ok(russian, "Vortrag von Uliana Retzlaff fehlt");
  assert.equal(russian.querySelector(".pill.lang")?.textContent, "RU");
  assert.equal(russian.querySelector(".pill.lang")?.title, "Vortragssprache: Russisch");
  assert.ok(ukrainian, "Vortrag von Liudmyla Mobius fehlt");
  assert.equal(ukrainian.querySelector(".pill.lang")?.textContent, "UK");
  assert.equal(ukrainian.querySelector(".pill.lang")?.title, "Vortragssprache: Ukrainisch");
});
const russianCard = [...document.querySelectorAll(".session-card")]
  .find((el) => el.textContent.includes("Uliana Retzlaff"));
russianCard.click();
await sleep(50);
t("Detailfenster: russische Vortragssprache ist vollständig bezeichnet", () => {
  const badge = document.querySelector(".drawer .pill.lang");
  assert.equal(badge?.textContent, "RU");
  assert.equal(badge?.title, "Vortragssprache: Russisch");
});
document.querySelector(".drawer-close").click();
t("Programm: PDF-Zuordnung enthält vier Podien, Sonderformate und das ergänzte LKW-Panel", () => {
  assert.equal(document.querySelectorAll(".event-card.type-podium").length, 4);
  assert.equal(document.querySelectorAll(".event-card.type-special:not(.type-rahmen)").length, 6);
  assert.equal([...document.querySelectorAll(".event-card")]
    .some((card) => card.textContent.includes("Helden unserer Zeit?")), false);
  const helden = [...document.querySelectorAll(".session-card.track-lkw")]
    .filter((card) => card.textContent.includes("Helden unserer Zeit?"));
  assert.equal(helden.length, 5, "LKW-Panel ‚Helden unserer Zeit?‘ ist nicht vollständig");
  assert.equal(helden.some((card) => card.textContent.includes("11:30–12:00")), false);
  assert.ok(helden.some((card) => card.textContent.includes("12:00–12:30")));
  assert.ok(helden.some((card) => card.textContent.includes("12:30–13:00")));
});
t("Programm: Miriam Finkelstein steht Freitag um 10:30 als Discussant im LKW-Panel", () => {
  const card = [...document.querySelectorAll(".session-card.track-lkw")]
    .find((item) => item.textContent.includes("Miriam Finkelstein") && item.textContent.includes("Discussant"));
  assert.ok(card, "Discussant-Eintrag fehlt");
  assert.ok(card.textContent.includes("10:30–11:00"));
  assert.ok(card.textContent.includes("Slawische Exilliteraturen:"));
  assert.equal(card.textContent.includes("Sonderformat"), false);
});
document.querySelector('input[value="podium"]').click();
await sleep(400);
t("Programmfilter: Podiums-Häkchen zeigt ausschließlich die vier Podien", () => {
  assert.equal(document.querySelectorAll(".event-card.type-podium").length, 4);
  assert.equal(document.querySelectorAll("#app .session-card, #app .event-card").length, 4);
});
document.querySelector('input[value="podium"]').click();
await sleep(400);
t("Programmfilter: ohne Häkchen wird wieder alles angezeigt", () => {
  assert.equal(document.querySelectorAll(".event-card.type-podium").length, 4);
  assert.ok(document.querySelectorAll("#app .session-card").length > 300);
});
const categoryValues = ["podium", "special", "rahmen", "pause"];
const categoryExpected = { podium: 4, special: 15, rahmen: 10, pause: 7 };
for (const value of categoryValues) {
  document.querySelector(`input[value="${value}"]`).click();
  await sleep(400);
  t(`Programmfilter: ${value} zeigt exakt die zugeordnete Kategorie`, () => {
    assert.equal(document.querySelectorAll("#app .session-card, #app .event-card").length, categoryExpected[value]);
    if (value === "special") {
      assert.equal(document.querySelectorAll(".event-card.type-special").length, 6);
      assert.equal(document.querySelectorAll(".session-card.type-special").length, 9);
      assert.equal([...document.querySelectorAll(".session-card.type-special")]
        .filter((card) => card.textContent.includes("Posterpräsentationen")).length, 8);
      assert.ok([...document.querySelectorAll(".session-card.type-special")]
        .some((card) => card.textContent.includes("Sprachenlernen in Bewegung")));
      assert.equal([...document.querySelectorAll("#app .card-title")]
        .some((title) => title.textContent.includes("Helden unserer Zeit?")), false);
    }
  });
  document.querySelector(`input[value="${value}"]`).click();
  await sleep(400);
}
document.querySelector('input[value="podium"]').click();
document.querySelector('input[value="pause"]').click();
await sleep(400);
t("Programmfilter: mehrere Häkchen verbinden Kategorien mit Oder", () => {
  assert.equal(document.querySelectorAll(".event-card.type-podium").length, 4);
  assert.equal(document.querySelectorAll(".event-card.type-break").length, 7);
  assert.equal(document.querySelectorAll("#app .session-card, #app .event-card").length, 11);
});
document.querySelector(".filter-options .btn").click();
await sleep(100);
t("Programmfilter: Zurücksetzen entfernt alle Häkchen und zeigt alles", () => {
  assert.equal(categoryValues.some((value) => document.querySelector(`input[value="${value}"]`)?.checked), false);
  assert.ok(document.querySelectorAll("#app .session-card").length > 300);
});
const unfilteredProgramCount = document.querySelectorAll("#app .session-card, #app .event-card").length;
document.querySelector('input[value="DID"]').click();
document.querySelector('input[value="podium"]').click();
await sleep(400);
t("Programmfilter: Fachbereich und Veranstaltungsart werden gemeinsam eingeblendet", () => {
  const cards = [...document.querySelectorAll("#app .session-card, #app .event-card")];
  assert.ok(cards.some((card) => card.classList.contains("track-did")));
  assert.equal(document.querySelectorAll(".event-card.type-podium").length, 4);
  assert.ok(cards.every((card) =>
    card.classList.contains("track-did") || card.classList.contains("type-podium")));
});
document.querySelector(".filter-options .btn").click();
await sleep(100);
for (const value of ["SW", "LKW", "special", "pause"]) {
  document.querySelector(`input[value="${value}"]`).click();
}
await sleep(400);
t("Programmfilter: mehrere Fachbereiche und Formate sind gleichzeitig kombinierbar", () => {
  const cards = [...document.querySelectorAll("#app .session-card, #app .event-card")];
  assert.ok(cards.some((card) => card.classList.contains("track-sw")));
  assert.ok(cards.some((card) => card.classList.contains("track-lkw")));
  assert.ok(cards.some((card) => card.classList.contains("type-special")));
  assert.ok(cards.some((card) => card.classList.contains("type-break")));
  assert.ok(cards.every((card) =>
    card.classList.contains("track-sw") || card.classList.contains("track-lkw") ||
    card.classList.contains("type-special") || card.classList.contains("type-break")));
});
document.querySelector(".filter-options .btn").click();
await sleep(100);
for (const value of ["DID", "SW", "LKW", ...categoryValues]) {
  document.querySelector(`input[value="${value}"]`).click();
}
await sleep(400);
t("Programmfilter: alle sieben Häkchen zeigen wieder das vollständige Programm", () => {
  assert.equal(document.querySelectorAll("#app .session-card, #app .event-card").length, unfilteredProgramCount);
});
document.querySelector(".filter-options .btn").click();
await sleep(100);
t("Programmfilter: Zeit-Auswahl enthält die fünf gewünschten Zeitfenster", () => {
  const labels = [...document.querySelector('select[aria-label="Zeit"]').options].map((option) => option.textContent);
  assert.deepEqual(labels, ["Zeit", "09:00–11:00", "11:30–13:00", "14:00–15:30", "16:00–17:30", "nach dem Vortragsende"]);
});
const timeSelect = document.querySelector('select[aria-label="Zeit"]');
timeSelect.value = "16:00-17:30";
timeSelect.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
await sleep(400);
t("Programmfilter: Zeitfenster 16:00–17:30 enthält die 16-Uhr-Veranstaltungen", () => {
  const times = [...document.querySelectorAll("#app .card .time")].map((el) => el.textContent.slice(0, 5));
  assert.ok(times.includes("16:00"));
  assert.ok(times.every((time) => time >= "16:00" && time <= "17:30"));
});
timeSelect.value = "after-program";
timeSelect.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
await sleep(400);
t("Programmfilter: nach dem Vortragsende zeigt ausschließlich spätere Veranstaltungen", () => {
  const cards = [...document.querySelectorAll("#app .card")];
  assert.ok(cards.length > 0);
  assert.ok(cards.some((card) => card.textContent.includes("Buffet mit musikalischer Begleitung")));
  assert.ok(cards.some((card) => card.textContent.includes("Abschlussveranstaltung")));
  assert.equal(cards.some((card) => card.textContent.includes("Eröffnung des Slavistiktages")), false);
});
document.querySelector(".filter-options .btn").click();
await sleep(100);
dom.window.location.hash = "#/programm";
await waitFor(() => [...document.querySelectorAll(".day-tabs .chip.active")].every((el) => el.textContent !== "Alle Tage"));
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
t("Mein Programm: Kalenderexport ohne JSON-Sicherung", () => {
  const mine = document.querySelector("#app .view-mine");
  assert.equal(mine.querySelector(".backup-options"), null);
  assert.equal(mine.querySelectorAll(":scope > .btn-row button").length, 1);
  assert.ok(mine.querySelector(":scope > .btn-row button")?.textContent.includes("Kalender"));
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

// Eröffnungs-Event (Sonderformat 30.09.): Karte im Programm-Grid klicken ->
// Drawer mit Grußworten und dem im aktuellen Programm veröffentlichten HS 2.
dom.window.location.hash = "#/programm?day=2026-09-30";
await waitFor(() => [...document.querySelectorAll("#app .event-card")]
  .some((c) => c.querySelector(".card-title")?.textContent.includes("Eröffnung des Slavistiktages")));
const eroffCard = [...document.querySelectorAll("#app .event-card")]
  .find((c) => c.querySelector(".card-title")?.textContent.includes("Eröffnung des Slavistiktages"));
t("Eröffnungs-Event: Karte klickbar (data-id + onclick)", () => {
  assert.ok(eroffCard.getAttribute("data-id"), "Event-Karte ohne data-id");
  assert.ok(eroffCard.getAttribute("role") === "button", "Event-Karte nicht als button");
});
t("Eröffnungs-Event: ausschließlich Sonderformat", () => {
  const badges = [...eroffCard.querySelectorAll(".pill")].map((el) => el.textContent);
  assert.ok(badges.includes("Sonderformat"));
  assert.equal(badges.includes("Rahmenprogramm"), false);
  assert.ok(eroffCard.textContent.includes("18:00–20:00"));
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
t("Eröffnungs-Drawer: aktueller Raum HS 2", () => {
  const d = document.querySelector(".drawer");
  assert.equal(d.querySelector("a.pill.room")?.textContent.trim(), "HS 2");
  assert.equal(d.textContent.includes("Raum noch nicht bekanntgegeben"), false);
});
document.querySelector(".drawer-backdrop").click();
await waitFor(() => !document.querySelector(".drawer"));
const musicCard = [...document.querySelectorAll("#app .event-card")]
  .find((c) => c.querySelector(".card-title")?.textContent === "Buffet mit musikalischer Begleitung im Foyer");
t("Musikalische Begleitung: 20 Uhr im Foyer und ausschließlich Rahmenprogramm", () => {
  assert.ok(musicCard, "Musikalische Begleitung fehlt");
  const badges = [...musicCard.querySelectorAll(".pill")].map((el) => el.textContent);
  assert.ok(badges.includes("Rahmenprogramm"));
  assert.equal(badges.includes("Sonderformat"), false);
  assert.ok(musicCard.textContent.includes("20:00–22:00"));
  assert.ok(musicCard.textContent.includes("Foyer CZS 3"));
});
document.querySelector('input[value="special"]').click();
await sleep(400);
t("Sonderformat-Filter zeigt nur die Eröffnung am Mittwoch", () => {
  const titles = [...document.querySelectorAll("#app .event-card .card-title")].map((el) => el.textContent);
  assert.ok(titles.some((title) => title.includes("Eröffnung des Slavistiktages")));
  assert.equal(titles.includes("Buffet mit musikalischer Begleitung im Foyer"), false);
});
document.querySelector('input[value="special"]').click();
await sleep(400);
document.querySelector('input[value="rahmen"]').click();
await sleep(400);
t("Rahmenprogramm-Filter zeigt nur die musikalische Begleitung am Mittwoch", () => {
  const titles = [...document.querySelectorAll("#app .event-card .card-title")].map((el) => el.textContent);
  assert.equal(titles.some((title) => title.includes("Eröffnung des Slavistiktages")), false);
  assert.ok(titles.includes("Buffet mit musikalischer Begleitung im Foyer"));
});
document.querySelector('input[value="rahmen"]').click();
await sleep(400);
t("Beide Eröffnungs-Einträge erscheinen ohne Häkchen wieder", () => {
  const titles = [...document.querySelectorAll("#app .event-card .card-title")].map((el) => el.textContent);
  assert.ok(titles.some((title) => title.includes("Eröffnung des Slavistiktages")));
  assert.ok(titles.includes("Buffet mit musikalischer Begleitung im Foyer"));
});

// Podiumskarten tragen die ausführlichen Informationen nicht mehr auf der
// Info-Seite, sondern öffnen sie direkt dort, wo das Podium im Programm steht.
dom.window.location.hash = "#/programm?day=2026-10-01";
await waitFor(() => document.querySelector("#app .event-card.type-podium"));
const posterTourCard = [...document.querySelectorAll("#app .event-card")]
  .find((card) => card.textContent.includes("bulgarische Plakatkunst"));
t("Rahmenprogramm: Haus auf der Mauer ist als Raum anklickbar", () => {
  assert.ok(posterTourCard, "Führung zur Plakatkunst fehlt");
  const room = posterTourCard.querySelector("a.room-link");
  assert.equal(room?.textContent, "Haus auf der Mauer");
  assert.ok(room?.href.includes("mlat=50.9297151"));
  assert.ok(room?.href.includes("mlon=11.5840878"));
});
const podiumCard = document.querySelector("#app .event-card.type-podium");
t("Podium im Programm: Hinweis auf Beschreibung und Beteiligte", () => {
  assert.ok(podiumCard.textContent.includes("Antippen für Beschreibung und Beteiligte"));
});
podiumCard.click();
await waitFor(() => document.querySelector(".drawer .event-description"));
t("Podium-Drawer: vollständige Beschreibung und Beteiligte", () => {
  const drawer = document.querySelector(".drawer");
  assert.equal(drawer.querySelector(".event-description h3")?.textContent, "Beschreibung");
  assert.equal(drawer.querySelector(".event-people h3")?.textContent, "Beteiligte");
  assert.ok(drawer.textContent.includes("Krise der Philologien"));
  assert.ok(drawer.textContent.includes("Annelie Bachmaier"));
  assert.ok(drawer.textContent.includes("Kornelia Freitag"));
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

// Sprachen- und Themenkompass
dom.window.location.hash = "#/themen";
await waitFor(() => document.querySelector("#app .cluster-card"));
t("Sprachen- und Themenkompass: Cluster-Karten gerendert", () => {
  assert.ok(document.querySelectorAll("#app .cluster-card").length >= 15);
  assert.equal(document.querySelector("#app .topics-intro h1").textContent, "Sprachen- und Themenkompass");
  assert.match(document.querySelector("#app .topics-intro").textContent, /\d+ Beiträge in \d+ Sprach- und Themenfeldern/);
  assert.equal(document.querySelector('a[href="#/themen"]')?.textContent, "Sprachen & Themen");
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

dom.window.location.hash = "#/themen/suedslavisch";
await waitFor(() => document.querySelector("#app .view-cluster h1")?.textContent === "Südslavisch");
t("Serbischer Protest-Vortrag ist Südslavisch zugeordnet", () => {
  assert.ok(document.querySelector("#app .view-cluster").textContent.includes("Die Ästhetik des Protests: Ironie und Performativität"));
});

// Orte: bewusst nur Tagungsorte und Karten
dom.window.location.hash = "#/info";
await waitFor(() => document.querySelector("#app .view-info"));
t("Orte: kompakte Tagungsorte mit Karten", () => {
  assert.ok(document.querySelector("#app .venue-grid"));
  const info = document.querySelector("#app .view-info");
  assert.equal(info.querySelector("h1")?.textContent, "Tagungsorte & Karten");
  assert.ok(info.textContent.includes("Carl-Zeiss-Straße 3"));
  assert.ok(info.textContent.includes("HS 2"));
  assert.ok(info.textContent.includes("Foyer und HS 2 (EG), HS 6–8 (1. OG), Seminarräume (1. und 2. OG)"));
  const mapLinks = [...info.querySelectorAll(".venue-card a")];
  assert.equal(mapLinks.length, 4);
  assert.ok(mapLinks.every((link) => link.textContent.includes("Auf Karte öffnen")));
  assert.ok(mapLinks.every((link) => link.target === "_blank"));
});
t("Orte: keine redundanten Programm- und Downloadinhalte", () => {
  const headings = [...document.querySelectorAll("#app .view-info h2")].map((el) => el.textContent);
  assert.deepEqual(headings, []);
  assert.equal(document.querySelector("#app .downloads-card"), null);
  assert.equal(document.querySelector("#app .install-card"), null);
  assert.equal(document.querySelector("#app .view-info .podium"), null);
});

// Deep-Link: Filter in URL
dom.window.location.hash = "#/programm?day=2026-10-03&room=SR%20206";
await waitFor(() => document.querySelector("#app .grid"));
t("Deep-Link: Sa + SR 206 gefiltert", () => {
  const cards = [...document.querySelectorAll("#app .session-card")];
  assert.ok(cards.length >= 1 && cards.length <= 6, `${cards.length} Karten`);
});

localStorage.setItem("slavtag26.favs", "[]");
dom.window.location.hash = "#/mein";
await waitFor(() => document.querySelector("#app .view-mine"));
t("Mein Programm: leerer Zustand ohne JSON-Sicherung", () => {
  const mine = document.querySelector("#app .view-mine");
  assert.equal(mine.querySelector(".backup-options"), null);
  assert.equal(mine.querySelector(".btn-row"), null);
  assert.ok(mine.textContent.includes("Noch nichts gemerkt"));
});

await Promise.allSettled(pending);
console.log(`\n${n} Smoke-Tests bestanden.`);
process.exit(failed ? 1 : 0);
