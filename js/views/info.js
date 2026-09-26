// views/info.js – kompakte Orientierung zu Tagungsorten und App-Installation
import { h } from "../util.js";

export function renderInfo(model) {
  const c = model.content;
  const wrap = h("div", { class: "view view-info" });

  wrap.append(h("header", { class: "hero compact" },
    h("h1", { text: "Info" }),
    h("p", { class: "meta", text: "Tagungsorte, Karten und App-Installation" })));

  wrap.append(h("section", { class: "card venues-card" },
    h("h2", { text: "Tagungsorte & Karten" }),
    h("p", { class: "meta", text: "Der Haupttagungsort ist die Carl-Zeiss-Straße 3. Raumnummern sind auch im Programm anklickbar und öffnen den jeweiligen Ort auf der Karte." }),
    h("div", { class: "venue-grid" },
      Object.values(c.venues).map((venue) => h("article", { class: "venue-card" },
        h("h3", { text: venue.name }),
        venue.note ? h("p", { class: "meta", text: venue.note }) : null,
        venue.url_maps
          ? h("a", {
              class: "btn small ghost",
              href: venue.url_maps,
              target: "_blank",
              rel: "noopener",
              text: "Auf Karte öffnen ↗",
            })
          : null)))));

  wrap.append(h("section", { class: "card install-card" },
    h("h2", { text: "Als App installieren" }),
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
    h("p", { text: "Im Browser das Installationssymbol in der Adressleiste auswählen. Falls kein Symbol erscheint, kann die Seite weiterhin normal im Browser genutzt werden." })));

  return wrap;
}
