// Rasterisiert die normalen und maskierbaren SVG-Icons als PNG (Playwright).
// Einmalig: node tools/render_icons.mjs  (nur im Repo-Root ausführen)
import { chromium } from "playwright";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const browser = await chromium.launch();
const page = await browser.newPage();
const variants = [
  { source: "slavistiktag-icon.svg", output: "slavistiktag-icon" },
  { source: "icon-maskable.svg", output: "slavistiktag-icon-maskable" },
];
for (const variant of variants) {
  const svg = await readFile(join(ROOT, "icons", variant.source), "utf-8");
  for (const size of [192, 512]) {
    const b64 = await page.evaluate(async ({ svg, size }) => {
      const img = new Image();
      const url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, size, size);
      return canvas.toDataURL("image/png").split(",")[1];
    }, { svg, size });
    await writeFile(join(ROOT, "icons", `${variant.output}-${size}.png`), Buffer.from(b64, "base64"));
    console.log(`${variant.output}-${size}.png geschrieben`);
  }
}
await browser.close();
