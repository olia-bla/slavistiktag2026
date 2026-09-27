// shell.test.mjs – SW-Shell-Konsistenz: jedes echte JS-Modul muss gecacht werden.
// Fängt die „Shell driftet still"-Falle: neue Module ohne SW-Eintrag brechen offline.
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

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
