// views/topics.js – Themen-Kompass: Cluster-Übersicht + Cluster-Detail
import { h, dateLabel } from "../util.js";
import { TAGS, TAG_BY_ID } from "../lexicon.js";
import { tagStats, languageStats } from "../mining.js";
import { languageName, nonGermanLanguageBadge } from "../languages.js";

export function renderTopics(model, ctx, params) {
  const wrap = h("div", { class: "view view-topics" });
  const sessions = model.sessions.filter((s) => s.type === "talk");
  const stats = tagStats(sessions);

  wrap.append(h("div", { class: "topics-intro" },
    h("h1", { text: "Themen-Kompass" }),
    h("p", { class: "dim", text:
      `${sessions.length} Vorträge, automatisch nach 27 Themenfeldern gruppiert ` +
      `(Keyword-Matching über Titel und Sprecher). ` +
      "Klick auf ein Cluster zeigt die Vorträge." })));

  const groups = {};
  for (const tag of TAGS) (groups[tag.group] ||= []).push(tag);

  for (const [group, tags] of Object.entries(groups)) {
    wrap.append(h("h2", { class: "group-head", text: group }));
    const grid = h("div", { class: "cluster-grid" });
    for (const tag of tags) {
      const count = stats.get(tag.id) || 0;
      if (!count) continue;
      const cluster = model.clusters.get(tag.id) || [];
      const terms = model.clusterTerms[tag.id] || [];
      const langs = languageStats(cluster);
      const langPills = Object.entries(langs)
        .sort((a, b) => b[1] - a[1]).slice(0, 3)
        .map(([l, c]) => `${languageName(l)} ${c}`).join(" · ");

      const card = h("article", {
        class: "card cluster-card",
        "data-tag": tag.id,
        onclick: () => { location.hash = `#/themen/${tag.id}`; },
        tabindex: "0",
        role: "button",
        "aria-label": `Cluster ${tag.label}, ${count} Vorträge`,
      },
        h("div", { class: "cluster-head" },
          h("h3", { text: tag.label }),
          h("span", { class: "pill count", text: String(count) })),
        h("div", { class: "cluster-terms", text: terms.slice(0, 6).join(" · ") || "—" }),
        h("div", { class: "cluster-meta" },
          h("span", { class: "dim", text: langPills || "" })));
      grid.append(card);
    }
    if (grid.children.length) wrap.append(grid);
  }

  return wrap;
}

// Detailansicht eines Clusters: alle zugehörigen Vorträge
export function renderCluster(model, ctx, params, tagId) {
  const wrap = h("div", { class: "view view-cluster" });
  const tag = TAG_BY_ID[tagId];
  if (!tag) {
    wrap.append(h("p", { class: "empty", text: "Unbekanntes Cluster." }));
    return wrap;
  }
  const cluster = model.clusters.get(tagId) || [];
  const byDay = {};
  for (const s of cluster) (byDay[s.day] ||= []).push(s);
  const days = Object.keys(byDay).sort();

  wrap.append(
    h("a", { class: "back-link", href: "#/themen", text: "← Themen-Kompass" }),
    h("h1", { text: tag.label }),
    h("p", { class: "dim", text: `${cluster.length} Vorträge, nach Tagen gruppiert. Klick öffnet den Vortrag im Drawer.` }));

  for (const day of days) {
    wrap.append(h("h2", { class: "group-head", text: dateLabel(day) }));
    const list = h("div", { class: "cluster-list" });
    for (const s of byDay[day].sort((a, b) => (a.start || "").localeCompare(b.start || ""))) {
      list.append(clusterItem(ctx, s));
    }
    wrap.append(list);
  }
  return wrap;
}

function clusterItem(ctx, s) {
  const languageBadge = nonGermanLanguageBadge(s._lang);
  return h("article", {
    class: `card cluster-item track-${(s.discipline || "x").toLowerCase()}`,
    "data-id": s.id,
    onclick: () => ctx.openSession(s.id),
    tabindex: "0",
    role: "button",
  },
    h("div", { class: "item-top" },
      h("span", { class: "time", text: `${s.start}–${s.end}` }),
      h("span", { class: "pill room", text: s.room || "—" }),
      languageBadge ? h("span", { class: "pill lang", text: languageBadge.label, title: languageBadge.title }) : null),
    h("div", { class: "card-title", text: s.title }),
    s.speakers?.length ? h("div", { class: "card-speakers", text: s.speakers.join(", ") }) : null);
}
