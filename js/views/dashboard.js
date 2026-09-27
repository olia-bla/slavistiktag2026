// views/dashboard.js – kompakte Startseite: Orientierung, Jetzt, wichtige Links
import { h, timeRange } from "../util.js";
import { conferenceCountdown, nowInfo } from "../now.js";

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
  const currentDate = ctx.now instanceof Date ? ctx.now : new Date();
  const now = nowInfo(model, currentDate);
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
        h("h2", { text: "Auf einen Blick" }),
        nowBody(model, now, ctx, conferenceCountdown(currentDate))),
      importantLinks(model)),
    now.day === "2026-10-02" ? holidayNotice() : null,
    h("aside", { class: "card dashboard-contact", "aria-label": "Kontakt während der Tagung" },
      h("strong", { text: "Notfälle während der Tagung: " }),
      h("a", { href: "tel:+4915125881153", text: "☎ +49 151 25881153" }),
      h("span", { text: " · Kontakt: " }),
      h("a", { href: `mailto:${c.contact}`, text: `✉ ${c.contact}` })),
    welcome,
    installCard(),
    notice,
    h("p", { class: "meta dashboard-updated", text: updatedAt(model.meta.generated_at) }));
}

function importantLinks(model) {
  const links = model.content.links;
  const resource = (label, href) => h("a", {
    class: "dashboard-resource", href, target: "_blank", rel: "noopener",
  }, h("span", { text: label }), h("span", { class: "resource-type", text: "PDF" }));

  return h("section", { class: "card dashboard-important" },
    h("h2", { text: "Downloads" }),
    h("div", { class: "dashboard-resources" },
      resource("Lageplan", links.lageplan_pdf),
      resource("Stadtplan", links.city_map_pdf),
      resource("Programm", links.program_pdf),
      resource("Book of Abstracts", links.abstracts_pdf)),
    h("a", { class: "dashboard-info-link", href: "#/info", text: "Tagungsorte →" }));
}

function holidayNotice() {
  return h("aside", { class: "card dashboard-holiday", "aria-label": "Hinweis für internationale Gäste" },
    h("strong", { text: "Hinweis für internationale Gäste" }),
    h("p", { text: "Bitte beachten Sie: Samstag, 3. Oktober, ist in Deutschland ein gesetzlicher Feiertag. Die meisten Geschäfte bleiben geschlossen." }));
}

function installCard() {
  return h("section", { class: "card install-card dashboard-install" },
    h("h2", { text: "App installieren" }),
    h("p", { text: "Die Seite funktioniert direkt im Browser. Als App öffnet sie sich im Vollbild und bleibt auch offline verfügbar." }),
    h("h3", { text: "iPhone / iPad (Safari)" }),
    h("ol", { class: "mini-list" },
      h("li", { text: "Diese Seite in Safari öffnen." }),
      h("li", { text: "Unten auf das Teilen-Symbol tippen (Quadrat mit Pfeil nach oben)." }),
      h("li", { text: "„Zum Home-Bildschirm“ wählen." }),
      h("li", { text: "Mit „Hinzufügen“ bestätigen." })),
    h("h3", { text: "Android (Chrome)" }),
    h("ol", { class: "mini-list" },
      h("li", { text: "Diese Seite in Chrome öffnen." }),
      h("li", { text: "Oben rechts auf die drei Punkte tippen." }),
      h("li", { text: "„App installieren“ oder „Zum Startbildschirm hinzufügen“ wählen und bestätigen." })),
    h("h3", { text: "Computer" }),
    h("p", { text: "Im Browser das Installationssymbol in der Adressleiste auswählen. Falls kein Symbol erscheint, kann die Seite weiterhin normal im Browser genutzt werden." }));
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

function countdownText({ unit, days, hours, minutes }) {
  if (unit === "days") return `${days} ${days === 1 ? "Tag" : "Tagen"}`;
  const h = hours ? `${hours} ${hours === 1 ? "Stunde" : "Stunden"}` : "";
  const m = minutes ? `${minutes} ${minutes === 1 ? "Minute" : "Minuten"}` : "";
  return [h, m].filter(Boolean).join(" und ");
}

function nowBody(model, now, ctx, countdown) {
  const statusLabel = (label) => label
    ? h("span", { class: label === "Läuft gerade" ? "now-label is-live" : "now-label", text: label })
    : null;
  const openingDayBeforeOpening = now.day === model.conference.start && now.time < "18:00";
  const opening = model.events
    .filter((event) => event.day === model.conference.start && event.start)
    .sort((a, b) => a.start.localeCompare(b.start))[0];
  const openingHref = opening ? `#/programm?day=${opening.day}&format=special` : null;
  const scheduleItem = (label, title, meta, href = null) => h("div", { class: "now-item" },
    statusLabel(label),
    href
      ? h("a", { class: "now-title", href, text: title })
      : h("span", { class: "now-title", text: title }),
    h("span", { class: "now-meta", text: meta }));

  if (countdown) {
    return h("div", { class: "dashboard-status" },
      h("p", { text: `Die Tagung beginnt in ${countdownText(countdown)} – am Mittwoch, den 30. September 2026.` }),
      scheduleItem("ab 12:00", "Registrierung", "Foyer CZS 3"),
      scheduleItem("14:00–17:00", "Jahrestagung des Slavistikverbandes", "HS 2"),
      opening ? scheduleItem(
        timeRange(opening.start, opening.end),
        "Eröffnung des Slavistiktages mit Festvortrag",
        opening.room || "HS 2",
        openingHref) : null);
  }
  if (openingDayBeforeOpening) {
    const rows = [scheduleItem("Läuft gerade", "Registrierung", "12:00–18:00 · Foyer CZS 3")];
    const meeting = "Jahrestagung des Slavistikverbandes";
    if (now.time < "14:00") {
      rows.push(scheduleItem("Als Nächstes", meeting, "14:00–17:00 · HS 2"));
    } else {
      if (now.time < "17:00") rows.push(scheduleItem(null, meeting, "14:00–17:00 · HS 2"));
      if (opening) rows.push(scheduleItem(
        "Als Nächstes",
        "Eröffnung des Slavistiktages mit Festvortrag",
        `${timeRange(opening.start, opening.end)} · ${opening.room || "HS 2"}`,
        openingHref));
    }
    return h("div", { class: "dashboard-status" }, rows);
  }
  if (now.status === "after") {
    return h("p", { text: "Die Tagung ist vorbei. Vielen Dank für Ihre Teilnahme!" });
  }
  if (now.day === model.conference.end && now.time >= "15:30") {
    return h("div", { class: "dashboard-status" },
      h("p", {}, h("strong", { text: "Vielen Dank für die Teilnahme an der Konferenz!" })),
      h("p", { text: "Unser herzlicher Dank gilt allen Beteiligten für ihre Beiträge, ihre Unterstützung und die schönen Begegnungen in Jena." }),
      h("a", { class: "btn ghost", href: "#/programm", text: "Gesamtes Programm ansehen" }));
  }
  if (now.status === "done") {
    return h("div", { class: "dashboard-status" },
      h("p", { text: "Für heute ist das Programm zu Ende." }),
      h("a", { class: "btn ghost", href: "#/programm", text: "Gesamtes Programm ansehen" }));
  }
  const card = (x, label) => {
    const isSession = x.type === "talk" || x.type === "break";
    return h("div", { class: "now-item" },
      statusLabel(label),
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
      statusLabel(label),
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

  const rowsFor = (items, label, current) => {
    if (items.length > 1 && items.length <= 3 &&
        items.every((x) => x.type === "rahmen" || x.type === "podium")) {
      // Parallele Podien und Führungen namentlich zeigen; bei vielen
      // Vorträgen bleibt die kompakte Sammelanzeige bestehen.
      return items.map((x, index) => card(x, index === 0 ? label : null));
    }
    if (items.length > 1) return [parallelCard(items, label, current)];
    return items.length ? [card(items[0], label)] : [];
  };

  const rows = [
    ...rowsFor(now.currentItems, "Läuft gerade", true),
    ...rowsFor(now.nextItems, "Als Nächstes", false),
  ];
  if (!rows.length) rows.push(h("p", { text: "Momentan keine Veranstaltung." }));
  return h("div", {}, rows);
}
