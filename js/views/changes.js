// views/changes.js – „Was ist neu?": Änderungen des letzten Programm-Syncs
// (Quelle: data/changes.json, erzeugt von tools/fetch_conftool.py im Workflow).
// Auch abgesagte Vorträge bleiben verlinkt, damit ihre Details sichtbar sind.
import { h, dateLabel } from "../util.js";

function talkElement(ctx, t) {
  const exists = ctx.byId[t.id];
  const label = `${t.day ? dateLabel(t.day) + " · " : ""}${t.start || "?"}${t.end ? "–" + t.end : ""}${t.room ? " · " + t.room : ""} — ${t.title}`;
  if (!exists) return h("span", { text: label });
  return h("a", {
      href: "#",
      onclick: (e) => { e.preventDefault(); ctx.openSession(t.id); },
    }, label);
}

function linkTalk(ctx, t) {
  return h("li", {},
    talkElement(ctx, t),
    t.speakers?.length ? h("span", { class: "meta", text: ` — ${t.speakers.join(", ")}` }) : null);
}

function slotChange(oldSlot, newSlot) {
  const parts = (s) => [dateLabel(s.day), s.start && s.end ? `${s.start}–${s.end}` : s.start, s.room]
    .filter(Boolean).join(" · ");
  return h("span", { class: "slot-change" },
    h("span", { class: "old", text: parts(oldSlot) }),
    " → ",
    h("span", { class: "new", text: parts(newSlot) }));
}

export function renderChanges(model, ctx) {
  const ch = model.changes;
  const wrap = h("div", { class: "view view-changes" });

  if (!ch) {
    wrap.append(
      h("header", { class: "hero compact" },
        h("h1", { text: "Programm-Änderungen" }),
        h("p", { class: "meta", text: "Noch kein Änderungsverzeichnis vorhanden – es entsteht beim nächsten Programm-Sync, sobald sich etwas geändert hat." })));
    return wrap;
  }

  const c = ch.counts || {};
  const total = (c.new || 0) + (c.changed || 0) + (c.removed || 0);
  wrap.append(
    h("header", { class: "hero compact" },
      h("h1", { text: "Programm-Änderungen" }),
      h("p", { class: "meta", text: total
        ? `Letzter Sync: ${new Date(ch.generated_at).toLocaleString("de-DE")} — ${c.new || 0} neu, ${c.changed || 0} geändert, ${c.removed || 0} abgesagt.`
        : `Letzter Sync: ${new Date(ch.generated_at).toLocaleString("de-DE")} — keine Änderungen gegenüber dem Stand davor.` })));

  if (!total) {
    wrap.append(h("p", { class: "empty", text: "Das Programm hat sich seit dem letzten Sync nicht geändert." }));
    return wrap;
  }

  if (c.new) {
    wrap.append(h("section", {},
      h("h3", { text: `Neu im Programm (${c.new})` }),
      h("ul", { class: "mini-list" }, ch.new.map((t) => linkTalk(ctx, t)))));
  }
  if (c.changed) {
    wrap.append(h("section", {},
      h("h3", { text: `Geändert / verschoben (${c.changed})` }),
      h("ul", { class: "mini-list" }, ch.changed.map((t) => h("li", {},
        talkElement(ctx, t), " ",
        t.old && ["day", "start", "end", "room"].some((k) => t.old[k] !== t[k])
          ? slotChange(t.old, t) : null,
        t.old?.title && t.old.title !== t.title
          ? h("span", { class: "meta", text: ` · Titel zuvor: ${t.old.title}` }) : null,
        t.old?.speakers && t.old.speakers.join(", ") !== (t.speakers || []).join(", ")
          ? h("span", { class: "meta", text: ` · Name zuvor: ${t.old.speakers.join(", ")}` }) : null)))));
  }
  if (c.removed) {
    wrap.append(h("section", {},
      h("h3", { text: `Abgesagt (${c.removed})` }),
      h("ul", { class: "mini-list" }, ch.removed.map((t) => h("li", { class: "removed" },
        talkElement(ctx, t), " ", h("strong", { class: "cancel-label", text: "Abgesagt" }))))));
  }
  return wrap;
}
