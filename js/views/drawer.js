// views/drawer.js – Detailansicht für Sessions und Events
import { h, dateLabel, timeRange, toast } from "../util.js";
import { favs } from "../favorites.js";
import { icsFor, downloadIcs } from "../ics.js";
import { minutes } from "../util.js";
import { roomLink, roomWhere, roomFloorStrip } from "../rooms.js";
import { nonGermanLanguageBadge } from "../languages.js";
import { splitPeople, stripTitles } from "./speakers.js";
import { highlight } from "../search.js";

export function openDrawer(ctx, id) {
  const model = ctx.model;
  const session = model.sessions.find((s) => s.id === id);
  const event = !session ? model.events.find((e) => e.id === id) : null;
  const backdrop = h("div", { class: "drawer-backdrop", onclick: close });
  const drawer = h("aside", { class: "drawer", role: "dialog", "aria-label": "Details" });

  function close() {
    backdrop.remove();
    drawer.remove();
  }
  function onKey(e) {
    if (e.key === "Escape") close();
  }
  document.addEventListener("keydown", onKey);

  if (session) {
    // Aktive Suchquery mitgeben (für Abstract-Highlighting)
    session._q = ctx.programState?.q || "";
    drawer.append(sessionBody(ctx, session, close));
  } else if (event) {
    drawer.append(eventBody(event, close));
  } else {
    drawer.append(h("p", { text: "Nicht gefunden." }, ), closeBtn(close));
  }
  document.body.append(backdrop, drawer);
  drawer.querySelector("button")?.focus();
}

function closeBtn(close) {
  return h("button", { class: "btn ghost drawer-close", onclick: close, "aria-label": "Schließen", text: "✕" });
}

function favBtn(ctx, session) {
  const active = favs.has(session.id);
  const btn = h("button", { class: `btn ${active ? "" : "ghost"}`, text: active ? "★ Gemerkt" : "☆ Merken" });
  btn.addEventListener("click", () => {
    const on = favs.toggle(session.id);
    btn.className = `btn ${on ? "" : "ghost"}`;
    btn.textContent = on ? "★ Gemerkt" : "☆ Merken";
    ctx.refreshFavIndicators?.();
  });
  return btn;
}

function icsBtn(session) {
  return h("button", {
    class: "btn ghost",
    text: "⤓ Kalender (.ics)",
    onclick: () => downloadIcs("slavistiktag-vortrag.ics",
      icsFor([{ day: session.day, start: session.start, end: session.end, title: session.title, room: session.room || "" }])),
  });
}

// Deep-Link auf einen Vortrag: /programm?q=<id> — der App-Boot öffnet bei
// exakt-matchender Query automatisch den Drawer.
export function sessionUrl(session) {
  return `${location.origin}${location.pathname}#/programm?q=${encodeURIComponent(session.id)}`;
}

async function shareSession(session) {
  const url = sessionUrl(session);
  const text = `${session.title} – Slavistiktag 2026`;
  try {
    if (navigator.share) {
      await navigator.share({ title: text, url });
      return;
    }
  } catch { /* abgebrochen -> unten Clipboard */ }
  try {
    await navigator.clipboard.writeText(url);
    toast("Link kopiert.");
  } catch {
    // Clipboard-API fehlt (z.B. http): Legacy-Fallback
    const ta = h("textarea", { style: "position:fixed;left:-9999px", text: url });
    document.body.append(ta); ta.select();
    try { document.execCommand("copy"); toast("Link kopiert."); }
    catch { toast("Kopieren nicht möglich – Link: " + url); }
    ta.remove();
  }
}

function shareBtn(session) {
  return h("button", {
    class: "btn ghost",
    text: "↗ Teilen",
    onclick: () => shareSession(session),
  });
}

// Speaker-Zeile: jeder Name verlinkt auf die Personen-Ansicht
// (#/sprecher/<name>), Affiliation (falls vorhanden) in Klammern dahinter.
function speakerLineEl(s) {
  if (!s.speakers?.length) return null;
  const p = h("p", { class: "speakers" });
  s.speakers.forEach((raw, i) => {
    if (i) p.append(", ");
    for (const one of splitPeople(raw)) {
      const name = stripTitles(one.trim());
      p.append(h("a", {
        href: `#/sprecher/${encodeURIComponent(name)}`,
        text: name,
      }));
    }
    if (s.affiliations?.[i]) p.append(` (${s.affiliations[i]})`);
  });
  if (s.role) p.append(` (${s.role})`);
  return p;
}

function sessionBody(ctx, s, close) {
  const languageBadge = nonGermanLanguageBadge(s._lang);
  const panelTalks = s.panel_group
    ? ctx.model.sessions.filter((x) => x.panel_group === s.panel_group && x.type !== "break")
    : [];
  const parallel = ctx.model.byDay[s.day]
    .filter((x) => x.type !== "break" && x.day === s.day && x.start === s.start && x.id !== s.id);

  const out = h("div", { class: "drawer-body" },
    closeBtn(close),
    h("p", { class: "kicker", text: `${dateLabel(s.day)} · ${timeRange(s.start, s.end)}` }),
    h("h2", { text: s.title },
      languageBadge ? h("span", { class: "pill lang", text: languageBadge.label, title: languageBadge.title }) : null),
    s.status === "cancelled"
      ? h("p", { class: "cancel-note", role: "status", text: "Abgesagt – dieser Beitrag findet nicht statt." })
      : null,
    speakerLineEl(s),
    h("p", { class: "meta" },
      roomLink(s.room), " ",
      s.venue ? h("span", { class: "pill", text: ctx.model.content.venues[s.venue]?.short || s.venue }) : null,
      s.room ? roomWhere(s.room) : null),
    s.room ? roomFloorStrip(s.room) : null,
    s.panel_title
      ? h("p", { class: "panel-ref" },
          "Im Rahmen von: ",
          s.panel_code ? h("span", { class: "pill code", text: s.panel_code }) : null, " ",
          h("strong", { text: s.panel_title }),
          s.chair ? h("span", { class: "meta", text: ` · Chair: ${stripTitles(s.chair)}` }) : null)
      : null,
    s.abstract
      ? h("section", {},
          h("h3", { text: s._q && highlight(s.abstract, s._q) ? "Abstract (Suchtreffer hervorgehoben)" : "Abstract" }),
          s._q && highlight(s.abstract, s._q)
            ? h("p", { class: "abstract", html: highlight(s.abstract, s._q) })
            : h("p", { class: "abstract", text: s.abstract }))
      : null,
    h("div", { class: "btn-row" },
      s.status !== "cancelled" || favs.has(s.id) ? favBtn(ctx, s) : null,
      s.status !== "cancelled" ? icsBtn(s) : null,
      shareBtn(s)),
    panelTalks.length > 1
      ? h("section", {},
          h("h3", { text: `Im Panel (${panelTalks.length} Beiträge)` }),
          h("ul", { class: "mini-list" },
            panelTalks.map((x) => h("li", {},
              h("a", { href: "#", onclick: (e) => { e.preventDefault(); ctx.openSession(x.id); } },
                `${dateLabel(x.day)} ${x.start} – ${x.speakers.join(", ")}${x.role ? ` (${x.role})` : ""}: ${x.title}${x.status === "cancelled" ? " (abgesagt)" : ""}`)))))
      : null,
    parallel.length
      ? h("section", {},
          h("h3", { text: "Parallel zur gleichen Zeit" }),
          h("ul", { class: "mini-list" },
            parallel.slice(0, 8).map((x) => h("li", {},
              h("a", { href: "#", onclick: (e) => { e.preventDefault(); ctx.openSession(x.id); } },
                `${x.room} · ${x.speakers.join(", ")}: ${x.title}`)))))
      : null);
  return out;
}

function eventBody(e, close) {
  return h("div", { class: "drawer-body" },
    closeBtn(close),
    h("p", { class: "kicker", text: `${dateLabel(e.day)}${e.start ? ` · ${timeRange(e.start, e.end)}` : ""}` }),
    h("h2", { text: e.title }),
    e.room ? h("p", { class: "meta" }, roomLink(e.room), " ", roomWhere(e.room)) : null,
    e.room ? roomFloorStrip(e.room) : null,
    e.body
      ? h("section", { class: "event-description" },
          h("h3", { text: "Beschreibung" }),
          h("p", { class: "body", text: e.body }))
      : null,
    e.people
      ? h("section", { class: "event-people" },
          h("h3", { text: "Beteiligte" }),
          h("p", { class: "meta", text: e.people }))
      : null,
    e.grussworte?.length
      ? h("section", {},
          h("h3", { text: "Grußworte" }),
          h("ul", { class: "mini-list" },
            e.grussworte.map((g) => h("li", { text: g }))))
      : null,
    e.note ? h("p", { class: "note", text: e.note }) : null);
}
