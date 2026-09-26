// app.js – Router, State, Boot (Programm-App + Themen-Kompass in einer App)
import { h, toast } from "./util.js";
import { loadData } from "./data.js";
import { clusterSessions, tfidf } from "./mining.js";
import { renderDashboard } from "./views/dashboard.js";
import { renderProgram, renderResults } from "./views/program.js";
import { renderMine } from "./views/mine.js";
import { renderInfo } from "./views/info.js";
import { openDrawer } from "./views/drawer.js";
import { favs } from "./favorites.js";
import { renderTopics, renderCluster } from "./views/topics.js";
import { renderSpeakers, renderPerson } from "./views/speakers.js";
import { renderChanges } from "./views/changes.js";

const app = document.getElementById("app");
const nav = document.getElementById("main-nav");
const backBtn = document.getElementById("back-button");
const forwardBtn = document.getElementById("forward-button");
const themeBtn = document.getElementById("theme-toggle");
const footerStand = document.getElementById("footer-stand");
const HOME_HASH = "#/heute";
const initialHash = location.hash || HOME_HASH;
const routeHistory = initialHash === HOME_HASH ? [HOME_HASH] : [HOME_HASH, initialHash];
let routeHistoryIndex = routeHistory.length - 1;
const compactProgram = window.matchMedia && window.matchMedia("(max-width: 760px)").matches;
const savedViewMode = localStorage.getItem("slavtag26.view");

function applyTheme(theme, persist = false) {
  const next = theme === "dark" ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", next);
  if (themeBtn) {
    const label = themeBtn.querySelector(".theme-label");
    if (label) label.textContent = next === "dark" ? "Hell" : "Dunkel";
    themeBtn.setAttribute("aria-label", next === "dark" ? "Hellmodus aktivieren" : "Dunkelmodus aktivieren");
  }
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", next === "dark" ? "#1b222a" : "#002f5d");
  if (persist) {
    try { localStorage.setItem("slavtag26.theme", next); } catch { /* ignore */ }
  }
}

if (themeBtn) {
  themeBtn.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme") || "light";
    applyTheme(current === "dark" ? "light" : "dark", true);
  });
}
applyTheme(document.documentElement.getAttribute("data-theme") || "light");

const ctx = {
  model: null,
  viewMode: compactProgram ? "list" : (savedViewMode || "grid"),
  programState: null,
  openSession: (id) => openDrawer(ctx, id),
  openEvent: (id) => openDrawer(ctx, id),
  byId: {},
  setViewMode(mode) {
    ctx.viewMode = compactProgram ? "list" : mode;
    localStorage.setItem("slavtag26.view", ctx.viewMode);
    ctx.rerenderProgram();
  },
  rerenderProgram() {
    if (ctx.programResults && ctx.programState) {
      renderResults(ctx.model, ctx, ctx.programState, ctx.programResults);
    }
  },
  render,
  refreshFavIndicators() {
    const badge = nav.querySelector(".fav-count");
    if (badge) badge.textContent = String(favs.all().length || "");
  },
  _programHook(state, results) {
    ctx.programState = state;
    ctx.programResults = results;
  },
};

function parseHash() {
  const raw = location.hash.replace(/^#/, "") || "/heute";
  const [path, query] = raw.split("?");
  const params = new URLSearchParams(query || "");
  const route = path.replace(/\/+$/, "") || "/heute";
  return { route, params };
}

function renderNav() {
  const { route } = parseHash();
  if (backBtn) backBtn.disabled = routeHistoryIndex <= 0;
  if (forwardBtn) forwardBtn.disabled = routeHistoryIndex >= routeHistory.length - 1;
  const link = (href, label, badge, forceActive) => {
    const active = forceActive ?? ("#" + route) === href;
    return h("a", { class: `nav-link ${active ? "active" : ""}`, href }, label, badge || null);
  };
  nav.textContent = "";
  nav.append(
    link("#/heute", "Startseite"),
    link("#/programm", "Programm"),
    link("#/mein", "Mein Programm", h("span", { class: "fav-count pill", text: String(favs.all().length || "") })),
    link("#/themen", "Themen", null, route.startsWith("/themen")),
    link("#/sprecher", "Sprecher:innen"),
    link("#/info", "Info"));
}

function buildClusterModel(model) {
  const talks = model.sessions.filter((s) => s.type === "talk");
  const clusters = clusterSessions(talks);
  // Charakteristische Begriffe je Cluster (TF-IDF über Cluster-Titel)
  const clusterTerms = {};
  for (const [tagId, items] of clusters) {
    const docs = tfidf(items.map((s) => s.title));
    const freq = {};
    for (const terms of docs) for (const t of terms) freq[t] = (freq[t] || 0) + 1;
    clusterTerms[tagId] = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([t]) => t);
  }
  return { clusters, clusterTerms };
}

function render() {
  if (!ctx.model) return;
  const { route, params } = parseHash();
  renderNav();
  window.scrollTo({ top: 0 });

  let view;
  if (route.startsWith("/themen/")) {
    const tagId = decodeURIComponent(route.split("/")[2] || "");
    view = renderCluster(ctx.model, ctx, params, tagId);
  } else if (route === "/themen") {
    view = renderTopics(ctx.model, ctx, params);
  } else if (route === "/programm") {
    view = renderProgram(ctx.model, ctx, params);
    // Deep-Link auf einzelnen Vortrag: ?q=<id> exakt matchend -> Drawer öffnen
    const q = params.get("q") || "";
    if (q && ctx.model.byId[q]) {
      setTimeout(() => ctx.openSession(q), 0);
      history.replaceState(null, "", `#/programm?day=${encodeURIComponent(ctx.model.byId[q].day)}`);
    }
  } else if (route === "/mein") {
    view = renderMine(ctx.model, ctx);
  } else if (route === "/sprecher") {
    view = renderSpeakers(ctx.model, ctx);
  } else if (route.startsWith("/sprecher/")) {
    view = renderPerson(ctx.model, ctx, decodeURIComponent(route.split("/")[2] || ""));
  } else if (route === "/aenderungen") {
    view = renderChanges(ctx.model, ctx);
  } else if (route === "/info") {
    view = renderInfo(ctx.model);
  } else {
    view = renderDashboard(ctx.model, ctx);
  }
  app.textContent = "";
  app.append(view);
}

export function boot() {
  renderNav();
  window.addEventListener("hashchange", () => {
    const current = location.hash || "#/heute";
    if (current === routeHistory[routeHistoryIndex - 1]) {
      routeHistoryIndex--;
    } else if (current === routeHistory[routeHistoryIndex + 1]) {
      routeHistoryIndex++;
    } else if (current !== routeHistory[routeHistoryIndex]) {
      routeHistory.splice(routeHistoryIndex + 1);
      routeHistory.push(current);
      routeHistoryIndex = routeHistory.length - 1;
    }
    render();
  });
  const navigateHistory = (delta) => {
    const nextIndex = routeHistoryIndex + delta;
    if (nextIndex < 0 || nextIndex >= routeHistory.length) return;
    routeHistoryIndex = nextIndex;
    history.replaceState(null, "", routeHistory[routeHistoryIndex]);
    render();
  };
  backBtn?.addEventListener("click", () => navigateHistory(-1));
  forwardBtn?.addEventListener("click", () => navigateHistory(1));
  if ("serviceWorker" in navigator) {
    // Ein aktivierter Service Worker kann bereits geöffnete JS-/CSS-Dateien nicht
    // im laufenden Dokument austauschen. Sobald eine neue Version übernimmt,
    // laden wir daher genau einmal automatisch neu. Bei der Erstinstallation
    // bleibt die Seite ruhig, weil es noch keinen vorherigen Controller gab.
    let reloadingForUpdate = false;
    let hadController = Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!hadController) {
        hadController = true;
        return;
      }
      if (reloadingForUpdate) return;
      reloadingForUpdate = true;
      toast("Neue Version wird automatisch geladen …", { duration: 2000 });
      setTimeout(() => location.reload(), 500);
    });

    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" }).then((reg) => {
        const checkForUpdate = () => reg.update().catch(() => { /* offline */ });

        // Direkt prüfen, danach während längerer Nutzung alle fünf Minuten.
        checkForUpdate();
        setInterval(checkForUpdate, 5 * 60_000);

        // Nach Rückkehr aus einer anderen App bzw. nach neuer Netzverbindung
        // sofort prüfen, statt auf das nächste Intervall zu warten.
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") checkForUpdate();
        });
        window.addEventListener("online", checkForUpdate);
      }).catch(() => { /* offline optional */ });
    });
  }
  loadData()
    .then((model) => {
      ctx.model = model;
      ctx.byId = Object.fromEntries(model.sessions.map((s) => [s.id, s]));
      Object.assign(ctx.model, buildClusterModel(model));
      // Datenstand im Footer (global sichtbar): „Stand: 26.9.2026, 11:00"
      if (footerStand && model.meta?.generated_at) {
        const d = new Date(model.meta.generated_at);
        if (!isNaN(d)) footerStand.textContent = ` · Programmstand: ${d.toLocaleDateString("de-DE", { day: "numeric", month: "numeric", year: "numeric" })}, ${d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })} Uhr`;
      }
      if (!localStorage.getItem("slavtag26.view")) {
        try { localStorage.setItem("slavtag26.view", ctx.viewMode); } catch { /* ignore */ }
      }
      render();
      // Änderungs-Hinweis: wenn der letzte Programm-Sync Änderungen brachte und
      // dieser Stand noch nicht gesehen wurde, Toast mit Sprung zur Übersicht.
      const ch = model.changes;
      if (ch && ch.generated_at) {
        const c = ch.counts || {};
        const total = (c.new || 0) + (c.changed || 0) + (c.removed || 0);
        let seen = null;
        try { seen = localStorage.getItem("slavtag26.changes.seen"); } catch { /* ignore */ }
        if (total > 0 && seen !== ch.generated_at) {
          try { localStorage.setItem("slavtag26.changes.seen", ch.generated_at); } catch { /* ignore */ }
          toast(`Programm aktualisiert: ${c.new || 0} neu, ${c.changed || 0} geändert, ${c.removed || 0} entfallen`, {
            action: { label: "Ansehen", onclick: () => { location.hash = "#/aenderungen"; } },
            duration: 10000,
          });
        }
      }
      // „Jetzt“-Karte alle 60 s auffrischen
      setInterval(() => {
        const { route } = parseHash();
        if (route === "/heute") render();
      }, 60_000);
    })
    .catch((err) => {
      app.textContent = "";
      app.append(h("div", { class: "card error" },
        h("h2", { text: "Daten konnten nicht geladen werden" }),
        h("p", { text: String(err) }),
        h("button", { class: "btn", text: "Neu laden", onclick: () => location.reload() })));
    });
}

boot();
