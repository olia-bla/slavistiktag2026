// rooms.js – Raum → Gebäude/Etage/amtliche Innen-Nummer + Karten-Deep-Link (OSM).
// Quellen (2026-09-24):
//  - Friedolin Raumregister (amtlich; Gebäude-IDs 1831=CZS3, 1832=EAP8, 1111=UHG):
//    Innen-Nummern 1.0xx=1. OG, 2.0xx=2. OG, E0xx=EG; HS 6=1012, HS 7=1006, HS 8=1007 → 1. OG.
//  - Stadtplan-PDF der Tagung: „MMZ 220, 2.OG (Ernst-Abbe-Platz 8)“, „Aula (UHG)“.
//  - Tagungs-PDF: „Zeit / Raum CZS, SR 223“ → CZS-Raum 2.023 (es gibt einen zweiten
//    SR 223 im UHG – Namensvetter, nicht Tagungsort).
//  - Nominatim-Geocoding: Gebäude-Marker.
// Keine erfundenen Geometrien: Ebenen-Daten sind amtlich; der Etagen-Streifen zeigt
// schematisch, welche Tagungsräume sich dieselbe Etage teilen (kein Grundriss).
import { h } from "./util.js";

export const ROOMS = {
  // CZS 3, 1. OG: HS 6–8 + SR 1xx
  "HS 6":    { building: "CZS 3", address: "Carl-Zeiß-Straße 3", floor: "1. OG", inner: "1012", lat: 50.92879, lon: 11.58161 },
  "HS 7":    { building: "CZS 3", address: "Carl-Zeiß-Straße 3", floor: "1. OG", inner: "1006", lat: 50.92879, lon: 11.58161 },
  "HS 8":    { building: "CZS 3", address: "Carl-Zeiß-Straße 3", floor: "1. OG", inner: "1007", lat: 50.92879, lon: 11.58161 },
  "SR 113":  { building: "CZS 3", address: "Carl-Zeiß-Straße 3", floor: "1. OG", inner: "1.013", lat: 50.92879, lon: 11.58161 },
  "SR 114":  { building: "CZS 3", address: "Carl-Zeiß-Straße 3", floor: "1. OG", inner: "1.014", lat: 50.92879, lon: 11.58161 },
  "SR 121":  { building: "CZS 3", address: "Carl-Zeiß-Straße 3", floor: "1. OG", inner: "1.021", lat: 50.92879, lon: 11.58161 },
  "SR 124":  { building: "CZS 3", address: "Carl-Zeiß-Straße 3", floor: "1. OG", inner: "1.024", lat: 50.92879, lon: 11.58161 },
  "SR 125":  { building: "CZS 3", address: "Carl-Zeiß-Straße 3", floor: "1. OG", inner: "1.025", lat: 50.92879, lon: 11.58161 },
  "SR 127":  { building: "CZS 3", address: "Carl-Zeiß-Straße 3", floor: "1. OG", inner: "1.027", lat: 50.92879, lon: 11.58161 },
  // CZS 3, 2. OG: SR 2xx
  "SR 206":  { building: "CZS 3", address: "Carl-Zeiß-Straße 3", floor: "2. OG", inner: "2.006", lat: 50.92879, lon: 11.58161 },
  "SR 207":  { building: "CZS 3", address: "Carl-Zeiß-Straße 3", floor: "2. OG", inner: "2.007", lat: 50.92879, lon: 11.58161 },
  "SR 208":  { building: "CZS 3", address: "Carl-Zeiß-Straße 3", floor: "2. OG", inner: "2.008", lat: 50.92879, lon: 11.58161 },
  "SR 209":  { building: "CZS 3", address: "Carl-Zeiß-Straße 3", floor: "2. OG", inner: "2.009", lat: 50.92879, lon: 11.58161 },
  "SR 221":  { building: "CZS 3", address: "Carl-Zeiß-Straße 3", floor: "2. OG", inner: "2.021", lat: 50.92879, lon: 11.58161 },
  "SR 222":  { building: "CZS 3", address: "Carl-Zeiß-Straße 3", floor: "2. OG", inner: "2.022", lat: 50.92879, lon: 11.58161 },
  "SR 223":  { building: "CZS 3", address: "Carl-Zeiß-Straße 3", floor: "2. OG", inner: "2.023", lat: 50.92879, lon: 11.58161 },
  "SR 224":  { building: "CZS 3", address: "Carl-Zeiß-Straße 3", floor: "2. OG", inner: "2.024", lat: 50.92879, lon: 11.58161 },
  "SR 226":  { building: "CZS 3", address: "Carl-Zeiß-Straße 3", floor: "2. OG", inner: "2.026", lat: 50.92879, lon: 11.58161 },
  // Sonstige Tagungsorte
  // HS 2: Programm-PDF nennt „CZS 3, HS 2“ (Podien); Etage/Innen-Nummer sind
  // nicht amtlich dokumentiert → bewusst ohne floor/inner (kein Etagen-Streifen).
  "HS 2":    { building: "CZS 3", address: "Carl-Zeiß-Straße 3", floor: null, inner: null, lat: 50.92879, lon: 11.58161 },
  "MMZ 220": { building: "MMZ",  address: "Ernst-Abbe-Platz 8",  floor: "2. OG", inner: "220",  lat: 50.9289611, lon: 11.5827306 },
  "Foyer CZS 3": { building: "CZS 3", address: "Carl-Zeiß-Straße 3", floor: "EG", inner: null, lat: 50.92879, lon: 11.58161 },
  "Aula UHG":    { building: "UHG",  address: "Fürstengraben 1",     floor: "EG", inner: "E008", lat: 50.92945, lon: 11.58944 },
  "Haus auf der Mauer": { building: "Haus auf der Mauer", address: "Johannisplatz 26", floor: null, inner: null, lat: 50.9297151, lon: 11.5840878 },
};

export function roomMeta(name) {
  return ROOMS[name] || null;
}

// OSM-Deep-Link: Marker auf Gebäude, Zoom 19
export function roomMapUrl(name) {
  const m = roomMeta(name);
  if (!m) return null;
  return `https://www.openstreetmap.org/?mlat=${m.lat}&mlon=${m.lon}#map=19/${m.lat}/${m.lon}`;
}

// Klickbarer Raum als <a> (OSM-Deep-Link); ohne Mapping: schlichter Pill-Text
export function roomLink(name) {
  if (!name) return null;
  const url = roomMapUrl(name);
  if (!url) return h("span", { class: "pill room", text: name });
  const m = roomMeta(name);
  return h("a", {
    class: "pill room room-link", href: url, target: "_blank", rel: "noopener",
    "aria-label": `Raum ${name} (${m.building}, ${m.address}) auf Karte zeigen`,
    onclick: (e) => e.stopPropagation(),
    text: name,
  });
}

// Gebäude+Etage+amtliche Innen-Nummer als Zusatzzeile für den Drawer
export function roomWhere(name) {
  const m = roomMeta(name);
  if (!m) return null;
  const inner = m.inner ? ` · Nr. ${m.inner}` : "";
  const floor = m.floor ? ` · ${m.floor}` : "";
  return h("span", { class: "room-where", text: `${m.building}${floor}${inner}` });
}

// Schematischer Etagen-Streifen: alle Tagungsräume derselben Etage, aktueller
// hervorgehoben („was ist noch hier?“). Amtliche Ebenen-Daten, kein Grundriss.
export function roomFloorStrip(name) {
  const m = roomMeta(name);
  if (!m || !m.floor) return null; // ohne dokumentierte Etage kein Streifen
  const siblings = Object.entries(ROOMS)
    .filter(([n, x]) => x.building === m.building && x.floor === m.floor)
    .sort((a, b) => String(a[1].inner || a[0]).localeCompare(String(b[1].inner || b[0]), undefined, { numeric: true }));
  return h("div", { class: "floor-strip" },
    h("p", { class: "floor-head" },
      h("strong", { text: `${m.building}, ${m.floor}` }),
      h("span", { class: "dim", text: ` · ${siblings.length} Tagungsräume auf dieser Etage` })),
    h("div", { class: "floor-rooms" },
      siblings.map(([n]) => h("span", { class: `pill floor-room ${n === name ? "current" : ""}`, text: n }))));
}

// Alle im Programm vorkommenden Räume, die NICHT gemappt sind (für Tests/Check)
export function unmappedRooms(allRooms) {
  return allRooms.filter((r) => !ROOMS[r]);
}
