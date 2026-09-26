// views/dashboard.js – kompakte Startseite: Orientierung, Jetzt, wichtige Links
import { h, timeRange } from "../util.js";
import { nowInfo } from "../now.js";

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
  const now = nowInfo(model, ctx.now instanceof Date ? ctx.now : new Date());
  const notice = changesNotice(model);

  const welcomeWords = model.content.welcome || [];
  const wordsPerRow = Math.ceil(welcomeWords.length / 2);
  const welcome = h("div", { class: "welcome-wall", "aria-hidden": "true" },
    [welcomeWords.slice(0, wordsPerRow), welcomeWords.slice(wordsPerRow)].map((row) =>
      h("div", { class: "welcome-row" },
        row.map((word) => h("span", { class: "welcome-word", text: word })))));

  return h("div", { class: "view view-dashboard" },
    h("header", { class: "hero dashboard-hero" },
      h("h1", { text: `${c.title} 2026` }),
      h("p", { class: "event-dates", text: "30.09. – 03.10. · Jena · Carl-Zeiss-Straße 3" }),
      h("p", { class: "motto", text: `„${c.motto}“` })),
    h("div", { class: "dashboard-grid" },
      h("section", { class: "now-card card" },
        h("h2", { text: "Jetzt / Als Nächstes" }),
        nowBody(model, now, ctx)),
      importantLinks(model)),
    notice,
    welcome,
    h("p", { class: "meta dashboard-updated", text: updatedAt(model.meta.generated_at) }));
}

function importantLinks(model) {
  const links = model.content.links;
  const resource = (label, href) => h("a", {
    class: "dashboard-resource", href, target: "_blank", rel: "noopener",
  }, h("span", { text: label }), h("span", { class: "resource-type", text: "PDF" }));

  return h("section", { class: "card dashboard-important" },
    h("h2", { text: "Wichtige Informationen" }),
    h("div", { class: "dashboard-resources" },
      resource("Lageplan", links.lageplan_pdf),
      resource("Stadtplan", links.city_map_pdf),
      resource("Programm", links.program_pdf),
      resource("Book of Abstracts", links.abstracts_pdf)),
    h("a", { class: "dashboard-info-link", href: "#/info", text: "Tagungsorte und Rahmenprogramm →" }));
}

function changesNotice(model) {
  const changes = model.changes;
  const counts = changes?.counts || {};
  const total = (counts.new || 0) + (counts.changed || 0) + (counts.removed || 0);
  if (!total) return null;
  const parts = [
    counts.new ? `${counts.new} neu` : null,
    counts.changed ? `${counts.changed} geändert` : null,
    counts.removed ? `${counts.removed} entfallen` : null,
  ].filter(Boolean).join(", ");
  return h("section", { class: "card dashboard-notice" },
    h("h2", { text: "Aktuelle Hinweise" }),
    h("p", { text: `Das Programm wurde aktualisiert: ${parts}.` }),
    h("a", { class: "btn ghost", href: "#/aenderungen", text: "Änderungen ansehen" }));
}

function nowBody(model, now, ctx) {
  const openingDayBeforeOpening = now.day === model.conference.start && now.time < "18:00";
  if (now.status === "before" || openingDayBeforeOpening) {
    const opening = model.events
      .filter((event) => event.day === model.conference.start && event.start)
      .sort((a, b) => a.start.localeCompare(b.start))[0];
    const scheduleItem = (time, title, room, href = null) => h("div", { class: "now-item" },
      h("span", { class: "now-label", text: time }),
      href
        ? h("a", { class: "now-title", href, text: title })
        : h("span", { class: "now-title", text: title }),
      h("span", { class: "now-meta", text: room }));
    return h("div", { class: "dashboard-status" },
      h("p", { text: "Die Tagung beginnt am Mittwoch, 30.09.2026." }),
      scheduleItem("ab 12:00", "Registrierung", "Foyer CZS 3"),
      scheduleItem("14:00–17:00", "Jahrestag des Slavistikverbandes", "HS 2"),
      opening ? scheduleItem(
        timeRange(opening.start, opening.end),
        "Eröffnung des Slavistiktages mit Festvortrag",
        opening.room || "HS 2",
        `#/programm?day=${opening.day}&format=special`) : null);
  }
  if (now.status === "after") {
    return h("p", { text: "Die Tagung ist vorbei. Vielen Dank für Ihre Teilnahme!" });
  }
  if (now.status === "done") {
    return h("div", { class: "dashboard-status" },
      h("p", { text: "Für heute ist das Programm zu Ende." }),
      h("a", { class: "btn ghost", href: "#/programm", text: "Gesamtes Programm ansehen" }));
  }
  const card = (x, label) => {
    const isSession = x.type === "talk" || x.type === "break";
    return h("div", { class: "now-item" },
      h("span", { class: "now-label", text: label }),
      h("a", {
        class: "now-title", href: isSession ? `#/programm?q=${encodeURIComponent(x.title.slice(0, 40))}` : `#/programm?day=${x.day}`,
        onclick: x.id
          ? (ev) => {
            ev.preventDefault();
            isSession ? ctx.openSession(x.id) : ctx.openEvent(x.id);
          }
          : null,
      }, x.title),
      h("span", { class: "now-meta", text: `${timeRange(x.start, x.end)}${x.room ? " · " + x.room : ""}` }));
  };

  const parallelCard = (items, label, current) => {
    const first = items[0];
    return h("div", { class: "now-item" },
      h("span", { class: "now-label", text: label }),
      h("a", {
        class: "now-title",
        href: `#/programm?day=${first.day}`,
        text: current
          ? "Aktuell laufen mehrere Veranstaltungen"
          : `${items.length} Veranstaltungen beginnen gleichzeitig`,
      }),
      h("span", {
        class: "now-meta",
        text: current
          ? `${items.length} Veranstaltungen · verschiedene Räume`
          : `ab ${first.start} · verschiedene Räume`,
      }));
  };

  const rows = [];
  if (now.currentItems.length > 1) rows.push(parallelCard(now.currentItems, "Läuft gerade", true));
  else if (now.current) rows.push(card(now.current, "Läuft gerade"));
  if (now.nextItems.length > 1) rows.push(parallelCard(now.nextItems, "Als Nächstes", false));
  else if (now.next) rows.push(card(now.next, "Als Nächstes"));
  if (!rows.length) rows.push(h("p", { text: "Momentan keine Veranstaltung." }));
  return h("div", {}, rows);
}
