// views/program.js – Programm: Filterleiste, Grid- und Listenansicht
import { h, dateLabel, timeRange, debounce, minutes } from "../util.js";
import { filterSessions, formatOf, highlight, snippet } from "../search.js";
import { favs } from "../favorites.js";
import { roomLink } from "../rooms.js";
import { stripTitles } from "./speakers.js";

// Läuft diese Veranstaltung „jetzt“? Nur während der Konferenztage; der
// Zeitpunkt ist per ctx.now injizierbar (Tests).
export function isRunningNow(model, x, now = new Date()) {
  if (!x || !x.day || !x.start || !x.end) return false;
  const d = new Date(now);
  const p = (n) => String(n).padStart(2, "0");
  const today = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  if (x.day !== today) return false;
  const m = minutes(x.start), end = minutes(x.end), tm = d.getHours() * 60 + d.getMinutes();
  return tm >= m && tm < end;
}

const TRACK_LABELS = { DID: "Fachdidaktik", SW: "Sprachwissenschaft", LKW: "Literatur-/Kulturwiss." };
// Sprach-Badge (Heuristik aus mining.detectLanguage, s. Info-Ansicht):
// nur nicht-deutsche Vorträge werden markiert; „de" bleibt unbezeichnet.
const LANG_BADGES = {
  ru: { label: "RU", title: "Vortragstitel auf Russisch (Heuristik)" },
  uk: { label: "UK", title: "Vortragstitel auf Ukrainisch (Heuristik)" },
  pl: { label: "PL", title: "Vortragstitel auf Polnisch (Heuristik)" },
  en: { label: "EN", title: "Vortragstitel auf Englisch (Heuristik)" },
  cs: { label: "CS", title: "Vortragstitel auf Tschechisch (Heuristik)" },
};
function langBadge(lang) {
  const b = LANG_BADGES[lang];
  return b ? h("span", { class: "pill lang", text: b.label, title: b.title }) : null;
}
const FORMAT_LABELS = {
  pause: "Pausen", podium: "Podiumsdiskussionen", special: "Sonderformate", rahmen: "Rahmenprogramm",
};
const OPTIONAL_FORMATS = ["podium", "special", "rahmen", "pause"];

export function renderProgram(model, ctx, params) {
  const state = readState(model, params);

  const wrap = h("div", { class: "view view-program" });
  wrap.append(filterBar(model, ctx, state));
  const results = h("div", { class: "results" });
  wrap.append(results);
  const update = () => renderResults(model, ctx, state, results);
  ctx._programHook(state, results);
  update();
  return wrap;
}

function readState(model, params) {
  const q = params.get("q") || "";
  const dayParam = params.get("day");
  const legacyFormats = params.getAll("format").filter((format) => OPTIONAL_FORMATS.includes(format));
  const hiddenFormats = params.getAll("hide").filter((format) => OPTIONAL_FORMATS.includes(format));
  const browseDefault = model.days.includes(todayIso()) && inConf(model)
    ? todayIso()
    : model.days.find((d) => d !== model.conference.start) || model.days[0];
  const st = {
    q,
    // Volltextsuche ohne explizite Tag-Wahl durchsucht alle Tage; beim reinen
    // Stöbern bleibt der Konferenz-Default-Tag (heute bzw. erster Vortragstag).
    day: dayParam === "all" ? "" : (dayParam ?? (q ? "" : browseDefault)),
    room: params.get("room") || "",
    slot: params.get("slot") || "",
    panel: params.get("panel") || "",
    tracks: params.getAll("track"),
    // Diese vier Kategorien sind standardmäßig sichtbar. Ein entferntes
    // Häkchen wird als Ausschluss in der URL gespeichert. Alte ?format=-Links
    // bleiben als reine Auswahl weiterhin verständlich.
    hiddenFormats: hiddenFormats.length || !legacyFormats.length
      ? hiddenFormats
      : OPTIONAL_FORMATS.filter((format) => !legacyFormats.includes(format)),
    // „Nur Vorträge": Chair-Treffer bei Personensuche ausblenden (Checkbox)
    talksOnly: params.get("talks") === "1",
  };
  st.dayExplicit = dayParam != null; // Tag vom User gewählt (Chip/URL), nicht impliziter Browse-Default
  return st;
}

function todayIso() {
  const p = (n) => String(n).padStart(2, "0");
  const d = new Date();
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function inConf(model) {
  const t = todayIso();
  return t >= model.conference.start && t <= model.conference.end;
}

function writeHash(model, state) {
  const p = new URLSearchParams();
  if (state.q) p.set("q", state.q);
  if (state.day) p.set("day", state.day); else p.set("day", "all");
  if (state.room) p.set("room", state.room);
  if (state.slot) p.set("slot", state.slot);
  if (state.panel) p.set("panel", state.panel);
  for (const t of state.tracks) p.append("track", t);
  for (const f of state.hiddenFormats) p.append("hide", f);
  if (state.talksOnly) p.set("talks", "1");
  const hash = `#/programm${p.toString() ? "?" + p.toString() : ""}`;
  if (location.hash !== hash) history.replaceState(null, "", hash);
}

function filterBar(model, ctx, state) {
  const sync = debounce(() => {
    writeHash(model, state);
    ctx.rerenderProgram();
  }, 300);
  ctx._programSync = () => { writeHash(model, state); ctx.rerenderProgram(); };

  const search = h("input", {
    type: "search", class: "search-input", placeholder: "Suche: Titel, Personen, Räume, Panels …",
    value: state.q, "aria-label": "Volltextsuche",
    oninput: () => {
      // Erste Suche hebt den impliziten Browse-Default-Tag auf (alle Tage);
      // ein explizit gewählter Tag bleibt aktiv.
      if (!state.dayExplicit) state.day = "";
      state.q = search.value;
      sync();
    },
  });

  const checks = (label, options, key, dotClass) => {
    const box = h("fieldset", { class: "check-group" },
      h("legend", { text: label }));
    for (const { value, text } of options) {
      const cb = h("input", { type: "checkbox", value, checked: state[key].includes(value) });
      cb.addEventListener("change", () => {
        state[key] = cb.checked ? [...state[key], value] : state[key].filter((x) => x !== value);
        sync();
      });
      box.append(h("label", { class: "check" }, cb,
        dotClass ? h("span", { class: `legend-dot ${dotClass(value)}`, "aria-hidden": "true" }) : null,
        h("span", { text })));
    }
    return box;
  };

  const visibilityChecks = (label, options) => {
    const box = h("fieldset", { class: "check-group visibility-filters" },
      h("legend", { text: label }));
    for (const { value, text } of options) {
      const cb = h("input", {
        type: "checkbox", value, checked: !state.hiddenFormats.includes(value),
        "aria-label": `${text} anzeigen`,
      });
      cb.addEventListener("change", () => {
        state.hiddenFormats = cb.checked
          ? state.hiddenFormats.filter((format) => format !== value)
          : [...new Set([...state.hiddenFormats, value])];
        sync();
      });
      box.append(h("label", { class: "check" }, cb, h("span", { text })));
    }
    return box;
  };

  const select = (label, options, key, onChange) => {
    const sel = h("select", { "aria-label": label },
      h("option", { value: "", text: label }),
      options.map((o) => h("option", { value: o.value, selected: state[key] === o.value, text: o.text })));
    sel.addEventListener("change", () => { state[key] = sel.value; sync(); });
    return sel;
  };

  const roomOpts = model.rooms.map((r) => ({ value: r, text: r }));
  const slotOpts = [...new Set(model.sessions.filter((s) => s.type === "talk").map((s) => s.start))]
    .sort().map((s) => ({ value: s, text: s }));
  const panelOpts = Object.values(model.panels)
    .sort((a, b) => (a.day + a.block_start).localeCompare(b.day + b.block_start))
    .map((p) => ({ value: p.id, text: `${p.code ? p.code + " " : ""}${p.title || "?"}`.slice(0, 90) }));

  // „Nur Vorträge": erscheint nur bei aktiver Suche (ohne Suche ohne Bedeutung);
  // blendet Treffer aus, die NUR über das Chair-Feld passen.
  const talksOnlyCb = h("input", {
    type: "checkbox", class: "talks-only-cb", checked: state.talksOnly,
    "aria-label": "Nur Vorträge (Chair-Treffer ausblenden)",
  });
  talksOnlyCb.addEventListener("change", () => {
    state.talksOnly = talksOnlyCb.checked;
    sync();
  });
  const talksOnlyWrap = h("label", { class: `check talks-only ${state.q ? "" : "hidden"}`, title: "Sucht nur in Titel, Personen, Raum, Panels – nicht in der Chair-Zeile" },
    talksOnlyCb, h("span", { text: "Nur Vorträge" }));

  const advanced = h("div", { id: "program-advanced-filters", class: "filter-advanced" },
    h("div", { class: "filter-row filter-selects" },
      select("Raum", roomOpts, "room"),
      select("Zeit", slotOpts, "slot"),
      select("Panel/Sektion", panelOpts, "panel")),
    h("div", { class: "filter-row filter-options" },
      checks("Disziplin", [
        { value: "DID", text: TRACK_LABELS.DID },
        { value: "SW", text: TRACK_LABELS.SW },
        { value: "LKW", text: TRACK_LABELS.LKW },
      ], "tracks", (v) => `dot-${v.toLowerCase()}`),
      visibilityChecks("Anzeigen", [
        { value: "podium", text: FORMAT_LABELS.podium },
        { value: "special", text: FORMAT_LABELS.special },
        { value: "rahmen", text: FORMAT_LABELS.rahmen },
        { value: "pause", text: FORMAT_LABELS.pause },
      ]),
      h("button", {
        class: "btn ghost", text: "Filter zurücksetzen",
        onclick: () => {
          Object.assign(state, { q: "", room: "", slot: "", panel: "", tracks: [], hiddenFormats: [], talksOnly: false });
          writeHash(model, state);
          ctx.render();
        },
      })));
  return h("div", { class: "filter-bar" },
    h("div", { class: "filter-row filter-search-row" }, search, talksOnlyWrap),
    advanced);
}

export function renderResults(model, ctx, state, results) {
  // Checkbox-Sichtbarkeit folgt der aktuellen Suche (die Filterleiste selbst
  // wird bei Tastendruck nicht neu gezeichnet – nur die Results).
  const talksOnlyEl = document.querySelector(".talks-only");
  if (talksOnlyEl) talksOnlyEl.classList.toggle("hidden", !state.q);
  results.textContent = "";

  const sessions = filterSessions(model.sessions, state)
    .filter((session) => !state.hiddenFormats.includes(formatOf(session)));
  const events = (state.day ? (model.eventByDay[state.day] || []) : model.events)
    .filter((event) => filterEvent(event, state));
  const count = sessions.filter((s) => s.type === "talk").length + events.length;
  const allDays = state.day ? [state.day] : model.days;

  // Hinweis, wenn die Tag-Suche leer ist, andere Tage aber Treffer hätten
  let hint = null;
  if (!count && state.day && state.q) {
    const globalState = { ...state, day: "" };
    const globalHits =
      filterSessions(model.sessions, globalState)
        .filter((session) => !state.hiddenFormats.includes(formatOf(session)))
        .filter((s) => s.type === "talk").length +
      model.events.filter((e) => filterEvent(e, globalState)).length;
    if (globalHits > 0) {
      hint = h("button", {
        class: "btn ghost",
        text: `„${state.q}“ auf allen Tagen suchen (${globalHits} Treffer)`,
        onclick: () => { state.day = ""; ctx._programSync(); },
      });
    }
  }

  const dayTabs = h("div", { class: "day-tabs", role: "tablist", "aria-label": "Tag wählen" },
    h("button", {
      class: `chip ${state.day ? "" : "active"}`,
      text: "Alle Tage",
      onclick: () => { state.day = ""; ctx._programSync(); },
    }),
    model.days
      .filter((d) => (model.byDay[d] || []).length || (model.eventByDay[d] || []).length)
      .map((d) => h("button", {
        class: `chip ${state.day === d ? "active" : ""}`,
        text: dateLabel(d),
        onclick: () => { state.day = d; ctx._programSync(); },
      })));
  const head = h("div", { class: "results-head" },
    h("span", { text: `${count} Treffer${state.day ? "" : " (alle Tage)"}` }),
    h("div", { class: "view-toggle" },
      gridBtn(ctx, "grid"), gridBtn(ctx, "list")));
  results.append(dayTabs, head);
  if (hint) results.append(hint);

  if (ctx.viewMode === "grid") {
    for (const day of allDays) {
      const daySessions = sessions.filter((s) => s.day === day);
      const dayEvents = events.filter((e) => e.day === day);
      if (!daySessions.length && !dayEvents.length) continue;
      if (allDays.length > 1) {
        results.append(h("div", { class: "day-divider" },
          h("span", { class: "day-name", text: dateLabel(day) })));
      }
      results.append(gridView(model, ctx, state, day, daySessions, dayEvents));
    }
    if (!results.querySelector(".grid-wrap")) {
      results.append(h("p", { class: "empty", text: "Keine Treffer. Filter lockern oder zurücksetzen." }));
    }
  } else {
    results.append(listView(model, ctx, sessions, events, state.q, allDays));
  }
}

function filterEvent(e, state) {
  // Rahmen-/Sonderveranstaltungen besitzen keine SW/LKW/DID-Zuordnung und
  // dürfen deshalb bei einem Fach- oder Panel-Filter nicht stehenbleiben.
  if (state.panel || state.tracks?.length) return false;
  if (state.q && !matchesLoose(e.title, state.q)) return false;
  if (state.room && e.room !== state.room) return false;
  if (state.slot && e.start !== state.slot) return false;
  const formats = e.formats?.length ? e.formats : [e.type];
  if (formats.every((format) => state.hiddenFormats.includes(format))) return false;
  return true;
}
function matchesLoose(text, q) {
  return normalizeText(text).includes(normalizeText(q));
}
function normalizeText(s) {
  return (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function gridBtn(ctx, mode) {
  const b = h("button", { class: `btn small view-${mode} ${ctx.viewMode === mode ? "" : "ghost"}`, text: mode === "grid" ? "Raster" : "Liste" });
  b.addEventListener("click", () => { ctx.setViewMode(mode); });
  return b;
}

function slotRows(sessions) {
  const starts = [...new Set(sessions.filter((s) => s.type === "talk" && s.start).map((s) => s.start))].sort();
  return starts;
}

function gridView(model, ctx, state, day, sessions, events) {
  const rooms = naturalDayRooms(sessions);
  const starts = slotRows(sessions);
  const grid = h("div", { class: "grid-wrap" });
  const g = h("div", {
    class: "grid",
    style: `grid-template-columns: 70px repeat(${rooms.length}, minmax(150px, 1fr));`,
  });

  g.append(h("div", { class: "grid-head corner", text: "Zeit" }));
  for (const r of rooms) {
    g.append(h("div", { class: "grid-head" }, r ? roomLink(r) : h("span", { text: r })));
  }

  const byStart = {};
  for (const s of sessions) (byStart[s.start] ||= []).push(s);

  // Zeilen: Slots + Einschieber (Pausen/Events zwischen Slots)
  const rowItems = [];
  let lastEnd = null;
  // Nur bereits gefilterte Pausen verwenden; sonst tauchen sie trotz aktivem
  // Fach-, Such- oder Formatfilter wieder im Raster auf.
  const extras = [...sessions.filter((s) => s.type === "break"), ...events]
    .filter((x) => x.start)
    .sort((a, b) => minutes(a.start) - minutes(b.start));

  for (const start of starts) {
    for (const ex of extras) {
      if (lastEnd && minutes(ex.start) >= minutes(lastEnd) && minutes(ex.start) < minutes(start)) {
        rowItems.push({ kind: "full", item: ex });
      }
    }
    rowItems.push({ kind: "slot", start });
    lastEnd = Math.max(...(byStart[start] || [{ end: start }]).map((s) => s.end));
  }
  // Tage ohne Vortrags-Slots (z. B. Eröffnungstag 30.09.) haben kein lastEnd –
  // ohne den Null-Fall würden deren Event-Karten im Grid gar nicht erscheinen.
  for (const ex of extras) {
    if (!lastEnd || minutes(ex.start) >= minutes(lastEnd)) rowItems.push({ kind: "full", item: ex });
  }

  for (const row of rowItems) {
    if (row.kind === "full") {
      g.append(h("div", { class: "grid-full" }, eventCard(model, ctx, row.item)));
      continue;
    }
    g.append(h("div", { class: "grid-time", text: row.start }));
    for (const room of rooms) {
      const s = (byStart[row.start] || []).find((x) => x.room === room);
      g.append(s ? sessionCard(model, ctx, s, state) : h("div", { class: "grid-empty" }));
    }
  }
  grid.append(g);
  return grid;
}

function naturalDayRooms(sessions) {
  const order = [...new Set(
    sessions.filter((s) => s.type === "talk" && s.room).map((s) => s.room))];
  order.sort((a, b) => {
    const [pa, na] = [a.split(/\s+/)[0], parseInt(a.split(/\s+/)[1] || "0", 10)];
    const [pb, nb] = [b.split(/\s+/)[0], parseInt(b.split(/\s+/)[1] || "0", 10)];
    if (pa !== pb) return pa.localeCompare(pb);
    return na - nb;
  });
  return order;
}

function listView(model, ctx, sessions, events, q, allDays) {
  const wrap = h("div", { class: "list-view" });

  if (!sessions.length && !events.length) {
    wrap.append(h("p", { class: "empty", text: "Keine Treffer. Filter lockern oder zurücksetzen." }));
    return wrap;
  }

  // Nach Tag gruppieren (bei „Alle Tage“ ein Block pro Tag mit Tages-Header)
  for (const day of allDays) {
    const daySessions = sessions.filter((s) => s.day === day);
    const dayEvents = events.filter((e) => e.day === day);
    if (!daySessions.length && !dayEvents.length) continue;

    if (allDays.length > 1) {
      wrap.append(h("div", { class: "day-divider" },
        h("span", { class: "day-name", text: dateLabel(day) })));
    }

    const all = [...daySessions, ...dayEvents].sort((a, b) =>
      (a.start || "99").localeCompare(b.start || "99"));

    const groups = [];
    for (const s of all) {
      const key = s.start || "ganztägig";
      if (!groups.length || groups[groups.length - 1].key !== key) groups.push({ key, items: [] });
      groups[groups.length - 1].items.push(s);
    }
    for (const g of groups) {
      wrap.append(h("section", { class: "slot-block" },
        h("div", { class: "slot-head" },
          h("span", { text: g.key }),
          h("span", { class: "pill", text: `${g.items.length} Veranstaltung${g.items.length === 1 ? "" : "en"}` })),
        h("div", { class: "slot-grid" },
          g.items.map((x) => (x.type === "talk"
            ? sessionCard(model, ctx, x, { q })
            : eventCard(model, ctx, x))))));
    }
  }
  return wrap;
}

export function sessionCard(model, ctx, s, state) {
  const isFav = favs.has(s.id);
  const titleHtml = state.q ? highlight(s.title, state.q) : null;
  // Treffer-Snippet aus dem Abstract (nur bei aktiver Suche)
  const abstractSnippet = state.q && s.abstract ? snippet(s.abstract, state.q) : null;
  // „Läuft gerade": nur während der Tagung, Karte mit laufender Zeit
  const now = ctx.now instanceof Date ? ctx.now : new Date();
  const isNow = isRunningNow(model, s, now);
  return h("article", {
    class: `card session-card track-${(s.discipline || "x").toLowerCase()} ${isFav ? "is-fav" : ""} ${isNow ? "is-now" : ""}`,
    "data-id": s.id,
    onclick: () => ctx.openSession(s.id),
    tabindex: "0",
    role: "button",
  },
    h("div", { class: "card-top" },
      h("span", { class: "time", text: `${s.start}–${s.end}` }),
      isNow ? h("span", { class: "pill now", text: "jetzt" }) : null,
      h("button", {
        class: `fav ${isFav ? "active" : ""}`, "aria-label": "Merken",
        text: isFav ? "★" : "☆",
        onclick: (e) => {
          e.stopPropagation();
          const on = favs.toggle(s.id);
          e.target.textContent = on ? "★" : "☆";
          e.target.closest(".session-card").classList.toggle("is-fav", on);
          ctx.refreshFavIndicators?.();
        },
      })),
    h("div", { class: "card-title", html: titleHtml || undefined, text: titleHtml ? undefined : s.title }),
    s.speakers?.length ? h("div", { class: "card-speakers", text: s.speakers.join(", ") }) : null,
    abstractSnippet ? h("div", { class: "card-snippet", html: abstractSnippet }) : null,
    // Sprach-Hinweis (Heuristik, s. Info): nur wenn NICHT deutsch — die
    // Mehrheit der Vorträge ist deutsch, ein Badge für alle wäre Rauschen.
    langBadge(s._lang),
    s.panel_code ? h("span", { class: "pill code", text: s.panel_code }) : null,
    s.room ? roomLink(s.room) : null,
    // Chair sichtbar machen: bei Personensuchen ist er der (einzige) Treffergrund
    s.chair && state.q ? h("div", { class: "card-speakers dim-chair", text: `Chair: ${stripTitles(s.chair)}` }) : null,
    s.panel_title && !s.panel_code ? h("div", { class: "card-panel", text: s.panel_title }) : null);
}

export function eventCard(model, ctx, e) {
  const formats = e.formats?.length ? [...new Set(e.formats)] : [e.type];
  const typeLabels = formats
    .map((format) => ({ podium: "Podiumsdiskussion", special: "Sonderformat", rahmen: "Rahmenprogramm", break: "Pause" })[format])
    .filter(Boolean);
  const now = ctx.now instanceof Date ? ctx.now : new Date();
  const isNow = isRunningNow(model, e, now);
  return h("article", {
    class: `card event-card ${formats.map((format) => `type-${format}`).join(" ")} ${isNow ? "is-now" : ""}`,
    "data-id": e.id || "",
    onclick: e.id ? () => ctx.openEvent(e.id) : null,
    tabindex: e.id ? "0" : null,
    role: e.id ? "button" : null,
  },
    h("div", { class: "card-top" },
      h("span", { class: "time", text: timeRange(e.start, e.end) || "ganztägig" }),
      isNow ? h("span", { class: "pill now", text: "jetzt" }) : null,
      typeLabels.map((label) => h("span", { class: "pill", text: label }))),
    h("div", { class: "card-title", text: e.title }),
    e.room ? roomLink(e.room) : null,
    e.note ? h("div", { class: "card-panel", text: e.note }) : null);
}
