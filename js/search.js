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

export function matchesQuery(searchText, q) {
  const nq = normalize(q);
  if (!nq) return true;
  // alle Begriffe müssen vorkommen (UND-Verknüpfung)
  return nq.split(" ").every((term) => searchText.includes(term));
}

export function filterSessions(sessions, state) {
  return sessions.filter((s) => {
    // „Nur Vorträge“ (Checkbox): Suche nur über Titel/Sprecher:innen/Raum/Panels,
    // nicht über das Chair-Feld – Chair-Treffer sind bei Personensuche Rauschen.
    if (state.q && !matchesQuery(state.talksOnly && s._searchTalks ? s._searchTalks : (s._search || normalize(s.title)), state.q)) return false;
    if (state.day && s.day !== state.day) return false;
    if (state.room && s.room !== state.room) return false;
    if (state.slot && s.start !== state.slot) return false;
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
  if (s.type === "talk") {
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
