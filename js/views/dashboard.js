// views/dashboard.js – Startseite: Begrüßung, Jetzt & Als Nächstes, Highlights
import { h, dateLabel, shortDate, timeRange } from "../util.js";
import { nowInfo } from "../now.js";
import { icsFor, downloadIcs } from "../ics.js";

function updatedAt(timestamp) {
  const d = new Date(timestamp || "");
  if (Number.isNaN(d.getTime())) return "Aktualisiert: —";
  const options = { timeZone: "Europe/Berlin" };
  const date = d.toLocaleDateString("de-DE", { ...options, day: "2-digit", month: "2-digit", year: "numeric" });
  const time = d.toLocaleTimeString("de-DE", { ...options, hour: "2-digit", minute: "2-digit" });
  return `Aktualisiert: ${date}, ${time} Uhr`;
}

export function renderDashboard(model, ctx) {
  const c = model.conference;
  const now = nowInfo(model);

  const nowCard = h("section", { class: "now-card card" },
    h("h2", { text: "Wohin gehe ich?" }),
    nowBody(model, now, ctx));

  const dayChips = model.days.map((d) =>
    h("a", { class: "chip", href: `#/programm?day=${d}` }, dateLabel(d)));

  const highlights = model.events.filter((e) => e.type === "podium" || (e.day === "2026-09-30"));
  const highlightList = h("ul", { class: "highlight-list" },
    highlights.map((e) => h("li", {},
      h("strong", { text: `${shortDate(e.day)} ${timeRange(e.start, e.end)}` }, ),
      " – ",
      h("a", { href: `#/info`, text: e.title }),
    )));

  const welcome = h("div", { class: "welcome-wall", "aria-hidden": "true" },
    model.content.welcome.map((w, i) => h("span", { class: "welcome-word", style: `animation-delay:${i * 0.35}s`, text: w })));

  return h("div", { class: "view view-dashboard" },
    welcome,
    h("header", { class: "hero" },
      h("h1", { text: `${c.title} 2026` }),
      h("p", { class: "event-dates", text: "30.09. – 03.10. · Jena, Carl-Zeiss-Straße 3" }),
      h("p", { class: "motto", text: `„${c.motto}“` }),
      h("p", { class: "meta", text: updatedAt(model.meta.generated_at) })),
    nowCard,
    h("section", { class: "card" },
      h("h2", { text: "Tage" }),
      h("div", { class: "chip-row" }, dayChips)),
    h("section", { class: "card" },
      h("h2", { text: "Highlights" }),
      highlightList,
      h("p", {}, h("a", { class: "btn ghost", href: "#/info", text: "Kultur- und Rahmenprogramm →" }))),
    h("section", { class: "card downloads-card" },
      h("h2", { text: "Downloads" }),
      h("div", { class: "btn-row" },
        h("a", { class: "btn download-link", href: model.content.links.city_map_pdf, target: "_blank", rel: "noopener", text: "Stadtplan (PDF)" }),
        h("a", { class: "btn download-link", href: model.content.links.lageplan_pdf, target: "_blank", rel: "noopener", text: "Lageplan (PDF)" }),
        h("a", { class: "btn download-link", href: model.content.links.program_pdf, target: "_blank", rel: "noopener", text: "Tagungsprogramm (PDF)" }),
        h("a", { class: "btn download-link", href: model.content.links.abstracts_pdf, target: "_blank", rel: "noopener", text: "Book of Abstracts (PDF)" }))),
    h("section", { class: "card" },
      h("h2", { text: "Schnellzugriff" }),
      h("div", { class: "chip-row" },
        h("a", { class: "btn", href: "#/programm", text: "Programm durchsuchen" }),
        h("a", { class: "btn", href: "#/mein", text: "Mein Programm" }))));
}

function nowBody(model, now, ctx) {
  if (now.status === "before") {
    return h("p", { text: `Die Tagung beginnt am ${dateLabel(model.conference.start)}. Bis dahin: Programm stöbern und Favoriten sammeln.` });
  }
  if (now.status === "after") {
    return h("p", { text: "Die Tagung ist vorbei. Vielen Dank fürs Mitmachen!" });
  }
  if (now.status === "done") {
    return h("p", { text: "Für heute ist das Programm zu Ende." });
  }
  const card = (x, label) => {
    const isSession = x.type === "talk" || x.type === "break";
    return h("div", { class: "now-item" },
      h("span", { class: "now-label", text: label }),
      h("a", {
        class: "now-title", href: isSession ? `#/programm?q=${encodeURIComponent(x.title.slice(0, 40))}` : "#/info",
        onclick: isSession && x.id && ctx.byId[x.id]
          ? (ev) => { ev.preventDefault(); ctx.openSession(x.id); }
          : null,
      }, x.title),
      h("span", { class: "now-meta", text: `${timeRange(x.start, x.end)}${x.room ? " · " + x.room : ""}` }));
  };

  const rows = [];
  if (now.current) rows.push(card(now.current, "Läuft gerade"));
  if (now.next) rows.push(card(now.next, "Als Nächstes"));
  if (!rows.length) rows.push(h("p", { text: "Momentan keine Veranstaltung." }));
  return h("div", {}, rows);
}
