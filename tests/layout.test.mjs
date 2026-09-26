// Layout-Tests mit echtem Chromium: Überlauf, Theming, Responsivität.
// Startet eigenen http.server. node tests/layout.test.mjs
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { spawn, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8127;
// Windows: shell:true → server.pid ist die Shell, kill() tötet sie, aber NICHT den
// eigentlichen Python-Child. Folge: Zombie-http.server auf PORT, beim nächsten Lauf
// „Address already in use" → Testläufe hängen scheinbar ewig. taskkill /T beendet
// den kompletten Prozessbaum zuverlässig. (Linux/CI: python3, kein taskkill nötig.)
const PY = process.platform === "win32" ? "python" : "python3";
const server = spawn(PY, ["-m", "http.server", String(PORT)], { cwd: ROOT, shell: true, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 1800));

// Windows: shell:true → server.pid ist die Shell, kill() tötet sie, aber NICHT den
// eigentlichen Python-Child. Folge: Zombie-http.server auf PORT, beim nächsten Lauf
// „Address already in use" → Testläufe hängen scheinbar ewig. taskkill /T beendet
// den kompletten Prozessbaum zuverlässig.
function killServer() {
  try { execSync(`taskkill /PID ${server.pid} /T /F`, { stdio: "ignore" }); } catch { /* schon tot */ }
}

const BASE = `http://localhost:${PORT}/`;
const VIEWPORTS = [
  { name: "Android-M 360", width: 360, height: 800, mobile: true },
  { name: "iPhone 390", width: 390, height: 844, mobile: true, iphone: true },
  { name: "iPad 820", width: 820, height: 1180, mobile: true },
  { name: "Desktop 1280", width: 1280, height: 800 },
  { name: "Desktop 1920", width: 1920, height: 1080 },
];

let n = 0, failures = 0;
async function t(name, fn) {
  try { await fn(); n++; console.log("  ok", name); }
  catch (e) { failures++; console.log("  FAIL", name, "::", (e.message || e).split?.("\n")[0] || e); }
}

async function overflowIssues(page) {
  return page.evaluate(() => {
    const out = [];
    const doc = document.documentElement;
    if (doc.scrollWidth > doc.clientWidth + 1) {
      out.push(`Dokument scrollt horizontal: ${doc.scrollWidth} > ${doc.clientWidth}`);
    }
    const inScrollableX = (el) => {
      for (let p = el.parentElement; p; p = p.parentElement) {
        const s = getComputedStyle(p);
        if (/(auto|scroll)/.test(s.overflowX) && p.scrollWidth > p.clientWidth) return true;
      }
      return false;
    };
    const selectors = ".card, .cluster-card, .cluster-item, .topics-intro, .topbar, .history-bar, .cluster-list";
    for (const el of document.querySelectorAll(selectors)) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.right > window.innerWidth + 1 && !inScrollableX(el)) {
        out.push(`${(el.className || el.tagName).toString().split(" ")[0]} ragt rechts heraus (+${Math.round(r.right - window.innerWidth)}px)`);
      }
    }
    return [...new Set(out)];
  });
}

const browser = await chromium.launch();
for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    isMobile: vp.mobile, hasTouch: vp.mobile, deviceScaleFactor: 2,
    colorScheme: "dark",
    userAgent: vp.iphone
      ? "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
      : undefined,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    // Playwright meldet fehlgeschlagene Subressourcen (z.B. optionale JSON-Dateien
    // wie data/changes.json) als console-error mit line 0 — nicht als pageerror.
    // Solche Netz-Fehler sind keine JS-Fehler der App und werden hier ignoriert.
    if (m.type() === "error" && m.location().line !== 0) errors.push(m.text());
  });

  console.log(`\n=== ${vp.name} ===`);
  await page.goto(BASE + "#/heute");
  await page.waitForSelector("#app .card");

  await t(`${vp.name}: Dashboard ohne Überlauf`, async () => {
    assert.deepEqual(await overflowIssues(page), []);
  });
  await t(`${vp.name}: Logo links oben, Navigation unten`, async () => {
    const ui = await page.evaluate(() => {
      const logo = document.querySelector(".brand-logo").getBoundingClientRect();
      const bar = document.querySelector(".history-bar").getBoundingClientRect();
      const icon = document.querySelector(".theme-icon").getBoundingClientRect();
      const label = document.querySelector(".theme-label").getBoundingClientRect();
      return {
        logoLeft: logo.left,
        barBottom: bar.bottom,
        height: innerHeight,
        backDisabled: document.querySelector("#back-button").disabled,
        forwardDisabled: document.querySelector("#forward-button").disabled,
        themeIconBeforeLabel: icon.left < label.left,
        sunVisible: getComputedStyle(document.querySelector(".theme-symbol-sun")).display !== "none",
        emptyFavoriteCountHidden: getComputedStyle(document.querySelector(".fav-count")).display === "none",
      };
    });
    assert.ok(Math.abs(ui.barBottom - ui.height) <= 1);
    assert.equal(ui.backDisabled, true);
    assert.equal(ui.forwardDisabled, true);
    assert.equal(ui.themeIconBeforeLabel, true);
    assert.equal(ui.sunVisible, true);
    assert.equal(ui.emptyFavoriteCountHidden, true);
    if (vp.width <= 760) assert.ok(ui.logoLeft <= 16, `Logo beginnt erst bei ${ui.logoLeft}px`);
  });
  await t(`${vp.name}: keine JS-Fehler`, () => assert.deepEqual(errors, []));
  await t(`${vp.name}: alle Menüpunkte vollständig sichtbar`, async () => {
    const menu = await page.evaluate(() => {
      const nav = document.querySelector("#main-nav");
      const links = [...nav.querySelectorAll(".nav-link")];
      const allInViewport = links.every((link) => {
        const r = link.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.left >= -1 && r.right <= innerWidth + 1 && r.top >= -1 && r.bottom <= innerHeight + 1;
      });
      return { count: links.length, allInViewport, noHorizontalScroll: nav.scrollWidth <= nav.clientWidth + 1 };
    });
    assert.equal(menu.count, 6);
    assert.equal(menu.allInViewport, true);
    assert.equal(menu.noHorizontalScroll, true);
  });

  // Themen-Kompass
  await page.evaluate(() => { location.hash = "#/themen"; });
  await page.waitForSelector("#app .cluster-card");
  await page.waitForTimeout(250);
  await t(`${vp.name}: Themen-Kompass ohne Überlauf`, async () => {
    assert.deepEqual(await overflowIssues(page), []);
  });

  // Cluster-Detail
  const tagId = await page.getAttribute("#app .cluster-card", "data-tag");
  await page.evaluate((id) => { location.hash = `#/themen/${id}`; }, tagId);
  await page.waitForSelector("#app .cluster-item");
  await page.waitForTimeout(250);
  await t(`${vp.name}: Cluster-Detail ohne Überlauf`, async () => {
    assert.deepEqual(await overflowIssues(page), []);
  });

  // Programm
  await page.evaluate(() => { location.hash = "#/programm"; });
  await page.waitForSelector("#app .results");
  await page.waitForTimeout(250);

  await t(`${vp.name}: Programm-Liste ohne Überlauf`, async () => {
    assert.deepEqual(await overflowIssues(page), []);
  });
  await t(`${vp.name}: Suchfeld nutzbar, keine leere Foyer-Spalte`, async () => {
    const searchWidth = await page.locator("#app .search-input").evaluate((el) => el.getBoundingClientRect().width);
    assert.ok(searchWidth >= 180, `Suchfeld nur ${Math.round(searchWidth)} px breit`);
    const heads = await page.locator("#app .grid-head").allTextContents();
    assert.equal(heads.map((s) => s.trim()).includes("Foyer CZS 3"), false);
  });
  await t(`${vp.name}: App-Zurücktaste führt zur vorherigen Ansicht`, async () => {
    const back = page.locator("#back-button");
    assert.equal(await back.isVisible(), true);
    assert.equal(await back.isEnabled(), true);
    await back.click();
    await page.waitForSelector("#app .view-cluster");
    assert.match(await page.evaluate(() => location.hash), /^#\/themen\//);
  });
  await t(`${vp.name}: App-Weitertaste kehrt zur nächsten Ansicht zurück`, async () => {
    const forward = page.locator("#forward-button");
    assert.equal(await forward.isVisible(), true);
    assert.equal(await forward.isEnabled(), true);
    await forward.click();
    await page.waitForSelector("#app .view-program");
    assert.equal(await page.evaluate(() => location.hash), "#/programm");
  });

  // Info
  await page.evaluate(() => { location.hash = "#/info"; });
  await page.waitForSelector("#app .view-info");
  await page.waitForTimeout(200);
  await t(`${vp.name}: Info ohne Überlauf`, async () => {
    assert.deepEqual(await overflowIssues(page), []);
  });

  // Gedämpfter Dunkelmodus mit Umschaltung auf das helle Corporate Design
  await page.evaluate(() => { location.hash = "#/themen"; });
  await t(`${vp.name}: Dark-Mode-Schalter sichtbar`, async () => {
    assert.equal(await page.locator("#theme-toggle").isVisible(), true);
  });
  await t(`${vp.name}: angenehmer Dunkelmodus ohne Überlauf`, async () => {
    assert.deepEqual(await overflowIssues(page), []);
    const colors = await page.evaluate(() => {
      const s = getComputedStyle(document.documentElement);
      return {
        scheme: s.colorScheme,
        bg: s.getPropertyValue("--bg").trim(),
        ink: s.getPropertyValue("--ink").trim(),
        logoFilter: getComputedStyle(document.querySelector(".brand-logo")).filter,
        sunVisible: getComputedStyle(document.querySelector(".theme-symbol-sun")).display !== "none",
      };
    });
    assert.equal(colors.scheme, "dark");
    assert.equal(colors.bg, "#151a20");
    assert.equal(colors.ink, "#e2e6e8");
    assert.match(colors.logoFilter, /invert\(1\)/);
    assert.equal(colors.sunVisible, true);
  });
  await page.locator("#theme-toggle").click();
  await t(`${vp.name}: Umschaltung in Hellmodus`, async () => {
    const colors = await page.evaluate(() => {
      const s = getComputedStyle(document.documentElement);
      return {
        scheme: s.colorScheme,
        bg: s.getPropertyValue("--bg").trim(),
        blue: s.getPropertyValue("--accent").trim(),
        violet: s.getPropertyValue("--faculty").trim(),
        saved: localStorage.getItem("slavtag26.theme"),
      };
    });
    assert.deepEqual(colors, {
      scheme: "light",
      bg: "#f1f2f3",
      blue: "#002f5d",
      violet: "#8b1878",
      saved: "light",
    });
    assert.deepEqual(await overflowIssues(page), []);
  });

  await ctx.close();
}

// Direkt geöffnete Unterseite: Zurück bleibt in der App, Weiter führt wieder zurück.
{
  const page = await browser.newPage();
  await page.goto(BASE + "#/programm");
  await page.waitForSelector("#app .view-program");
  await page.locator("#back-button").click();
  await page.waitForSelector("#app .view-dashboard");
  await t("App-Zurücktaste: direkter Einstieg fällt auf Startseite zurück", async () => {
    assert.equal(await page.evaluate(() => location.hash), "#/heute");
    assert.equal(await page.locator("#back-button").isVisible(), true);
    assert.equal(await page.locator("#back-button").isDisabled(), true);
    assert.equal(await page.locator("#forward-button").isEnabled(), true);
  });
  await page.locator("#forward-button").click();
  await page.waitForSelector("#app .view-program");
  await t("App-Weitertaste: direkte Unterseite wieder erreichbar", async () => {
    assert.equal(await page.evaluate(() => location.hash), "#/programm");
  });
  await page.close();
}

// ---------- Veranstaltungsfarben ----------
{
  const page = await browser.newPage();
  await page.goto(BASE + "#/programm", { waitUntil: "networkidle" });
  await page.waitForSelector("#app .results");
  await t("Farben: Disziplinen und sonstige Veranstaltungen", async () => {
    const colors = await page.evaluate(() => {
      const s = getComputedStyle(document.documentElement);
      return {
        sw: s.getPropertyValue("--sw").trim(),
        lkw: s.getPropertyValue("--lkw").trim(),
        did: s.getPropertyValue("--did").trim(),
        other: s.getPropertyValue("--other").trim(),
      };
    });
    assert.deepEqual(colors, {
      sw: "#9b7fc4",
      lkw: "#dc9800",
      did: "#648bc7",
      other: "#569e31",
    });
  });
  await page.close();
}

// ---------- Print-Stylesheet (Item 9) ----------
{
  const page = await browser.newPage();
  await page.goto(BASE + "#/programm", { waitUntil: "networkidle" });
  await page.waitForSelector("#app .session-card");
  await page.emulateMedia({ media: "print" });
  await t("Print: Nav unsichtbar", async () => {
    assert.equal(await page.locator("#main-nav").isVisible(), false);
  });
  await t("Print: Filterleiste unsichtbar", async () => {
    assert.equal(await page.locator("#app .filter-bar").isVisible(), false);
  });
  await t("Print: Karten sichtbar (Schwarz auf Weiß)", async () => {
    const card = page.locator("#app .session-card").first();
    assert.equal(await card.isVisible(), true);
    const colors = await card.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { bg: cs.backgroundColor, shadow: cs.boxShadow };
    });
    assert.ok(!colors.shadow || colors.shadow === "none", `Schatten im Druck: ${colors.shadow}`);
  });
  await t("Print: Grid einspaltig", async () => {
    const cols = await page.locator("#app .grid").first().evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length);
    assert.equal(cols, 1);
  });
  await page.emulateMedia({ media: "screen" });
  await page.close();
}

await browser.close();
killServer();
console.log(`\n${n} Layout-Checks, ${failures} Fehler.`);
process.exit(failures ? 1 : 0);
