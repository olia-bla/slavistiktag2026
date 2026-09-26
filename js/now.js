// now.js – „Jetzt & Als Nächstes“ (DOM-frei, mit injizierbarer Zeit testbar)

import { minutes, isoDay, hhmm } from "./util.js";

function itemStart(x) { return minutes(x.start); }
function itemEnd(x) { return minutes(x.end || x.start); }

export function nowInfo(model, now = new Date()) {
  const day = isoDay(now);
  const t = hhmm(now);
  const tm = minutes(t);

  // Vorträge/Pausen + Events (Podien, Rahmenprogramm) in einer Timeline
  const items = [
    ...(model.byDay[day] || []).filter((s) => s.start && s.end && s.type !== "break"),
    ...(model.eventByDay?.[day] || []).filter((e) => e.start && e.end),
  ].sort((a, b) => itemStart(a) - itemStart(b));

  const current = items.find((x) => itemStart(x) <= tm && tm < itemEnd(x)) || null;
  const next = items.find((x) => itemStart(x) > tm) || null;

  const conf = model.conference;
  const inRange = day >= conf.start && day <= conf.end;

  let status;
  if (!inRange) {
    status = day < conf.start ? "before" : "after";
  } else if (current) {
    status = "session";
  } else if (next) {
    status = "break";
  } else {
    status = "done";
  }

  return { day, time: t, status, current, next, items };
}
