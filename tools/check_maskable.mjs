// Pixel-Checks für icon-maskable-512.png: Full-Bleed, Safe-Zone, Kreisposition.
// node tools/check_maskable.mjs
import { chromium } from "playwright";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const b64 = (await readFile(join(ROOT, "icons", "icon-maskable-512.png"))).toString("base64");

const browser = await chromium.launch();
const page = await browser.newPage();
const r = await page.evaluate(async (b64) => {
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = "data:image/png;base64," + b64; });
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const px = (x, y) => [...ctx.getImageData(x, y, 1, 1).data.slice(0, 3)];
  const hex = (p) => "#" + p.map(v => v.toString(16).padStart(2, "0")).join("");
  // Eckpixel: müssen Full-Bleed-Hintergrund sein (Maske rundet dort)
  const corners = { tl: hex(px(2, 2)), tr: hex(px(509, 2)), bl: hex(px(2, 509)), br: hex(px(509, 509)) };
  // Zentrale Safe-Zone abtasten: weiße Fläche und violettes Motiv vorhanden?
  let lightPixels = 0, purplePixels = 0;
  for (let y = 51; y < 461; y += 10) for (let x = 51; x < 461; x += 10) {
    const p = px(x, y);
    if (p[0] > 200 && p[1] > 200 && p[2] > 200) lightPixels++;
    if (p[0] > 90 && p[0] > p[1] * 1.5 && p[2] > p[1] * 1.3) purplePixels++;
  }
  return { corners, lightPixels, purplePixels };
}, b64);
await browser.close();

const bg = "#002f5d";
const okCorners = Object.values(r.corners).every(v => v === bg);
console.log("Eckpixel = Hintergrund (full bleed):", okCorners ? "OK" : "FEHLER " + JSON.stringify(r.corners));
console.log("Helle Text-Pixel in Safe-Zone-Box:", r.lightPixels > 20 ? `OK (${r.lightPixels})` : `ZU WENIG (${r.lightPixels})`);
console.log("Violette Motivpixel in Safe-Zone-Box:", r.purplePixels > 10 ? `OK (${r.purplePixels})` : `ZU WENIG (${r.purplePixels})`);
if (!okCorners || r.lightPixels <= 20 || r.purplePixels <= 10) process.exit(1);
