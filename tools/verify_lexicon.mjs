#!/usr/bin/env node
// Verifiziert die Lexikon-Muster gegen die echten Titel. node tools/verify_lexicon.mjs
// (Snapshot data/program.json = Stand des letzten Parsings)
import { readFile } from "node:fs/promises";
import { tagsFor, clusterSessions } from "../js/mining.js";
import { TAGS } from "../js/lexicon.js";

const program = JSON.parse(await readFile(new URL("../data/program.json", import.meta.url), "utf-8"));
const talks = program.sessions.filter((s) => s.type === "talk");
for (const s of talks) s._tags = tagsFor(s);
const clusters = clusterSessions(talks);

const counts = new Map();
for (const s of talks) for (const tag of s._tags) counts.set(tag, (counts.get(tag) || 0) + 1);

console.log(`Vorträge gesamt: ${talks.length}\n`);
for (const tag of TAGS) {
  const c = counts.get(tag.id) || 0;
  console.log(`${String(c).padStart(3)}  ${tag.label}`);
}
const uncovered = talks.filter((s) => !s._tags.length).length;
const multi = talks.filter((s) => s._tags.length > 1).length;
console.log(`\nmit Cluster: ${talks.length - uncovered}/${talks.length} (${Math.round(((talks.length - uncovered) / talks.length) * 100)} %) · mehrfach getaggt: ${multi} · ohne Cluster: ${uncovered}`);
const sizes = [...clusters.entries()].map(([id, items]) => `${id}:${items.length}`).join(" ");
console.log("Cluster-Größen:", sizes);
