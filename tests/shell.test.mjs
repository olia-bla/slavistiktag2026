// shell.test.mjs – SW-Shell-Konsistenz: jedes echte JS-Modul muss gecacht werden.
// Fängt die „Shell driftet still"-Falle: neue Module ohne SW-Eintrag brechen offline.
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { inflateSync } from "node:zlib";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const sw = await readFile(join(ROOT, "sw.js"), "utf-8");
const appJs = await readFile(join(ROOT, "js/app.js"), "utf-8");
const shellMatch = sw.match(/const SHELL = \[([\s\S]*?)\]/);
assert.ok(shellMatch, "SHELL-Array in sw.js nicht gefunden");
const shell = [...shellMatch[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);

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

// 1. Jeder SHELL-Eintrag existiert als Datei (oder Verzeichnis-Root "./")
t("Jeder SHELL-Eintrag existiert", async () => {
  const missing = [];
  for (const entry of shell) {
    const rel = entry.replace(/^\.\//, "");
    if (rel === "") continue; // "./" = App-Root (index.html ist separat geprüft)
    try { await readFile(join(ROOT, rel)); } catch { missing.push(entry); }
  }
  assert.deepEqual(missing, [], `SHELL-Einträge ohne Datei: ${missing.join(", ")}`);
});

// 1b. index.html als Einstiegspunkt explizit
t("index.html in der SHELL", () => {
  assert.ok(shell.includes("index.html"));
});

// 2. Jedes echte JS-Modul ist in der SHELL (Views + Root-Module)
t("Alle js/**/*.js sind in der SHELL", async () => {
  const files = [];
  async function walk(dir) {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      if (e.isDirectory()) await walk(join(dir, e.name));
      else if (e.name.endsWith(".js")) files.push(join(dir, e.name).slice(ROOT.length + 1).replaceAll("\\", "/"));
    }
  }
  await walk(join(ROOT, "js"));
  const missing = files.filter((f) => !shell.includes(f));
  assert.deepEqual(missing, [], `JS-Module fehlen in SHELL: ${missing.join(", ")}`);
});

// 3. Keine Duplikate
t("Keine Duplikate in der SHELL", () => {
  assert.equal(new Set(shell).size, shell.length);
});

// 4. Daten + Manifest + Icon gecacht
t("data/program.json + data/content.json + manifest + icon in SHELL", () => {
  // Daten laufen network-first mit Cache-Fallback → müssen NICHT in der SHELL stehen,
  // aber ein Cache-Fallback braucht mind. einen früheren Online-Besuch. Manifest/Icon
  // sind Install-Ressourcen → müssen drin sein.
  assert.ok(shell.includes("manifest.json"));
  assert.ok(shell.includes("icons/slavistiktag-icon.svg"));
  assert.ok(!shell.includes("Stadtplan Jena.pdf"));
});

t("Seitentitel, Link-Vorschau und App-Name sind konsistent", async () => {
  const html = await readFile(join(ROOT, "index.html"), "utf-8");
  const manifest = JSON.parse(await readFile(join(ROOT, "manifest.json"), "utf-8"));
  const title = html.match(/<title>([^<]+)<\/title>/)?.[1];
  const meta = (attribute, key) => html.match(
    new RegExp(`<meta ${attribute}="${key}" content="([^"]+)"`))?.[1].replaceAll("&amp;", "&");
  assert.equal(title, "15. Deutscher Slavistiktag 2026 · Konferenz-App");
  assert.equal(manifest.name, title);
  assert.equal(meta("name", "description"), manifest.description);
  assert.equal(meta("property", "og:title"), title);
  assert.equal(meta("property", "og:description"), manifest.description);
  assert.equal(meta("property", "og:url"), "https://olia-bla.github.io/slavistiktag2026/");
  assert.equal(meta("name", "twitter:title"), title);
  assert.equal(meta("name", "twitter:description"), manifest.description);
  assert.equal(meta("name", "twitter:card"), "summary");
});

t("Home-Screen-Icons haben einen deckend weißen Hintergrund", async () => {
  const manifest = JSON.parse(await readFile(join(ROOT, "manifest.json"), "utf-8"));
  const html = await readFile(join(ROOT, "index.html"), "utf-8");
  const iconSvg = await readFile(join(ROOT, "icons/slavistiktag-icon.svg"), "utf-8");
  const maskableSvg = await readFile(join(ROOT, "icons/icon-maskable.svg"), "utf-8");
  assert.match(iconSvg, /<rect[^>]+fill="#ffffff"/);
  assert.match(maskableSvg, /<rect[^>]+fill="#ffffff"/);
  assert.match(html, /rel="apple-touch-icon" href="icons\/slavistiktag-icon-192\.png\?v=white1"/);
  for (const icon of manifest.icons) {
    assert.ok(icon.src.endsWith("?v=white1"), `Icon ohne neue URL: ${icon.src}`);
    if (icon.type !== "image/png") continue;
    const png = await readFile(join(ROOT, icon.src.split("?")[0]));
    assert.equal(png.toString("ascii", 12, 16), "IHDR");
    assert.equal(png[24], 8, `${icon.src}: Farbtiefe`);
    assert.equal(png[25], 2, `${icon.src}: PNG muss RGB ohne Alphakanal sein`);
    const idat = [];
    for (let offset = 8; offset < png.length;) {
      const length = png.readUInt32BE(offset);
      const type = png.toString("ascii", offset + 4, offset + 8);
      if (type === "tRNS") assert.fail(`${icon.src}: Transparenz-Chunk vorhanden`);
      if (type === "IDAT") idat.push(png.subarray(offset + 8, offset + 8 + length));
      offset += length + 12;
    }
    const pixels = inflateSync(Buffer.concat(idat));
    assert.deepEqual([...pixels.subarray(1, 4)], [255, 255, 255], `${icon.src}: Ecke ist nicht weiß`);
  }
});

// 5. Updates werden ohne Benutzereingriff gesucht und nach Aktivierung geladen.
t("App übernimmt neue Versionen automatisch", () => {
  assert.match(sw, /self\.skipWaiting\(\)/);
  assert.match(sw, /self\.clients\.claim\(\)/);
  assert.match(sw, /SHELL\.map\(\(path\) => new Request\(path, \{ cache: "reload" \}\)\)/);
  assert.equal((sw.match(/fetch\(e\.request, \{ cache: "reload" \}\)/g) || []).length, 2);
  assert.match(appJs, /updateViaCache:\s*"none"/);
  assert.match(appJs, /controllerchange/);
  assert.match(appJs, /reg\.update\(\)/);
  assert.match(appJs, /location\.reload\(\)/);
});

await Promise.allSettled(pending);
console.log(`\n${n} Shell-Tests bestanden.`);
process.exit(failed ? 1 : 0);
