// views/speakers.js – Personen-Index A–Z (Vorträge, Chairs und Veranstaltungen)
// Indexformat „Nachname, Vorname" (wissenschaftliche Konvention); Karten und
// Drawer zeigen weiterhin „Vorname Nachname".
import { h, dateLabel } from "../util.js";
import { eventCard, sessionCard } from "./program.js";

// Akademische Präfix-Titel sind im Datensatz inkonsistent vergeben (Chairs stehen
// mit „Prof. Dr.", Sprecher:innen ohne) — dieselbe Person_landet sonst doppelt im
// Index. Für die IDENTITÄT wird gestrippt, angezeigt wird der Name ohne Titel
// (konsistent zu den Vortragskarten). Exportiert für tests/speakers.test.mjs.
const TITLE_TOKEN_RE =
  /^(?:(?:Univ\.-?|Auß\.-?|apl\.-?)?Prof\.?(?:\s*em\.)?|Dr\.(?:\s*(?:h\.c\.|rer\.\s*nat\.|phil\.|med\.|theol\.)(?:\s*mult\.)?)?|PD|habil\.|Ph\.\s?D\.|D\.phil\.)\s+/i;
export function stripTitles(raw) {
  let n = String(raw).trim();
  for (let i = 0; i < 4; i++) {
    const m = n.replace(TITLE_TOKEN_RE, "");
    if (m === n) break;
    n = m;
  }
  return n;
}

// Nachnamen-Partikel: Mehrwort-Nachnamen korrekt behandeln
// („Evert van der Zweerde" → „van der Zweerde, Evert", nicht „Zweerde, Evert van der").
const PARTICLES = new Set([
  "van", "von", "der", "den", "de", "del", "della", "di", "da", "du",
  "la", "le", "zu", "zur", "im", "aus", "ter", "ten", "te",
]);

// „Vorname Nachname" → „Nachname, Vorname"; Klammern-Zusatz (Geburtsname o.ä.)
// bleibt erhalten: „Liudmyla Mobius (Pidkuimukha)" → „Mobius, Liudmyla (Pidkuimukha)"
export function nameParts(raw) {
  const extra = raw.match(/\(([^)]*)\)/)?.[1];
  const name = raw.replace(/\s*\([^)]*\)\s*/, "").trim();
  const words = name.split(/\s+/);
  let last = words.pop() || name;
  while (words.length && PARTICLES.has(words[words.length - 1].toLowerCase())) {
    last = words.pop() + " " + last;
  }
  const base = words.length ? `${last}, ${words.join(" ")}` : last;
  return { display: extra ? `${base} (${extra})` : base, sortKey: base.toLowerCase() };
}

// Ein Speaker-Feld kann mehrere Personen enthalten („Arkady Kruglov, Tim-Robin
// Rösler-Bartsch“ aus dem PDF). Heuristik: nur splitten, wenn jeder Teil mit
// Großbuchstaben beginnt und ≥ 2 Wörter hat („Nachname, Vorname“-Felder gibt
// es im Datensatz nicht).
export function splitPeople(raw) {
  const parts = String(raw).split(/\s*,\s*/);
  if (parts.length < 2) return [String(raw)];
  const allNames = parts.every(
    (p) => p.trim().split(/\s+/).length >= 2 && /^[\p{Lu}]/u.test(p.trim()));
  return allNames ? parts : [String(raw)];
}

const podiumCount = (count) => `${count} ${count === 1 ? "Podium" : "Podien"}`;
const specialCount = (count) => `${count} Sonderformat${count === 1 ? "" : "e"}`;

// Eintrag: { name, sortKey, talks, discussantOf, chairOf, podiumOf, specialOf }
export function buildSpeakerIndex(model) {
  const map = new Map();
  const specialParticipantSlots = new Set((model.events || [])
    .filter((event) => event.type === "special")
    .flatMap((event) => (event.participants || []).map((participant) =>
      `${event.day}|${event.start}|${event.room}|${stripTitles(participant.name)}`)));
  const add = (raw, role, session, eventPerson = null) => {
    for (const one of splitPeople(raw)) {
      // Identität = Name OHNE akademische Titel: Chairs stehen im ConfTool
      // mit „Prof. Dr.", Sprecher:innen ohne — dieselbe Person sonst doppelt.
      const key = stripTitles(one.trim());
      if (!key) continue;
      if (!map.has(key)) map.set(key, {
        raw: key, ...nameParts(key), talks: [], discussantOf: [], chairOf: [], podiumOf: [], specialOf: [],
      });
      const entry = map.get(key);
      if (role === "chair") entry.chairOf.push(session);
      else if (role === "discussant") entry.discussantOf.push(session);
      else if (role === "podium") entry.podiumOf.push({ event: session, role: eventPerson.role });
      else if (role === "special") entry.specialOf.push({ event: session, participant: eventPerson });
      else entry.talks.push(session);
    }
  };
  for (const s of model.sessions) {
    if (s.type !== "talk" && s.type !== "discussion") continue;
    for (const sp of s.speakers || []) {
      // Ein Sonderformat kann in ConfTool zusätzlich als Vortrag stehen.
      // Auf der Personenseite soll derselbe Auftritt nur einmal erscheinen.
      if (s.type === "talk" && specialParticipantSlots.has(`${s.day}|${s.start}|${s.room}|${stripTitles(sp)}`)) continue;
      add(sp, s.type === "discussion" ? "discussant" : "speaker", s);
    }
    if (s.type === "talk" && s.chair) add(s.chair, "chair", s);
  }
  for (const event of model.events || []) {
    if (event.type !== "podium" && event.type !== "special") continue;
    for (const participant of event.participants || []) {
      add(participant.name, event.type, event, participant);
    }
  }
  return [...map.values()].sort((a, b) => a.sortKey.localeCompare(b.sortKey, "de"));
}

export function renderSpeakers(model, ctx) {
  const people = buildSpeakerIndex(model);
  const wrap = h("div", { class: "view view-speakers" },
    h("header", { class: "hero compact" },
      h("h1", { text: "Personen A–Z" }),
      h("p", { class: "meta", text: `${people.length} Personen, sortiert nach Nachname – Vortragende, Chairs und Beteiligte an Podien und Sonderformaten. Klick auf einen Namen zeigt die zugehörigen Programmpunkte.` })));

  const search = h("input", {
    type: "search", class: "search-input", placeholder: "Name suchen …",
    "aria-label": "Personensuche",
  });
  const list = h("div", { class: "speaker-list" });
  const renderList = () => {
    const q = search.value.trim().toLowerCase();
    list.textContent = "";
    const visible = people.filter((p) => !q || p.sortKey.includes(q));
    if (!visible.length) {
      list.append(h("p", { class: "empty", text: "Keine Person gefunden." }));
      return;
    }
    let lastLetter = "";
    for (const p of visible) {
      const letter = p.sortKey[0].toUpperCase();
      if (letter !== lastLetter) {
        lastLetter = letter;
        list.append(h("div", { class: "speaker-letter", text: letter }));
      }
      const href = `#/sprecher/${encodeURIComponent(p.raw)}`;
      const btn = h("a", { class: "speaker-row", href },
        h("span", { class: "speaker-name", text: p.display }),
        h("span", { class: "speaker-count dim" },
          [p.talks.length ? `${p.talks.length} Vortrag${p.talks.length === 1 ? "" : "e"}` : "",
           p.discussantOf.length ? `${p.discussantOf.length}× Discussant` : "",
           p.chairOf.length ? `${p.chairOf.length}× Chair` : "",
           p.podiumOf.length ? podiumCount(p.podiumOf.length) : "",
           p.specialOf.length ? specialCount(p.specialOf.length) : "",
          ].filter(Boolean).join(" · ")));
      list.append(btn);
    }
  };
  search.addEventListener("input", renderList);
  renderList();

  wrap.append(search, list);
  return wrap;
}

// Personen-Detailansicht: Vorträge, Chair-Rollen, Podien und Sonderformate.
// Route: #/sprecher/<encodeURIComponent(raw)>
export function renderPerson(model, ctx, rawName) {
  const people = buildSpeakerIndex(model);
  const p = people.find((x) => x.raw === rawName);
  const wrap = h("div", { class: "view view-person" });

  if (!p) {
    wrap.append(
      h("header", { class: "hero compact" },
        h("h1", { text: "Person nicht gefunden" }),
        h("p", { class: "meta", text: `„${rawName}“ ist nicht in der Personenübersicht. Eventuell hat sich das Programm geändert.` })),
      h("a", { class: "btn ghost", href: "#/sprecher", text: "← Zurück zur Übersicht" }));
    return wrap;
  }

  const items = [
    ...p.talks.map((s) => ({ s, role: "" })),
    ...p.discussantOf.map((s) => ({ s, role: "Discussant" })),
    ...p.chairOf.map((s) => ({ s, role: "Chair" })),
    ...p.podiumOf.map(({ event, role }) => ({ s: event, role: "podium", podiumRole: role })),
    ...p.specialOf.map(({ event, participant }) => ({ s: event, role: "special", eventPerson: participant })),
  ].sort((a, b) => (a.s.day + a.s.start).localeCompare(b.s.day + b.s.start));

  const affis = new Set();
  const curatedAffiliation = model.content?.person_affiliations?.[p.raw];
  if (curatedAffiliation) {
    affis.add(curatedAffiliation);
  } else {
    for (const s of p.talks) {
      // Identität = gestrippter Name (gleiche Regel wie buildSpeakerIndex)
      const i = (s.speakers || []).findIndex((sp) => stripTitles(sp) === p.raw);
      if (i >= 0 && s.affiliations?.[i]) affis.add(s.affiliations[i]);
    }
  }
  for (const { participant } of p.specialOf) {
    if (participant.affiliation && !curatedAffiliation) affis.add(participant.affiliation);
    if (participant.location) affis.add(participant.location);
    if (participant.info) affis.add(participant.info);
  }

  const hero = h("header", { class: "hero compact" },
    h("p", { class: "kicker" }, h("a", { href: "#/sprecher", text: "← Personen" })),
    h("h1", { text: p.display }),
    h("p", { class: "meta", text:
      [p.talks.length ? `${p.talks.length} Vortrag${p.talks.length === 1 ? "" : "e"}` : "",
       p.discussantOf.length ? `${p.discussantOf.length}× Discussant` : "",
       p.chairOf.length ? `${p.chairOf.length}× Chair` : "",
       p.podiumOf.length ? podiumCount(p.podiumOf.length) : "",
       p.specialOf.length ? specialCount(p.specialOf.length) : "",
       [...affis].join(" · ")].filter(Boolean).join(" · ") }));

  wrap.append(hero);

  let lastDay = "";
  for (const { s, role, podiumRole, eventPerson } of items) {
    if (s.day !== lastDay) {
      lastDay = s.day;
      wrap.append(h("div", { class: "day-divider" },
        h("span", { class: "day-name", text: dateLabel(s.day) })));
    }
    if (role === "podium" || role === "special") {
      wrap.append(h("div", { class: "slot-block" },
        h("div", { class: "slot-head" }, h("span", { text: podiumRole || eventPerson?.role || "Mitwirkung" })),
        eventCard(model, ctx, s)));
    } else if (role === "Chair") {
      wrap.append(h("div", { class: "slot-block" },
        h("div", { class: "slot-head" },
          h("span", { text: `${s.start}–${s.end}` }),
          h("span", { class: "pill", text: "Chair" })),
        h("div", { class: "card session-card chair-entry", onclick: () => ctx.openSession(s.id), tabindex: "0", role: "button" },
          h("div", { class: "card-title", text: s.panel_title || s.title }),
          s.room ? h("span", { class: "meta", text: s.room }) : null)));
    } else {
      wrap.append(sessionCard(model, ctx, s, {}));
    }
  }
  return wrap;
}
