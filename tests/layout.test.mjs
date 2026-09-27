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
  { name: "Android-S 320", width: 320, height: 740, mobile: true },
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
    const selectors = ".card, .cluster-card, .cluster-item, .topics-intro, .topbar, .cluster-list";
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
  await page.goto(BASE + "#/startseite");
  await page.waitForSelector("#app .card");

  await t(`${vp.name}: Dashboard ohne Überlauf`, async () => {
    assert.deepEqual(await overflowIssues(page), []);
  });
  await t(`${vp.name}: Installationsanleitung zeigt beide Symbole ohne Überlauf`, async () => {
    await page.evaluate(() => { document.querySelector(".install-guide").open = true; });
    await page.waitForFunction(() => [...document.querySelectorAll(".install-guide-body img")]
      .every((icon) => icon.complete && icon.naturalWidth > 0));
    const icons = await page.locator(".install-guide-body img").count();
    assert.equal(icons, 2);
    assert.deepEqual(await overflowIssues(page), []);
    await page.evaluate(() => { document.querySelector(".install-guide").open = false; });
  });
  await t(`${vp.name}: Startseite ist kompakt und einheitlich`, async () => {
    const dashboard = await page.evaluate(() => {
      const actions = [...document.querySelectorAll(".dashboard-actions .btn")];
      const resources = [...document.querySelectorAll(".dashboard-resource")];
      const positions = (items) => items.map((el) => {
        const r = el.getBoundingClientRect();
        return { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), height: Math.round(r.height) };
      });
      return {
        actionLabels: actions.map((el) => el.textContent.trim()),
        eventDates: document.querySelector(".event-dates")?.textContent,
        resourceCount: resources.length,
        resourcePositions: positions(resources),
        contactText: document.querySelector(".dashboard-contact")?.textContent,
        contactBounds: positions([document.querySelector(".dashboard-contact")])[0],
        phoneHref: document.querySelector('.dashboard-contact a[href^="tel:"]')?.getAttribute("href"),
        mailHref: document.querySelector('.dashboard-contact a[href^="mailto:"]')?.getAttribute("href"),
        oldHighlightsMissing: document.querySelector(".highlight-list") === null,
        oldDaysMissing: ![...document.querySelectorAll(".view-dashboard h2")].some((el) => el.textContent === "Tage"),
      };
    });
    assert.deepEqual(dashboard.actionLabels, []);
    assert.equal(dashboard.eventDates, "30.09. – 03.10. · Jena · Carl-Zeiss-Straße 3");
    assert.equal(dashboard.resourceCount, 4);
    assert.ok(dashboard.contactText.includes("Notfälle während der Tagung"));
    assert.equal(dashboard.phoneHref, "tel:+4915125881153");
    assert.equal(dashboard.mailHref, "mailto:slavistiktag2026@uni-jena.de");
    assert.ok(dashboard.contactBounds.left >= 0 && dashboard.contactBounds.right <= vp.width + 1);
    assert.equal(dashboard.oldHighlightsMissing, true);
    assert.equal(dashboard.oldDaysMissing, true);
    assert.ok(dashboard.resourcePositions.every((r) => r.left >= 0 && r.right <= vp.width + 1 && r.height >= 40));
    if (vp.width <= 760) {
      assert.equal(dashboard.resourcePositions[0].top, dashboard.resourcePositions[1].top);
    }
  });
  await t(`${vp.name}: Begrüßungen bilden zwei gleich große Zeilen`, async () => {
    const welcome = await page.evaluate(() => {
      const wall = document.querySelector(".welcome-wall");
      const rows = [...wall.querySelectorAll(".welcome-row")];
      return {
        rows: rows.length,
        counts: rows.map((row) => row.querySelectorAll(".welcome-word").length),
        words: wall.querySelectorAll(".welcome-word").length,
        german: wall.textContent.includes("Herzlich willkommen in Jena!"),
        displayed: getComputedStyle(wall).display !== "none",
        rowTops: rows.map((row) => Math.round(row.getBoundingClientRect().top)),
      };
    });
    assert.equal(welcome.rows, 2);
    assert.deepEqual(welcome.counts, [7, 7]);
    assert.equal(welcome.words, 14);
    assert.equal(welcome.german, true);
    assert.equal(welcome.displayed, vp.width > 760);
    if (vp.width > 760) assert.notEqual(welcome.rowTops[0], welcome.rowTops[1]);
  });
  await t(`${vp.name}: Logo links oben, keine Zurück-Leiste`, async () => {
    const ui = await page.evaluate(() => {
      const logo = document.querySelector(".brand-logo").getBoundingClientRect();
      const icon = document.querySelector(".theme-icon").getBoundingClientRect();
      const label = document.querySelector(".theme-label").getBoundingClientRect();
      return {
        logoLeft: logo.left,
        historyMissing: document.querySelector(".history-bar") === null,
        backMissing: document.querySelector("#back-button") === null,
        forwardMissing: document.querySelector("#forward-button") === null,
        themeIconBeforeLabel: icon.left < label.left,
        sunVisible: getComputedStyle(document.querySelector(".theme-symbol-sun")).display !== "none",
        emptyFavoriteCountHidden: getComputedStyle(document.querySelector(".fav-count")).display === "none",
      };
    });
    assert.equal(ui.historyMissing, true);
    assert.equal(ui.backMissing, true);
    assert.equal(ui.forwardMissing, true);
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
  await t(`${vp.name}: alle Tagesregister ohne horizontales Scrollen sichtbar`, async () => {
    const tabs = await page.evaluate(() => {
      const bar = document.querySelector(".day-tabs");
      const buttons = [...bar.querySelectorAll(".chip")];
      const rects = buttons.map((button) => button.getBoundingClientRect());
      return {
        count: buttons.length,
        labels: buttons.map((button) => button.textContent.trim()),
        noScroll: bar.scrollWidth <= bar.clientWidth + 1,
        allInViewport: rects.every((rect) => rect.width > 0 && rect.left >= -1 && rect.right <= innerWidth + 1),
        rows: new Set(rects.map((rect) => Math.round(rect.top))).size,
        rects: rects.map((rect) => ({
          top: Math.round(rect.top),
          left: Math.round(rect.left),
          width: Math.round(rect.width),
        })),
        display: getComputedStyle(bar).display,
      };
    });
    assert.equal(tabs.count, 5);
    assert.equal(tabs.labels[0], "Alle Tage");
    assert.equal(tabs.noScroll, true);
    assert.equal(tabs.allInViewport, true);
    if (vp.width <= 760) {
      assert.equal(tabs.display, "grid");
      assert.equal(tabs.rows, 3);
      assert.ok(tabs.rects[0].width > tabs.rects[1].width * 1.9, "Alle Tage belegt nicht die volle Breite");
      assert.equal(tabs.rects[1].top, tabs.rects[2].top, "Mittwoch und Donnerstag liegen nicht in einer Reihe");
      assert.equal(tabs.rects[3].top, tabs.rects[4].top, "Freitag und Samstag liegen nicht in einer Reihe");
      assert.ok(tabs.rects[0].top < tabs.rects[1].top && tabs.rects[1].top < tabs.rects[3].top);
    }
  });
  await t(`${vp.name}: Liste und Raster lassen sich umschalten`, async () => {
    const raster = page.locator(".view-grid");
    const liste = page.locator(".view-list");
    assert.equal(await raster.isVisible(), true);
    assert.equal(await liste.isVisible(), true);

    await raster.click();
    await page.waitForSelector(".grid-wrap");
    assert.equal(await raster.getAttribute("aria-pressed"), "true");
    const gridBounds = await page.locator(".grid-wrap").first().evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        viewport: innerWidth,
        scrollable: el.scrollWidth > el.clientWidth,
      };
    });
    assert.ok(gridBounds.left >= -1 && gridBounds.right <= gridBounds.viewport + 1,
      `Raster ragt aus der Seite: ${gridBounds.left}..${gridBounds.right} bei ${gridBounds.viewport}px`);
    if (vp.width <= 760) assert.equal(gridBounds.scrollable, true);

    await liste.click();
    await page.waitForSelector(".slot-block");
    assert.equal(await liste.getAttribute("aria-pressed"), "true");
    assert.equal(await page.locator(".grid-wrap").count(), 0);
    assert.deepEqual(await overflowIssues(page), []);
  });
  await t(`${vp.name}: Filter funktionieren und lassen sich vollständig zurücksetzen`, async () => {
    assert.equal(await page.locator(".filter-toggle").count(), 0);
    assert.equal(await page.locator("#program-advanced-filters").isVisible(), true);
    const filterBounds = await page.locator(".filter-bar").evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, viewport: innerWidth };
    });
    assert.ok(filterBounds.left >= -1 && filterBounds.right <= filterBounds.viewport + 1,
      `Filterleiste ragt heraus: ${filterBounds.left}..${filterBounds.right} bei ${filterBounds.viewport}px`);

    const categoryValues = ["podium", "special", "rahmen", "pause"];
    const categories = await page.evaluate((values) => ({
      noneChecked: values.every((value) => !document.querySelector(`input[value="${value}"]`)?.checked),
      panelMissing: document.querySelector('input[value="panel"]') === null,
      sectionMissing: document.querySelector('input[value="sektion"]') === null,
    }), categoryValues);
    assert.equal(categories.noneChecked, true);
    assert.equal(categories.panelMissing, true);
    assert.equal(categories.sectionMissing, true);

    const timeSelect = page.locator('select[aria-label="Zeit"]');
    assert.deepEqual(await timeSelect.locator("option").allTextContents(), [
      "Zeit", "09:00–11:00", "11:30–13:00", "14:00–15:30", "16:00–17:30", "nach dem Vortragsende",
    ]);
    await timeSelect.selectOption("16:00-17:30");
    await page.waitForTimeout(400);
    assert.ok(await page.locator(".session-card, .event-card").count() > 0);
    assert.deepEqual(await overflowIssues(page), []);
    await timeSelect.selectOption("");
    await page.waitForTimeout(400);

    const pausesBefore = await page.locator(".event-card.type-break").count();
    assert.ok(pausesBefore > 0, "keine sichtbare Pause zum Testen");
    await page.locator('input[value="pause"]').check();
    await page.waitForTimeout(400);
    const pauseOnly = await page.locator(".event-card.type-break").count();
    assert.ok(pauseOnly > 0);
    assert.equal(await page.locator(".session-card, .event-card").count(), pauseOnly);
    await page.locator('input[value="pause"]').uncheck();
    await page.waitForTimeout(400);
    assert.ok(await page.locator(".event-card.type-break").count() > 0);

    await page.locator('input[value="DID"]').check();
    await page.waitForTimeout(400);
    const filtered = await page.evaluate(() => ({
      cards: document.querySelectorAll(".session-card").length,
      wrongCards: [...document.querySelectorAll(".session-card")]
        .filter((card) => !card.classList.contains("track-did")).length,
      events: document.querySelectorAll(".event-card").length,
    }));
    assert.ok(filtered.cards > 0);
    assert.equal(filtered.wrongCards, 0);
    assert.equal(filtered.events, 0);

    await page.locator('input[value="podium"]').check();
    await page.waitForTimeout(400);
    const combined = await page.evaluate(() => ({
      didCards: document.querySelectorAll(".session-card.track-did").length,
      wrongSessions: [...document.querySelectorAll(".session-card")]
        .filter((card) => !card.classList.contains("track-did")).length,
      podiums: document.querySelectorAll(".event-card.type-podium").length,
    }));
    assert.ok(combined.didCards > 0);
    assert.equal(combined.wrongSessions, 0);
    assert.ok(combined.podiums > 0, "Fachdidaktik + Podium zeigt das Podium nicht gemeinsam an");

    await page.locator(".filter-options > .btn").click();
    await page.waitForSelector('input[value="DID"]', { state: "attached" });
    const reset = await page.evaluate(() => ({
      disciplineChecked: ["DID", "SW", "LKW"]
        .some((value) => document.querySelector(`input[value="${value}"]`)?.checked),
      categoryChecked: ["podium", "special", "rahmen", "pause"]
        .some((value) => document.querySelector(`input[value="${value}"]`)?.checked),
      selected: [...document.querySelectorAll(".filter-bar select")].some((select) => select.value),
      advancedVisible: getComputedStyle(document.querySelector(".filter-advanced")).display !== "none",
      activeDay: document.querySelector(".day-tabs .chip.active")?.textContent,
    }));
    assert.equal(reset.disciplineChecked, false);
    assert.equal(reset.categoryChecked, false);
    assert.equal(reset.selected, false);
    assert.equal(reset.advancedVisible, true);
    assert.equal(reset.activeDay, "Alle Tage");
  });
  await t(`${vp.name}: RU-/UK-Sprachangaben sind konsistent und mobil lesbar`, async () => {
    const search = page.locator(".search-input");
    await search.fill("Uliana Retzlaff");
    await page.waitForTimeout(450);
    const russian = page.locator(".session-card").filter({ hasText: "Uliana Retzlaff" });
    assert.equal(await russian.count(), 1);
    const ruBadge = russian.locator(".pill.lang");
    assert.equal(await ruBadge.textContent(), "RU");
    assert.equal(await ruBadge.getAttribute("title"), "Vortragssprache: Russisch");
    const ruBounds = await ruBadge.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, width: r.width, viewport: innerWidth };
    });
    assert.ok(ruBounds.width > 0 && ruBounds.left >= -1 && ruBounds.right <= ruBounds.viewport + 1);

    await russian.click();
    await page.waitForSelector(".drawer");
    try {
      // Das Detailfenster fährt 0,18 s von rechts ein; erst die fertige Lage messen.
      await page.waitForTimeout(220);
      assert.equal(await page.locator(".drawer .pill.lang").getAttribute("title"), "Vortragssprache: Russisch");
      const drawerBounds = await page.locator(".drawer").evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right, viewport: innerWidth };
      });
      assert.ok(drawerBounds.left >= -1 && drawerBounds.right <= drawerBounds.viewport + 1);
    } finally {
      await page.locator(".drawer-close").click({ force: true });
    }

    await search.fill("Liudmyla Mobius");
    await page.waitForTimeout(450);
    const ukrainian = page.locator(".session-card").filter({ hasText: "Liudmyla Mobius" });
    assert.equal(await ukrainian.count(), 1);
    assert.equal(await ukrainian.locator(".pill.lang").textContent(), "UK");
    assert.equal(await ukrainian.locator(".pill.lang").getAttribute("title"), "Vortragssprache: Ukrainisch");
    assert.deepEqual(await overflowIssues(page), []);
    await search.fill("");
    await page.waitForTimeout(450);
  });
  // Info
  await page.evaluate(() => { location.hash = "#/info"; });
  await page.waitForSelector("#app .view-info");
  await page.waitForTimeout(200);
  await t(`${vp.name}: Info ohne Überlauf`, async () => {
    assert.equal(await page.locator("#app .lunch-place").count(), 2);
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
        footerColor: getComputedStyle(document.querySelector(".site-footer"), "::before").backgroundColor,
        footerGradient: getComputedStyle(document.querySelector(".site-footer"), "::before").backgroundImage,
      };
    });
    assert.equal(colors.scheme, "dark");
    assert.equal(colors.bg, "#151a20");
    assert.equal(colors.ink, "#e2e6e8");
    assert.match(colors.logoFilter, /invert\(1\)/);
    assert.equal(colors.sunVisible, true);
    assert.equal(colors.footerColor, "rgb(168, 120, 159)");
    assert.equal(colors.footerGradient, "none");
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
        footerColor: getComputedStyle(document.querySelector(".site-footer"), "::before").backgroundColor,
        footerGradient: getComputedStyle(document.querySelector(".site-footer"), "::before").backgroundImage,
      };
    });
    assert.deepEqual(colors, {
      scheme: "light",
      bg: "#f1f2f3",
      blue: "#002f5d",
      violet: "#8b1878",
      saved: "light",
      footerColor: "rgb(139, 24, 120)",
      footerGradient: "none",
    });
    assert.deepEqual(await overflowIssues(page), []);
  });

  await ctx.close();
}

// Direkt geöffnete Unterseite: keine zusätzliche Browserleiste der App.
{
  const page = await browser.newPage();
  await page.goto(BASE + "#/programm");
  await page.waitForSelector("#app .view-program");
  await t("Direkter Einstieg: keine Zurück- oder Weiter-Leiste", async () => {
    assert.equal(await page.locator(".history-bar").count(), 0);
    assert.equal(await page.locator("#back-button").count(), 0);
    assert.equal(await page.locator("#forward-button").count(), 0);
  });
  await page.close();
}

// Beide Countdown-Phasen bleiben auch auf schmalen Home-Screens lesbar.
for (const [name, width, fixedTime, expected] of [
  ["Android", 320, "2026-09-27T10:30:00+02:00", "3 Tagen"],
  ["iPhone", 390, "2026-09-27T10:30:00+02:00", "3 Tagen"],
  ["Android", 320, "2026-09-30T00:00:00+02:00", "12 Stunden"],
  ["iPhone", 390, "2026-09-30T00:00:00+02:00", "12 Stunden"],
]) {
  const ctx = await browser.newContext({
    viewport: { width, height: 844 }, isMobile: true, hasTouch: true,
    timezoneId: "Europe/Berlin",
  });
  const page = await ctx.newPage();
  await page.addInitScript(({ fixedNow }) => {
    const NativeDate = Date;
    window.Date = class extends NativeDate {
      constructor(...args) { super(...(args.length ? args : [fixedNow])); }
      static now() { return fixedNow; }
    };
  }, { fixedNow: new Date(fixedTime).getTime() });
  await page.goto(BASE + "#/startseite");
  await page.waitForSelector("#app .now-card");
  await t(`${name} ${fixedTime.slice(0, 10)}: Countdown ohne Überlauf`, async () => {
    const text = await page.locator(".now-card").textContent();
    assert.ok(text.includes(`Die Tagung beginnt in ${expected}`), text);
    assert.ok(text.includes("am Mittwoch, den 30. September 2026"), text);
    assert.equal(await page.locator(".now-label.is-live").count(), 0);
    assert.deepEqual(await overflowIssues(page), []);
  });
  await ctx.close();
}

// Mittwoch wechselt die Startseite zu den richtigen Uhrzeiten vom Tageshinweis
// zu Registrierung, Jahrestagung und schließlich dem Abendprogramm.
for (const [time, expectedItems] of [
  ["12:00", [["Läuft gerade", "Registrierung"], ["Als Nächstes", "Jahrestagung des Slavistikverbandes"]]],
  ["14:00", [["Läuft gerade", "Registrierung"], [null, "Jahrestagung des Slavistikverbandes"], ["Als Nächstes", "Eröffnung des Slavistiktages"]]],
  ["17:00", [["Läuft gerade", "Registrierung"], ["Als Nächstes", "Eröffnung des Slavistiktages"]]],
  ["18:00", [["Läuft gerade", "Eröffnung des Slavistiktages"], ["Als Nächstes", "Buffet mit musikalischer Begleitung"]]],
]) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    timezoneId: "Europe/Berlin",
  });
  const page = await ctx.newPage();
  await page.addInitScript(({ fixedNow }) => {
    const NativeDate = Date;
    window.Date = class extends NativeDate {
      constructor(...args) { super(...(args.length ? args : [fixedNow])); }
      static now() { return fixedNow; }
    };
  }, { fixedNow: new Date(`2026-09-30T${time}:00+02:00`).getTime() });
  await page.goto(BASE + "#/startseite");
  await page.waitForSelector("#app .now-card");
  await t(`iPhone Mittwoch ${time}: Registrierung, Jahrestagung und Abendprogramm`, async () => {
    const items = await page.locator(".now-card .now-item").allTextContents();
    assert.equal(items.length, expectedItems.length);
    for (const [index, [label, title]] of expectedItems.entries()) {
      if (label) assert.ok(items[index].includes(label), items[index]);
      assert.ok(items[index].includes(title), items[index]);
    }
    assert.deepEqual(await overflowIssues(page), []);
  });
  await ctx.close();
}

// Donnerstag während des parallelen Vortragsprogramms: Die Startseite darf
// keinen zufälligen Einzelvortrag als repräsentativ hervorheben.
{
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    timezoneId: "Europe/Berlin",
  });
  const page = await ctx.newPage();
  await page.addInitScript(({ fixedNow }) => {
    const NativeDate = Date;
    class FixedDate extends NativeDate {
      constructor(...args) { super(...(args.length ? args : [fixedNow])); }
      static now() { return fixedNow; }
    }
    window.Date = FixedDate;
  }, { fixedNow: new Date("2026-10-01T09:15:00+02:00").getTime() });
  await page.goto(BASE + "#/startseite");
  await page.waitForSelector("#app .now-card");
  await t("iPhone Donnerstag: paralleles Programm statt zufälligem Einzelvortrag", async () => {
    const text = await page.locator(".now-card").textContent();
    assert.ok(text.includes("Aktuell laufen mehrere Veranstaltungen"));
    assert.ok(text.includes("verschiedene Räume"));
    assert.equal(await page.locator('.now-card a[href="#/programm?day=2026-10-01"]').count() >= 1, true);
    const liveLabel = page.locator(".now-label.is-live");
    assert.equal(await liveLabel.count(), 1);
    assert.equal(await liveLabel.evaluate((el) => getComputedStyle(el, "::before").animationName), "liveSoftPulse");
    await page.emulateMedia({ reducedMotion: "reduce" });
    assert.equal(await liveLabel.evaluate((el) => getComputedStyle(el, "::before").animationName), "none");
    assert.deepEqual(await overflowIssues(page), []);
  });
  await ctx.close();
}

// Die Startseite zeigt Pausen und die parallelen Führungen namentlich,
// sowohl während der Veranstaltung als auch kurz davor.
for (const [time, expectedTitles] of [
  ["2026-10-01T10:45:00+02:00", ["Kaffeepause am Vormittag"]],
  ["2026-10-01T11:05:00+02:00", ["Kaffeepause am Vormittag"]],
  ["2026-10-01T13:05:00+02:00", ["Mittagspause"]],
  ["2026-10-01T15:35:00+02:00", ["Kaffeepause am Nachmittag"]],
  ["2026-10-01T17:45:00+02:00", ["Jena – der Ort der deutschen Romantik", "Stadtführung durch Jena", "bulgarische Plakatkunst"]],
  ["2026-10-01T18:05:00+02:00", ["Jena – der Ort der deutschen Romantik", "Stadtführung durch Jena", "bulgarische Plakatkunst"]],
]) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    timezoneId: "Europe/Berlin",
  });
  const page = await ctx.newPage();
  await page.addInitScript(({ fixedNow }) => {
    const NativeDate = Date;
    window.Date = class extends NativeDate {
      constructor(...args) { super(...(args.length ? args : [fixedNow])); }
      static now() { return fixedNow; }
    };
  }, { fixedNow: new Date(time).getTime() });
  await page.goto(BASE + "#/startseite");
  await page.waitForSelector("#app .now-card");
  await t(`iPhone Donnerstag ${time.slice(11, 16)}: Pause oder Rahmenprogramm sichtbar`, async () => {
    const titles = await page.locator(".now-card .now-title").allTextContents();
    for (const title of expectedTitles) {
      assert.ok(titles.some((shown) => shown.includes(title)), `${title} fehlt: ${titles.join(" | ")}`);
    }
    assert.deepEqual(await overflowIssues(page), []);
  });
  await ctx.close();
}

// Am Freitag sollen beide gleichzeitig laufenden Podien einzeln erscheinen;
// am Samstag wechseln Pause, Abschluss und Stadtführung korrekt.
for (const [day, time, expectedTitles] of [
  ["2026-10-02", "16:05", ["Zwischen Krise und Comeback?", "Slavistik ohne Russland?"]],
  ["2026-10-02", "18:05", ["Ukrainischer Chor"]],
  ["2026-10-03", "11:05", ["Kaffeepause am Vormittag", "Wenn die Welt brennt"]],
  ["2026-10-03", "13:05", ["Abschlussveranstaltung", "Stadtführung durch Jena"]],
  ["2026-10-03", "14:05", ["Stadtführung durch Jena"]],
  ["2026-10-03", "15:29", ["Stadtführung durch Jena"]],
]) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    timezoneId: "Europe/Berlin",
  });
  const page = await ctx.newPage();
  await page.addInitScript(({ fixedNow }) => {
    const NativeDate = Date;
    window.Date = class extends NativeDate {
      constructor(...args) { super(...(args.length ? args : [fixedNow])); }
      static now() { return fixedNow; }
    };
  }, { fixedNow: new Date(`${day}T${time}:00+02:00`).getTime() });
  await page.goto(BASE + "#/startseite");
  await page.waitForSelector("#app .now-card");
  await t(`iPhone ${day} ${time}: Podien, Pause und Rahmenprogramm sichtbar`, async () => {
    const titles = await page.locator(".now-card .now-title").allTextContents();
    for (const title of expectedTitles) {
      assert.ok(titles.some((shown) => shown.includes(title)), `${title} fehlt: ${titles.join(" | ")}`);
    }
    const holiday = page.locator(".dashboard-holiday");
    if (day === "2026-10-02") {
      assert.equal(await holiday.count(), 1);
      assert.ok((await holiday.textContent()).includes("Die meisten Geschäfte bleiben geschlossen."));
      assert.equal(await page.locator(".dashboard-holiday + .dashboard-contact").count(), 1);
    } else {
      assert.equal(await holiday.count(), 0);
    }
    assert.deepEqual(await overflowIssues(page), []);
  });
  await ctx.close();
}

// Erst nach dem Ende der Stadtführung erscheint die Dankesbotschaft.
for (const width of [360, 390]) {
  const ctx = await browser.newContext({
    viewport: { width, height: 844 }, isMobile: true, hasTouch: true,
    timezoneId: "Europe/Berlin",
  });
  const page = await ctx.newPage();
  await page.addInitScript(({ fixedNow }) => {
    const NativeDate = Date;
    window.Date = class extends NativeDate {
      constructor(...args) { super(...(args.length ? args : [fixedNow])); }
      static now() { return fixedNow; }
    };
  }, { fixedNow: new Date("2026-10-03T15:30:00+02:00").getTime() });
  await page.goto(BASE + "#/startseite");
  await page.waitForSelector("#app .now-card");
  await t(`Samstag 15:30 auf ${width}px: herzlicher Dank statt Programmende`, async () => {
    const text = await page.locator(".now-card").textContent();
    assert.ok(text.includes("Vielen Dank für die Teilnahme an der Konferenz!"));
    assert.ok(text.includes("allen Beteiligten"));
    assert.equal(text.includes("Für heute ist das Programm zu Ende."), false);
    assert.deepEqual(await overflowIssues(page), []);
  });
  await ctx.close();
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
