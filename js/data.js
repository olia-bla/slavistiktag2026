// data.js – Laden und Verschmelzen von program.json + content.json,
// Mining-Pass über die Vorträge. Reine Funktionen sind DOM-frei testbar.

import { normalize, makeSearchText } from "./search.js";
import { tagsFor, presentationLanguageInfo } from "./mining.js";
import { TAG_BY_ID } from "./lexicon.js";

const tokenSet = (s) =>
  new Set(normalize(s).split(/[^a-zäöüа-яё0-9]+/).filter((w) => w.length > 3));

// Fachfarben gemäß offiziellem Tagungsprogramm vom 25.09.2026. Die dort
// gemeinsam aufgeführten SW-/DID-Panels sind in der Quelldatei nur als
// "SW+DID" markiert; im PDF sind diese beiden Panels jedoch eindeutig blau.
const DIDACTIC_PANEL_TITLES = new Set([
  "Fremdsprachendidaktik slavischer Sprachen",
  "Didaktik der Herkunftssprachen",
]);

export function panelDiscipline(panel, sourceTrack = "") {
  const codeDiscipline = panel?.code?.match(/^SEK_(LKW|SW|DID)(?:_|$)/)?.[1];
  if (codeDiscipline) return codeDiscipline;
  if (panel && DIDACTIC_PANEL_TITLES.has(panel.title)) return "DID";

  const parts = (panel?.track || sourceTrack || "").split("+").filter(Boolean);
  if (parts.includes("LKW")) return "LKW";
  // Die übrigen lila Panels im gemeinsamen SW-/DID-Programmteil gehören
  // laut PDF zur Sprachwissenschaft.
  if (parts.includes("SW")) return "SW";
  if (parts.includes("DID")) return "DID";
  return parts[0] || null;
}

function titleSimilar(a, b) {
  const A = tokenSet(a);
  const B = tokenSet(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / Math.min(A.size, B.size);
}

const ROOM_VENUE_RE = (content) => {
  const map = content.room_venue || {};
  return (room) => {
    if (!room) return null;
    const prefix = room.split(/\s|\d/)[0];
    if (map[prefix]) return map[prefix];
    if (map[room.trim()]) return map[room.trim()];
    return null;
  };
};

function venueFromTitle(title, content) {
  if (!title) return null;
  const map = content.room_venue || {};
  const m = title.match(/\(([^)]*)\)\s*$/);
  if (m) {
    const inner = m[1];
    for (const key of Object.keys(content.venues || {})) {
      if (inner.includes(key)) return key;
    }
    if (/Aula/i.test(inner)) return "UHG";
  }
  return null;
}

export function naturalRooms(rooms) {
  const seen = [...new Set(rooms.filter(Boolean))];
  seen.sort((a, b) => {
    const [pa, na] = [a.split(/\s+/)[0], parseInt(a.split(/\s+/)[1] || "0", 10)];
    const [pb, nb] = [b.split(/\s+/)[0], parseInt(b.split(/\s+/)[1] || "0", 10)];
    if (pa !== pb) return pa.localeCompare(pb);
    return na - nb;
  });
  return seen;
}

export function buildModel(program, content) {
  const roomVenue = ROOM_VENUE_RE(content);
  // Redaktionelle Ergänzungen aus dem offiziellen Tagungsprogramm werden
  // getrennt von der automatisch aktualisierten ConfTool-Datei gehalten.
  // So bleiben Beiträge erhalten, die die öffentliche Tabellenansicht nur als
  // unstrukturierte Fußzeile ausliefert.
  const supplements = content.program_supplements || {};
  const sourcePanels = [...(program.panels || []), ...(supplements.panels || [])];
  const automaticSessions = program.sessions || [];
  // Falls ConfTool einen redaktionell ergänzten Beitrag später selbst liefert,
  // gewinnt die automatische Quelle und es entsteht keine Dublette.
  const supplementalSessions = (supplements.sessions || []).filter((supplement) =>
    !automaticSessions.some((session) =>
      session.day === supplement.day && session.start === supplement.start && session.room === supplement.room));
  const sourceSessions = [...automaticSessions, ...supplementalSessions];
  const panels = Object.fromEntries(sourcePanels.map((p) => [p.id, p]));

  const sessions = sourceSessions.map((s) => {
    const panel = panels[s.panel_id] || null;
    const discipline = panelDiscipline(panel, s.track);
    const normalizedTrack = s.type === "talk" && panel && ["LKW", "SW", "DID"].includes(discipline)
      ? discipline
      : s.track;
    const out = {
      ...s,
      source_track: s.track,
      track: normalizedTrack,
      venue: roomVenue(s.room),
      panel_code: panel ? panel.code : null,
      panel_title: panel ? panel.title : null,
      chair: panel ? panel.chair : null,
      discipline,
    };
    out._search = makeSearchText(out, out.panel_title);
    // Suchtext ohne Chair-Feld: für die „Nur Vorträge"-Suche (Checkbox im Filter),
    // damit Chair-Treffer die Personensuche nicht fluten.
    out._searchTalks = makeSearchText({ ...out, chair: null }, out.panel_title);
    out._tags = tagsFor({ title: s.title, speakers: s.speakers });
    // Explizite Angaben aus dem Book of Abstracts ergänzen die öffentlichen
    // ConfTool-Daten, ohne die generierte program.json manuell zu verändern.
    const presentationLanguage = presentationLanguageInfo({
      ...s,
      presentation_language: content.presentation_languages?.[s.id] || s.presentation_language,
    });
    out._lang = presentationLanguage.lang;
    out._langSource = presentationLanguage.source;
    return out;
  });

  const byDay = {};
  for (const s of sessions) {
    (byDay[s.day] ||= []).push(s);
  }
  for (const day of Object.keys(byDay)) {
    byDay[day].sort((a, b) => (a.start || "").localeCompare(b.start || "") || (a.room || "").localeCompare(b.room || ""));
  }

  const confDays = [];
  if (content.conference?.start && content.conference?.end) {
    const d = new Date(content.conference.start + "T12:00:00");
    const end = new Date(content.conference.end + "T12:00:00");
    while (d <= end) {
      confDays.push(d.toISOString().slice(0, 10));
      d.setDate(d.getDate() + 1);
    }
  }
  const days = [...new Set([
    ...confDays,
    ...(program.blocks || []).map((b) => b.day),
    ...Object.keys(byDay),
  ])].filter(Boolean).sort();

  // Events vereinheitlichen: Quelle (ConfTool/PDF) + kuratierte Inhalte.
  // Kuratierte Einträge ersetzen Quell-Events mit gleichem Tag + ähnlichem Titel
  // (Podien, Sonderformate, Rahmenprogramm), damit nichts doppelt erscheint.
  const events = [];
  let evIdx = 0;
  const supplementedPanelTitles = new Set((supplements.panels || []).map((panel) => panel.title));
  for (const e of program.events || []) {
    // Die Vorträge dieses Panels stehen bereits als normale LKW-Sessions im
    // Raster. Die unstrukturierte Quell-Fußzeile darf nicht zusätzlich als
    // vollbreite Veranstaltung erscheinen.
    if (supplementedPanelTitles.has(e.title)) continue;
    events.push({
      ...e,
      id: `ev-${evIdx++}`,
      type: "special",
      track: null,
      discipline: null,
      source: "conftool",
    });
  }
  const dropSimilar = (p) => {
    const idx = events.findIndex((e) =>
      e.day === p.day && titleSimilar(e.title, p.title) >= 0.5);
    if (idx >= 0) events.splice(idx, 1);
  };
  for (const p of content.podiums || []) {
    dropSimilar(p);
    events.push({ ...p, id: `ev-${evIdx++}`, type: "podium", source: "curated" });
  }
  for (const e of content.special || []) {
    dropSimilar(e);
    events.push({ ...e, id: `ev-${evIdx++}`, type: "special", source: "curated" });
  }
  for (const e of content.accompanying || []) {
    dropSimilar(e);
    const formats = e.formats?.length ? e.formats : ["rahmen"];
    const type = formats.includes("rahmen") ? "rahmen" : formats[0];
    events.push({ ...e, formats, id: `ev-${evIdx++}`, type, source: "curated" });
  }
  events.sort((a, b) => (a.day || "").localeCompare(b.day || "") || (a.start || "99").localeCompare(b.start || "99"));

  const eventByDay = {};
  for (const e of events) {
    (eventByDay[e.day] ||= []).push(e);
  }

  const byId = Object.fromEntries(sessions.map((s) => [s.id, s]));

  return {
    conference: content.conference,
    content,
    days,
    dayLabels: Object.fromEntries((program.blocks || [])
      .filter((b) => b.day_label)
      .map((b) => [b.day, b.day_label])),
    sessions,
    byDay,
    byId,
    panels,
    events,
    eventByDay,
    // Der Raumfilter muss auch Räume von Podien/Sonderformaten und von
    // ConfTool-Sitzungen ohne einzelne Präsentationen enthalten (z. B. HS 2).
    rooms: naturalRooms([
      ...sessions.map((s) => s.room),
      ...events.map((e) => e.room),
      ...Object.values(panels).map((p) => p.room),
    ]),
    tracks: ["DID", "SW", "LKW"],
    meta: program.meta,
  };
}

// LLM-Tags (data/llm_tags.json) auf das Modell anwenden. Überschreibt die
// Lexikon-Tags pro Session, wenn LLM-Tags vorliegen (Seam: s._tags wird von
// mining.clusterSessions/tagStats gelesen). Unbekannte tag-ids werden
// verworfen, Sessions ohne LLM-Tags behalten das Lexikon-Tagging.
// model.llmTagsMeta/llmTagsApplied dokumentieren Quelle + Umfang.
export function applyLlmTags(model, llm) {
  const tags = llm?.tags || {};
  let applied = 0;
  for (const s of model.sessions) {
    const llmTags = (tags[s.id] || []).filter((t) => TAG_BY_ID[t]);
    if (llmTags.length) {
      s._llm_tags = llmTags;
      s._tags = llmTags;
      s._tagSource = "llm";
      applied++;
    } else {
      s._tagSource = "lexikon";
    }
  }
  model.llmTagsMeta = llm?.meta || null;
  model.llmTagsApplied = applied;
  return model;
}

export async function loadData(fetchFn = fetch) {
  const [progRes, contRes] = await Promise.all([
    fetchFn("data/program.json"),
    fetchFn("data/content.json"),
  ]);
  if (!progRes.ok) throw new Error(`program.json: HTTP ${progRes.status}`);
  if (!contRes.ok) throw new Error(`content.json: HTTP ${contRes.status}`);
  const program = await progRes.json();
  const content = await contRes.json();
  const model = buildModel(program, content);

  // LLM-Tagging nachladen (nicht-kritisch): bei Fehler/Feilen bleibt das
  // Lexikon-Tagging aktiv.
  try {
    const llmRes = await fetchFn("data/llm_tags.json");
    if (llmRes.ok) applyLlmTags(model, await llmRes.json());
  } catch {
    // llm_tags.json fehlt oder ist defekt → Lexikon-Tags bleiben aktiv
  }

  // Änderungs-Diff des letzten Syncs (nicht-kritisch, Datei kann fehlen)
  try {
    const chRes = await fetchFn("data/changes.json");
    if (chRes.ok) model.changes = await chRes.json();
  } catch {
    /* ohne changes.json kein Änderungs-Hinweis */
  }
  return model;
}
