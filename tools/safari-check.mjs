// Safari/WebKit-Verhaltenstest gegen die Live-Site (iPhone-Stellvertreter).
// Prüft: JS-Fehler, apple-touch-icon, SW-Registrierung in WebKit, ICS-Download,
// manifest display:standalone. node safari-check.mjs
import { webkit } from "playwright";

const URL = "https://olia-bla.github.io/slavistiktag2026/";
const errors = [];

const browser = await webkit.launch();
const ctx = await browser.newContext({
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});
const page = await ctx.newPage();
page.on("pageerror", (e) => errors.push("JS: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
page.on("download", (d) => console.log("DOWNLOAD-EVENT:", d.suggestedFilename()));

await page.goto(URL, { waitUntil: "load" });
await page.waitForTimeout(2500);

// 1) App gerendert?
const nav = await page.locator("#main-nav a").count();
console.log("Nav-Links gerendert:", nav > 0 ? `OK (${nav})` : "FEHLER: keine Navigation");

// 2) apple-touch-icon im Head + erreichbar?
const ati = await page.evaluate(() => document.querySelector('link[rel="apple-touch-icon"]')?.href || null);
console.log("apple-touch-icon:", ati ? "OK " + ati : "FEHLEND");
if (ati) {
  const res = await page.request.get(ati);
  console.log("  erreichbar:", res.status() === 200 ? "OK" : "FEHLER " + res.status());
}

// 3) Manifest display:standalone (iOS liest es für Home-Screen-Apps)?
const disp = await page.evaluate(async () => {
  const m = await fetch("manifest.json").then(r => r.json());
  return m.display;
});
console.log("manifest display:", disp);

// 4) SW-Registrierung in WebKit (Safari-Engine, analog iOS 16.4+)
const swState = await page.evaluate(async () => {
  if (!("serviceWorker" in navigator)) return "kein SW-Support";
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return "nicht registriert";
  const w = reg.active || reg.waiting || reg.installing;
  for (let i = 0; i < 40 && w.state !== "activated"; i++) {
    await new Promise(r => setTimeout(r, 250));
  }
  return w.state;
});
console.log("SW in WebKit:", swState);

// 5) ICS-Download: Drawer öffnen, Kalender-Button klicken
const btn = page.locator('button:has-text("Kalender")').first();
await page.locator('#main-nav a[href="#/programm"]').click();
await page.waitForTimeout(800);
await page.locator('.session-card, .card, article').first().click().catch(() => {});
await page.waitForTimeout(800);
const drawerBtn = page.locator('button:has-text("Kalender")').first();
if (await drawerBtn.count()) {
  await drawerBtn.click();
  await page.waitForTimeout(1200);
} else {
  console.log("ICS-Button nicht auffindbar (Drawer nicht offen)");
}

console.log("Fehler gesammelt:", errors.length ? errors.slice(0, 5) : "keine");
await browser.close();
