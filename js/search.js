// search.js – Normalisierung, Filterung, Hervorhebung (DOM-frei testbar)

export function normalize(s) {
  let out = (s || "")
    .toLowerCase()
    .replace(/ß/g, "ss")
    .normalize("NFD");
  // Diakritika nur bei lateinischen Basiszeichen entfernen (Kyrillisch behalten)
  let res = "";
  for (const ch of out) {
    if (/[\u0300-\u036f]/.test(ch)) {
      const last = res[res.length - 1];
      if (last && /[\u0400-\u04ff]/.test(last)) res += ch; // kyrillische Basis: behalten
      continue;
    }
    res += ch;
  }
  return res
    .replace(/[\u2010-\u2015\u00ad]/g, "-") // diverse Bindestriche
    .replace(/\s+/g, " ")
    .trim();
}

export function makeSearchText(session, panelTitle) {
  const room = session.room || "";
  const venue = session.venue || "";
  return normalize(
    [session.title, (session.speakers || []).join(" "), panelTitle, session.chair,
     room, venue, session.sek_code, session.track, session.abstract]
      .filter(Boolean).join(" "));
}

// Kleine Tippfehler in längeren Suchbegriffen tolerieren. Neben einem
// Einfüge-/Lösch-/Ersetzfehler wird auch die häufige Vertauschung zweier
// benachbarter Buchstaben erkannt (z. B. „Nadyia“ statt „Nadiya“).
function withinOneEdit(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  if (a.length === b.length) {
    const diff = [];
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff.push(i);
    if (diff.length === 1) return true;
    return diff.length === 2 && diff[1] === diff[0] + 1 &&
      a[diff[0]] === b[diff[1]] && a[diff[1]] === b[diff[0]];
  }
  const [shorter, longer] = a.length < b.length ? [a, b] : [b, a];
  let i = 0, j = 0, skipped = false;
  while (i < shorter.length && j < longer.length) {
    if (shorter[i] === longer[j]) { i++; j++; continue; }
    if (skipped) return false;
    skipped = true;
    j++;
  }
  return true;
}

export function matchesQuery(searchText, q) {
  const nq = normalize(q);
  if (!nq) return true;
  const terms = nq.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const words = normalize(searchText).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  // Alle Begriffe müssen vorkommen (UND-Verknüpfung). Ab fünf Zeichen ist
  // alternativ genau ein Tippfehler erlaubt; kurze Begriffe bleiben exakt.
  return terms.every((term) => searchText.includes(term) ||
    (term.length >= 5 && words.some((word) => withinOneEdit(term, word))));
}

export const TIME_SLOTS = [
  { value: "09:00-11:00", label: "09:00–11:00", from: 9 * 60, to: 11 * 60 },
  { value: "11:30-13:00", label: "11:30–13:00", from: 11 * 60 + 30, to: 13 * 60 },
  { value: "14:00-15:30", label: "14:00–15:30", from: 14 * 60, to: 15 * 60 + 30 },
  { value: "16:00-17:30", label: "16:00–17:30", from: 16 * 60, to: 17 * 60 + 30 },
  { value: "after-program", label: "nach dem Vortragsende", afterProgram: true },
];

const AFTER_PROGRAM_START = {
  "2026-09-30": 20 * 60,
  "2026-10-01": 18 * 60,
  "2026-10-02": 18 * 60,
  "2026-10-03": 13 * 60,
};

export function matchesTimeSlot(start, value, day = "") {
  if (!value) return true;
  const [hours, minutes] = (start || "").split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return false;
  const startMinutes = hours * 60 + minutes;
  const slot = TIME_SLOTS.find((candidate) => candidate.value === value);
  // Alte Deep-Links mit einer einzelnen Beginnzeit bleiben gültig.
  if (!slot) return start === value;
  if (slot.afterProgram) {
    const cutoff = AFTER_PROGRAM_START[day] ?? 18 * 60;
    return startMinutes >= cutoff;
  }
  return startMinutes >= slot.from && startMinutes <= slot.to;
}

export function filterSessions(sessions, state) {
  return sessions.filter((s) => {
    // „Nur Vorträge“ (Checkbox): Suche nur über Titel/Sprecher:innen/Raum/Panels,
    // nicht über das Chair-Feld – Chair-Treffer sind bei Personensuche Rauschen.
    if (state.q && !matchesQuery(state.talksOnly && s._searchTalks ? s._searchTalks : (s._search || normalize(s.title)), state.q)) return false;
    if (state.day && s.day !== state.day) return false;
    if (state.room && s.room !== state.room) return false;
    if (state.slot && !matchesTimeSlot(s.start, state.slot, s.day)) return false;
    if (state.panel && s.panel_id !== state.panel) return false;
    if (state.type && s.type !== state.type) return false;
    if (state.tracks && state.tracks.length) {
      if (!s.track) return false;
      const parts = s.track.split("+");
      if (!state.tracks.some((t) => parts.includes(t))) return false;
    }
    if (state.formats && state.formats.length) {
      const f = formatOf(s);
      if (!state.formats.includes(f)) return false;
    }
    return true;
  });
}

export function formatOf(s) {
  if (s.type === "break") return "pause";
  if (s.type === "discussion") return "panel";
  if (s.type === "talk") {
    if (s.discipline === "X" || s.track === "X") return "special";
    // Jeder Vortrag gehört im Programm-PDF zu einem Block "Sektionen und Panels":
    // SEK_-Code → Thematische Sektion, sonst → eingereichtes Panel (PDF-Kopfzeile "Panel").
    return (s.panel_code ? "sektion" : "panel");
  }
  return s.type || "sonstiges";
}

export function findMarks(text, q) {
  const nq = normalize(q);
  if (!nq) return [];
  const terms = nq.split(" ").filter((t) => t.length > 2);
  if (!terms.length) return [];
  // Hervorhebung im Originaltext: Begriffe case-insensitive suchen
  // (pragmatisch: exakter Term im lowercase-Original, keine Diakritika-Faltung)
  const lowered = text.toLowerCase();
  const marks = [];
  for (const term of terms) {
    let idx = 0;
    while (idx < lowered.length) {
      const direct = lowered.indexOf(term, idx);
      if (direct === -1) break;
      marks.push([direct, direct + term.length]);
      idx = direct + term.length;
    }
  }
  if (!marks.length) return [];
  // überlappende Markierungen mergen
  marks.sort((a, b) => a[0] - b[0]);
  const merged = [marks[0]];
  for (const [a, b] of marks.slice(1)) {
    const last = merged[merged.length - 1];
    if (a <= last[1]) last[1] = Math.max(last[1], b);
    else merged.push([a, b]);
  }
  return merged;
}

export function highlight(text, q) {
  const merged = findMarks(text, q);
  if (!merged.length) return null;
  let out = "";
  let pos = 0;
  for (const [a, b] of merged) {
    out += escapeH(text.slice(pos, a)) + "<mark>" + escapeH(text.slice(a, b)) + "</mark>";
    pos = b;
  }
  out += escapeH(text.slice(pos));
  return out;
}

// Ausschnitt um den ersten Treffer (für Ergebnislisten): Fenster von ~radius
// Zeichen um den ersten Treffer, erweitert auf nachfolgende Treffer im Fenster.
export function snippet(text, q, radius = 150) {
  const merged = findMarks(text, q);
  if (!merged.length) return null;
  const [fa, ] = merged[0];
  let lo = Math.max(0, fa - 60);
  let hi = Math.min(text.length, fa + radius);
  for (const [a, b] of merged.slice(1)) {
    if (a < hi) hi = Math.min(text.length, Math.max(hi, b + 20));
  }
  // Wortgrenzen schonen
  if (lo > 0) {
    const ws = text.slice(0, lo).search(/\s\S*$/);
    if (ws !== -1) lo = ws + 1;
  }
  if (hi < text.length) {
    const ws = text.slice(hi).search(/\s/);
    if (ws !== -1) hi += ws;
  }
  const body = highlight(text.slice(lo, hi), q) || escapeH(text.slice(lo, hi));
  return (lo > 0 ? "… " : "") + body + (hi < text.length ? " …" : "");
}

function escapeH(s) {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
