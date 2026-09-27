// views/info.js – kompakte Orientierung zu Tagungsorten
import { h } from "../util.js";
import { roomGoogleMapUrl, roomMapUrl } from "../rooms.js";

const VENUE_ROOM = {
  CZS3: "HS 2",
  UHG: "Aula UHG",
  MMZ: "MMZ 220",
  HaM: "Haus auf der Mauer",
};

function mapLinks(osmUrl, googleUrl) {
  return h("div", { class: "venue-map-links" },
    osmUrl ? h("a", {
      class: "btn small ghost", href: osmUrl, target: "_blank", rel: "noopener",
      text: "OpenStreetMap ↗",
    }) : null,
    googleUrl ? h("a", {
      class: "btn small ghost", href: googleUrl, target: "_blank", rel: "noopener",
      text: "Google Maps ↗",
    }) : null);
}

export function renderInfo(model) {
  const c = model.content;
  const wrap = h("div", { class: "view view-info" });

  wrap.append(h("header", { class: "hero compact" },
    h("h1", { text: "Orte & Adressen" }),
    h("p", { class: "meta", text: "Der Haupttagungsort ist die Carl-Zeiss-Straße 3. Hier finden Sie Tagungsorte, Karten und Möglichkeiten für ein schnelles Mittagessen." })));

  const venueCards = Object.entries(c.venues).map(([id, venue]) => {
    const osmUrl = roomMapUrl(VENUE_ROOM[id]) || venue.url_maps;
    const googleUrl = venue.url_google_maps || roomGoogleMapUrl(VENUE_ROOM[id]);
    return h("article", { class: "venue-card" },
      h("h3", { text: venue.name }),
      venue.note ? h("p", { class: "meta", text: venue.note }) : null,
      mapLinks(osmUrl, googleUrl));
  });
  wrap.append(h("section", { class: "card venues-card" },
    h("h2", { text: "Tagungsorte" }),
    h("div", { class: "venue-grid" }, venueCards)));

  const lunchCards = (c.quick_lunch || []).map((place) => {
    const query = encodeURIComponent(place.map_query);
    return h("article", { class: "lunch-place" },
      h("h3", { text: place.name }),
      h("p", { class: "meta", text: place.address }),
      h("p", { class: "meta", text: place.note }),
      h("a", {
        class: "btn small", href: place.url_info, target: "_blank", rel: "noopener",
        text: `${place.link_label} ↗`,
      }),
      mapLinks(
        `https://www.openstreetmap.org/search?query=${query}`,
        `https://www.google.com/maps/search/?api=1&query=${query}`));
  });
  wrap.append(h("section", { class: "card lunch-card" },
    h("h2", { text: "Schnelles Mittagessen" }),
    h("div", { class: "venue-grid lunch-grid" }, lunchCards)));

  return wrap;
}
