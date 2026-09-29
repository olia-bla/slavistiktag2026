// views/changes.js – „Was ist neu?": datierte Historie aller Programmänderungen
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

function changeCount(ch) {
  const c = ch?.counts || {};
  return (c.new || 0) + (c.changed || 0) + (c.removed || 0);
}

function changeTime(ch) {
  const date = new Date(ch.generated_at);
  return Number.isNaN(date.getTime()) ? "Zeit nicht bekannt"
    : date.toLocaleString("de-DE", {
        timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric",
        hour: "2-digit", minute: "2-digit",
      }) + " Uhr";
}

function renderBatch(ctx, ch) {
  const c = ch.counts || {};
  const wrap = h("article", { class: "change-batch" },
    h("h2", { text: changeTime(ch) }),
    h("p", { class: "meta", text: `${c.new || 0} neu · ${c.changed || 0} geändert · ${c.removed || 0} abgesagt` }));
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
        talkElement(ctx, t), " ", h("strong", { class: "cancel-label", text:
          ctx.byId?.[t.id] && ctx.byId[t.id].status !== "cancelled"
            ? "Damals abgesagt · inzwischen wieder im Programm" : "Abgesagt" }))))));
  }
  return wrap;
}

export function renderChanges(model, ctx) {
  const ch = model.changes;
  const wrap = h("div", { class: "view view-changes" });

  if (!ch) {
    wrap.append(h("header", { class: "hero compact" },
      h("h1", { text: "Programm-Änderungen" }),
      h("p", { class: "meta", text: "Noch keine Programmänderungen erfasst." })));
    return wrap;
  }

  // Ältere changes.json-Dateien ohne Historie bleiben weiterhin lesbar.
  // Gespeichert sind frühere Updates zuerst, das aktuelle als Top-Level-Diff.
  const updates = [...(Array.isArray(ch.history) ? ch.history : []), ch]
    .filter((batch) => changeCount(batch) > 0).reverse();
  wrap.append(h("header", { class: "hero compact" },
    h("h1", { text: "Programm-Änderungen" }),
    h("p", { class: "meta", text: updates.length
      ? `${updates.length} ${updates.length === 1 ? "Update" : "Updates"} im Verlauf · neueste Änderung: ${changeTime(updates[0])}. Klick öffnet den aktuellen Programmpunkt.`
      : "Noch keine Programmänderungen erfasst." })));

  if (!updates.length) return wrap;
  for (const batch of updates) wrap.append(renderBatch(ctx, batch));
  return wrap;
}
