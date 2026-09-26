// Service Worker: Shell stale-while-revalidate, Daten network-first mit
// Cache-Fallback. Der CACHE-Bump aktiviert die automatische App-Aktualisierung.
const CACHE = "slavtag26-companion-v43";
const SHELL = [
  "./", "index.html", "css/style.css",
  "js/app.js", "js/util.js", "js/data.js", "js/mining.js", "js/lexicon.js", "js/languages.js",
  "js/search.js", "js/favorites.js", "js/ics.js", "js/now.js", "js/rooms.js",
  "js/views/dashboard.js", "js/views/program.js", "js/views/mine.js", "js/views/info.js", "js/views/drawer.js", "js/views/topics.js", "js/views/speakers.js", "js/views/changes.js",
  "manifest.json", "icons/slavistiktag-icon.svg", "icons/slavistiktag-icon-192.png", "icons/slavistiktag-icon-512.png", "icons/slavistiktag-icon-maskable-192.png", "icons/slavistiktag-icon-maskable-512.png", "icons/slavistiktag logo.svg",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;

  const isData = url.pathname.includes("/data/");
  if (isData) {
    e.respondWith(
      // cache: "reload" umgeht den HTTP-Cache (GitHub Pages: max-age=600) –
      // sonst kann network-first bis zu 10 min alte Daten als „frisch" liefern
      // (klassisches „das PWA-Update kommt nicht an").
      fetch(e.request, { cache: "reload" })
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copy));
          }
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // Shell: sofort aus dem Cache antworten, parallel im Hintergrund aktualisieren
  e.respondWith(
    caches.match(e.request).then((hit) => {
      const refresh = fetch(e.request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copy));
          }
          return res;
        })
        .catch(() => hit);
      return hit || refresh;
    })
  );
});
