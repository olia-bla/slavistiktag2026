// views/mine.js – Mein Programm (Favoriten) mit ICS-Export, Konflikt-Warnung, Backup
import { h, dateLabel, timeRange, minutes, toast } from "../util.js";
import { favs } from "../favorites.js";
import { icsFor, downloadIcs } from "../ics.js";

// Überlappen zwei Favoriten zeitlich? (gleicher Tag, a.start < b.end && b.start < a.end)
function overlapping(a, b) {
  if (!a.day || a.day !== b.day || !a.start || !b.start) return false;
  const [as, ae, bs, be] = [minutes(a.start), minutes(a.end || a.start), minutes(b.start), minutes(b.end || b.start)];
  return as < be && bs < ae;
}

export function conflictsByDay(model, ids) {
  const byDay = {};
  for (const id of ids) {
    const s = model.sessions.find((x) => x.id === id);
    if (s) (byDay[s.day] ||= []).push(s);
  }
  const conflicts = {};
  for (const [day, list] of Object.entries(byDay)) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (overlapping(list[i], list[j])) {
          (conflicts[list[i].id] ||= []).push(list[j].id);
          (conflicts[list[j].id] ||= []).push(list[i].id);
        }
      }
    }
  }
  return { byDay, conflicts };
}

export function renderMine(model, ctx) {
  const ids = favs.all();
  const { byDay, conflicts } = conflictsByDay(model, ids);
  const days = Object.keys(byDay).sort();

  const wrap = h("div", { class: "view view-mine" },
    h("header", { class: "hero compact" },
      h("h1", { text: "Mein Programm" }),
      h("p", { class: "meta", text: ids.length ? `${ids.length} gemerkte Veranstaltungen` : "Noch nichts gemerkt – setze ★ in der Programmansicht." })));

  if (!ids.length) {
    wrap.append(h("div", { class: "card" },
      h("p", { text: "Tippe in der Programmansicht auf ☆, um Vorträge zu merken. Sie erscheinen hier und lassen sich als Kalenderdatei exportieren." }),
      h("a", { class: "btn", href: "#/programm", text: "Zum Programm" })));
  } else {
    wrap.append(h("div", { class: "btn-row" },
      h("button", {
        class: "btn", text: "⤓ Alle als Kalender (.ics)",
        onclick: () => {
          const events = ids
            .map((id) => model.sessions.find((x) => x.id === id))
            .filter(Boolean)
            .map((s) => ({ day: s.day, start: s.start, end: s.end, title: s.title, room: s.room || "" }));
          downloadIcs("mein-slavistiktag.ics", icsFor(events));
        },
      })));
  }
  wrap.append(h("details", { class: "backup-options" },
    h("summary", { text: "Favoriten sichern oder übertragen (optional)" }),
    h("p", { class: "meta", text: "Nur nötig, wenn du deine Favoriten als Datei sichern oder auf einem anderen Gerät nutzen möchtest." }),
    h("div", { class: "btn-row" },
    ids.length ? h("button", {
      class: "btn ghost", text: "Favoriten speichern (.json)",
      onclick: () => {
        const payload = JSON.stringify({ app: "slavtag26", version: 1, favs: ids, exported: new Date().toISOString() }, null, 2);
        const url = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
        const a = h("a", { href: url, download: "slavtag26-favoriten.json" });
        document.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
      },
    }) : null,
    h("button", {
      class: "btn ghost", text: "Favoriten laden",
      onclick: () => {
        const inp = h("input", { type: "file", accept: "application/json,.json", style: "display:none" });
        inp.addEventListener("change", async () => {
          const file = inp.files?.[0];
          if (!file) return;
          try {
            const data = JSON.parse(await file.text());
            if (data?.app !== "slavtag26" || !Array.isArray(data.favs)) throw new Error("kein slavtag26-Backup");
            const known = new Set(model.sessions.map((s) => s.id));
            const merged = [...new Set([...favs.all(), ...data.favs.filter((x) => known.has(x))])];
            favs.set ? favs.set(merged) : localStorage.setItem("slavtag26.favs", JSON.stringify(merged));
            const skipped = data.favs.filter((x) => !known.has(x)).length;
            toast(skipped ? `Backup geladen – ${merged.length} Favoriten, ${skipped} unbekannte übersprungen.` : `Backup geladen – ${merged.length} Favoriten.`);
            ctx.render();
          } catch (err) {
            toast(`Backup konnte nicht geladen werden: ${err.message}`);
          }
        });
        inp.click();
      },
    }))));

  for (const day of days) {
    const list = byDay[day].sort((a, b) => (a.start || "").localeCompare(b.start || ""));
    wrap.append(h("section", { class: "card" },
      h("h2", { text: dateLabel(day) }),
      h("div", { class: "list-view" },
        list.map((s) => {
          const clash = conflicts[s.id] || [];
          const clashNames = clash
            .map((id) => model.byId?.[id] || model.sessions.find((x) => x.id === id))
            .filter(Boolean)
            .map((x) => `${x.start} ${x.title.slice(0, 40)}`);
          return h("article", {
            class: `card session-card track-${(s.discipline || "x").toLowerCase()} is-fav ${clash.length ? "has-conflict" : ""}`,
            onclick: () => ctx.openSession(s.id), tabindex: "0", role: "button",
          },
            h("div", { class: "card-top" },
              h("span", { class: "time", text: timeRange(s.start, s.end) }),
              h("button", {
                class: "fav active", "aria-label": "Entfernen", text: "★",
                onclick: (e) => { e.stopPropagation(); favs.toggle(s.id); ctx.render(); },
              })),
            clash.length ? h("div", { class: "conflict-note", role: "status" },
              h("strong", { text: `⚠ Überschneidung mit ${clash.length} ${clash.length === 1 ? "gemerkter Veranstaltung" : "gemerkten Veranstaltungen"}:` }),
              " ", clashNames.join(" · ")) : null,
            h("div", { class: "card-title", text: s.title }),
            s.speakers?.length ? h("div", { class: "card-speakers", text: s.speakers.join(", ") }) : null,
            h("div", { class: "card-panel" },
              h("span", { class: "pill room", text: s.room || "" }), " ",
              s.panel_title || ""));
        }))));
  }
  return wrap;
}
