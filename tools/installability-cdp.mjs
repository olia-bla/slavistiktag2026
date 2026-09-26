// Die definitive Chrome-Installability-Prüfung: CDP Page.getInstallabilityErrors.
// Das ist exakt die interne Prüfung, anhand derer Chrome entscheidet, ob es
// beforeinstallprompt feuert bzw. „App installieren" anbietet.
// Leere Fehlerliste = installierbar.  node tools/installability-cdp.mjs
import { chromium } from "playwright";

const URL = "https://olia-bla.github.io/slavistiktag2026/";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto(URL, { waitUntil: "load" });
await page.waitForTimeout(2500); // SW aktivieren lassen

const client = await page.context().newCDPSession(page);
// 1x ohne Reload, 1x nach Reload (Chrome bewertet pro Navigation)
let errors = await client.send("Page.getInstallabilityErrors");
console.log("Direkt nach Load:", JSON.stringify(errors.installabilityErrors));

await page.reload({ waitUntil: "load" });
await page.waitForTimeout(1500);
const client2 = await page.context().newCDPSession(page);
errors = await client2.send("Page.getInstallabilityErrors");
console.log("Nach Reload:", JSON.stringify(errors.installabilityErrors));

if (errors.installabilityErrors.length === 0) {
  console.log("=> INSTALLIERBAR: Chrome meldet keine Installability-Fehler („App installieren“ wird angeboten).");
} else {
  console.log("=> NICHT installierbar, Gründe oben.");
}
await browser.close();
