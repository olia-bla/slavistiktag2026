// PWA-Update-Verhalten end-to-end testen (das „PWA aktualisiert sich nicht“-Problem).
// Bedient eine KOPIE des Repos und simuliert drei Deploy-Arten on-disk:
//   A) Nur-Code-Update (index.html)  → SWR: 1. Reload alt, 2. Reload neu
//   B) Nur-Daten-Update (content.json) → network-first: sofort im 1. Reload sichtbar
//   C) sw.js-Änderung (CACHE-Name)   → neuer SW: skipWaiting, alter Cache gelöscht,
//      Update-Toast, Offline-Start weiterhin ok
// Aufruf: node tools/update-check.mjs <rootDir>   (rootDir = Kopie, wird verändert!)
import { chromium } from "playwright";
import { spawn, execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.argv[2];
if (!ROOT) { console.error("rootDir fehlt"); process.exit(1); }
const PORT = 8129;
const URL = `http://localhost:${PORT}/`;
const fails = [];
const ok = (name, cond) => { console.log((cond ? "  ok " : "  FAIL ") + name); if (!cond) fails.push(name); };

const PY = process.platform === "win32" ? "python" : "python3";
const server = spawn(PY, ["-m", "http.server", String(PORT)], { cwd: ROOT, shell: true, stdio: "ignore" });
if (process.platform === "win32") {
  process.on("exit", () => { try { execSync(`taskkill /PID ${server.pid} /T /F`, { stdio: "ignore" }); } catch {} });
} else {
  process.on("exit", () => { try { server.kill(); } catch {} });
}
await new Promise((r) => setTimeout(r, 1800));

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

async function swState() {
  return page.evaluate(async () => {
    for (let i = 0; i < 40; i++) {
      const reg = await navigator.serviceWorker.getRegistration();
      const w = reg && (reg.active || reg.waiting || reg.installing);
      if (w && w.state === "activated") {
        return { state: w.state, caches: await caches.keys(), controlled: !!navigator.serviceWorker.controller };
      }
      await new Promise(r => setTimeout(r, 250));
    }
    const reg = await navigator.serviceWorker.getRegistration();
    const w = reg && (reg.active || reg.waiting || reg.installing);
    return { state: w?.state || "keiner", caches: await caches.keys(), controlled: !!navigator.serviceWorker.controller };
  });
}
const footer = () => page.evaluate(() => document.querySelector(".site-footer")?.textContent || "");
const motto = () => page.evaluate(() => document.querySelector(".motto")?.textContent || "");
// Nach jedem Reload: auf gerenderte Daten warten (motto kommt aus content.json,
// also erst nach async loadData) – fixe Sleeps sind hier nicht zuverlässig.
async function waitDataRendered() {
  await page.waitForSelector(".motto", { timeout: 15000 });
}

// ── Baseline: installieren ────────────────────────────────────────────────
await page.goto(URL, { waitUntil: "load" });
let st = await swState();
ok("Baseline: SW aktiviert", st.state === "activated");
ok("Baseline: genau 1 Cache", st.caches.length === 1 && st.caches[0] === "slavtag26-companion");
ok("Baseline: Seite kontrolliert", st.controlled);
ok("Baseline: Footer ohne Marker", !(await footer()).includes("UPDATE-MARKER"));
ok("Baseline: Motto ohne Marker", !(await motto()).includes("DATA-MARKER"));

// ── A) Nur-Code-Update (SWR) ─────────────────────────────────────────────
const idx = readFileSync(join(ROOT, "index.html"), "utf8");
writeFileSync(join(ROOT, "index.html"), idx.replace("Mitmachen auf GitHub", "Mitmachen auf GitHub · UPDATE-MARKER"));
await page.reload({ waitUntil: "load" });
await waitDataRendered();
ok("A: 1. Reload zeigt noch ALT (SWR-SEMANTIK)", !(await footer()).includes("UPDATE-MARKER"));
await page.reload({ waitUntil: "load" });
await waitDataRendered();
ok("A: 2. Reload zeigt NEU (Cache im Hintergrund aktualisiert)", (await footer()).includes("UPDATE-MARKER"));

// ── B) Nur-Daten-Update (network-first) ──────────────────────────────────
const cj = join(ROOT, "data", "content.json");
const cjRaw = readFileSync(cj, "utf8");
writeFileSync(cj, cjRaw.replace('"Herausforderung: Zukunft"', '"Herausforderung: Zukunft DATA-MARKER"'));
await page.reload({ waitUntil: "load" });
await waitDataRendered();
ok("B: Daten-Update SOFORT im 1. Reload sichtbar (network-first)", (await motto()).includes("DATA-MARKER"));

// ── C) sw.js-Änderung → echter SW-Update-Zyklus ─────────────────────────
const sw = join(ROOT, "sw.js");
const swRaw = readFileSync(sw, "utf8");
writeFileSync(sw, swRaw.replace('const CACHE = "slavtag26-companion"', 'const CACHE = "slavtag26-companion-v2"'));
await page.reload({ waitUntil: "load" });
await waitDataRendered();
let toastSeen = false;
try {
  await page.waitForSelector('text=Neue Version verfügbar', { timeout: 8000 });
  toastSeen = true;
} catch { /* Toast ist Best-Effort */ }
ok("C: Update-Toast „Neue Version verfügbar“ erscheint", toastSeen);
let st2 = null;
for (let i = 0; i < 30; i++) {
  st2 = await swState();
  if (st2.state === "activated" && st2.caches.includes("slavtag26-companion-v2")) break;
  await page.waitForTimeout(500);
}
ok("C: neuer SW aktiviert (v2)", st2?.state === "activated" && st2.caches.includes("slavtag26-companion-v2"));
ok("C: alter Cache entfernt (activate-pruning)", !st2.caches.includes("slavtag26-companion"));
ok("C: Seite vom neuen SW kontrolliert", st2.controlled);

// ── Offline nach dem Update ──────────────────────────────────────────────
await page.context().setOffline(true);
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(1500);
const navOffline = await page.evaluate(() => document.querySelectorAll("#main-nav a").length);
ok("C: Offline-Start nach Update rendert App", navOffline >= 5);
await page.context().setOffline(false);

ok("keine JS-Fehler im ganzen Lauf", errors.length === 0);
await browser.close();
console.log(fails.length ? `ERGEBNIS: ${fails.length} FEHLER` : "ERGEBNIS: alle Update-Checks bestanden");
process.exit(fails.length ? 1 : 0);
