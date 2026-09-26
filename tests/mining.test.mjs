// Mining-Tests: Logik + echte Daten. node tests/mining.test.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { tagsFor, detectLanguage, detectPresentationLanguage, presentationLanguageInfo, tfidf, clusterSessions, tagStats } from "../js/mining.js";
import { TAGS } from "../js/lexicon.js";

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

// ---------- Tagging (künstliche Fälle)
t("Tagging: Flexionen + Komposita", () => {
  assert.deepEqual(tagsFor({ title: "Ukrainischunterricht im Exil", speakers: [] }), ["ukrainisch", "didaktik", "exil"]);
  assert.deepEqual(tagsFor({ title: "Corpus-based analysis of Russian", speakers: [] }), ["russisch", "korpora"]);
});
t("Tagging: Wortgrenze respektiert (kein Fehlmatch)", () => {
  assert.deepEqual(tagsFor({ title: "Populäre Musik in Serbien", speakers: [] }).includes("suedslavisch"), true);
  assert.deepEqual(tagsFor({ title: "Propaganda und Medien", speakers: [] }).includes("popkultur"), false);
});
t("Tagging: Sprecher zählen mit", () => {
  assert.deepEqual(tagsFor({ title: "Dissens", speakers: ["Maria Ukrainczyk"] }).includes("ukrainisch"), true);
});

// ---------- Sprachheuristik
t("Sprache: kyrillische Spezialzeichen", () => {
  assert.equal(detectLanguage("Стратегії перекладу"), "uk");
  assert.equal(detectLanguage("Категория вида в русском языке"), "ru");
});
t("Sprache: Funktionswörter", () => {
  assert.equal(detectLanguage("The semantics of aspect"), "en");
  assert.equal(detectLanguage("Zur Grammatik der Nominalphrase"), "de");
});
t("Sprache: Diakritika (ab 2 Zeichen)", () => {
  assert.equal(detectLanguage("Česká lexikologie 19. století"), "cs");
  assert.equal(detectLanguage("Życie i twórczość"), "pl");
});
t("Sprache: unbekannt → null", () => {
  assert.equal(detectLanguage("Nominalphrase"), null);
});
t("Vortragssprache: ausdrückliche ConfTool-Angabe hat Vorrang", () => {
  const s = {
    title: "Motivation to learn Ukrainian (The language of presentation – Ukrainian)",
    abstract: "This paper examines language learning in Germany.",
  };
  assert.deepEqual(presentationLanguageInfo(s), { lang: "uk", source: "declared" });
});
t("Vortragssprache: kyrillisches Werkzitat macht deutschen Vortrag nicht russisch", () => {
  const s = {
    title: "Schreiben in Krieg und Anthropozän: Цикл лекций als Beispiel engagierter Literatur",
    abstract: "Der Beitrag untersucht einen literarischen Text und seine Rezeption.",
  };
  assert.equal(detectPresentationLanguage(s), "de");
});
t("Vortragssprache: englischer Abstract korrigiert mehrdeutigen Kurztitel", () => {
  const s = {
    title: "Switch reference in Slavic",
    abstract: "This paper examines how reference systems work in several Slavic languages.",
  };
  assert.equal(detectPresentationLanguage(s), "en");
});

// ---------- TF-IDF
t("TF-IDF: charakteristische Begriffe", () => {
  const texts = [
    "Korpusanalyse russischer Tokamak-Dialoge",
    "Korpusanalyse polnischer Chatverläufe",
    "Ukrainistische Phonologie",
  ];
  const docs = tfidf(texts);
  assert.equal(docs.length, 3);
  assert.ok(docs[0].includes("tokamak"));
});

// ---------- Echte Daten
const program = JSON.parse(await readFile(new URL("../data/program.json", import.meta.url), "utf-8"));
const talks = program.sessions.filter((s) => s.type === "talk");
for (const s of talks) { s._tags = tagsFor(s); s._lang = detectPresentationLanguage(s); }

t("Echte Daten: jede Session hat _tags als Array", () => {
  for (const s of talks) assert.ok(Array.isArray(s._tags));
});
t("Echte Daten: russisch > 40, ukrainisch > 20, polnisch > 20", () => {
  const st = tagStats(talks);
  assert.ok(st.get("russisch") >= 40, `russisch=${st.get("russisch")}`);
  assert.ok(st.get("ukrainisch") >= 20, `ukrainisch=${st.get("ukrainisch")}`);
  assert.ok(st.get("polnisch") >= 20, `polnisch=${st.get("polnisch")}`);
});
t("Echte Daten: Cluster abdecken >= 70 % der Vorträge", () => {
  const clusters = clusterSessions(talks);
  let covered = 0;
  for (const items of clusters.values()) covered += items.length;
  const ratio = covered / talks.length;
  assert.ok(ratio >= 0.7, `nur ${Math.round(ratio * 100)} % geclustert`);
});
t("Echte Daten: Cluster-Größe == Tag-Anzahl (Multi-Label)", () => {
  const clusters = clusterSessions(talks);
  const st = tagStats(talks);
  for (const [id, items] of clusters) assert.equal(items.length, st.get(id), id);
});
t("Echte Daten: jedes Cluster hat >= 3 Vorträge", () => {
  const clusters = clusterSessions(talks);
  for (const [id, items] of clusters) {
    assert.ok(items.length >= 3, `Cluster ${id} hat nur ${items.length}`);
  }
});
t("Echte Daten: Sprachverteilung plausibel (de dominiert)", () => {
  const de = talks.filter((s) => s._lang === "de").length;
  const en = talks.filter((s) => s._lang === "en").length;
  assert.ok(de > talks.length * 0.4, `de nur ${de}`);
  assert.ok(en > 10, `en nur ${en}`);
});

await Promise.allSettled(pending);
console.log(`\n${n} Mining-Tests bestanden.`);
process.exit(failed ? 1 : 0);
