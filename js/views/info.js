// views/info.js – kompakte Orientierung zu Tagungsorten
import { h } from "../util.js";
import { roomGoogleMapUrl, roomMapUrl } from "../rooms.js";

const VENUE_ROOM = {
  CZS3: "HS 2",
  UHG: "Aula UHG",
  MMZ: "MMZ 220",
  HaM: "Haus auf der Mauer",
};

export function renderInfo(model) {
  const c = model.content;
  const wrap = h("div", { class: "view view-info" });

  wrap.append(h("header", { class: "hero compact" },
    h("h1", { text: "Tagungsorte & Karten" }),
    h("p", { class: "meta", text: "Der Haupttagungsort ist die Carl-Zeiss-Straße 3. Im Programm und hier können die Tagungsorte in OpenStreetMap oder Google Maps geöffnet werden." })));

  const venueCards = Object.entries(c.venues).map(([id, venue]) => {
    const osmUrl = roomMapUrl(VENUE_ROOM[id]) || venue.url_maps;
    const googleUrl = venue.url_google_maps || roomGoogleMapUrl(VENUE_ROOM[id]);
    return h("article", { class: "venue-card" },
      h("h3", { text: venue.name }),
      venue.note ? h("p", { class: "meta", text: venue.note }) : null,
      h("div", { class: "venue-map-links" },
        osmUrl ? h("a", {
          class: "btn small ghost", href: osmUrl, target: "_blank", rel: "noopener",
          text: "OpenStreetMap ↗",
        }) : null,
        googleUrl ? h("a", {
          class: "btn small ghost", href: googleUrl, target: "_blank", rel: "noopener",
          text: "Google Maps ↗",
        }) : null));
  });
  wrap.append(h("section", { class: "card venues-card" },
    h("div", { class: "venue-grid" }, venueCards)));

  return wrap;
}
