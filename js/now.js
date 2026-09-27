// now.js – „Jetzt & Als Nächstes“ (DOM-frei, mit injizierbarer Zeit testbar)

import { minutes, isoDay, hhmm } from "./util.js";

function itemStart(x) { return minutes(x.start); }
function itemEnd(x) { return minutes(x.end || x.start); }

// Beginn der Registrierung in Jena; der feste Offset vermeidet Unterschiede
// zwischen Geräten in Deutschland und Gästen in anderen Zeitzonen.
const CONFERENCE_START = Date.parse("2026-09-30T12:00:00+02:00");

export function conferenceCountdown(now = new Date()) {
  const totalMinutes = Math.ceil((CONFERENCE_START - now.getTime()) / 60_000);
  if (totalMinutes <= 0) return null;
  return {
    days: Math.floor(totalMinutes / 1_440),
    hours: Math.floor((totalMinutes % 1_440) / 60),
    minutes: totalMinutes % 60,
  };
}

export function nowInfo(model, now = new Date()) {
  const day = isoDay(now);
  const t = hhmm(now);
  const tm = minutes(t);

  // Vorträge, Pausen und Events (Podien, Rahmenprogramm) in einer Timeline.
  // Pausen gehören auch auf die Startseite: sonst wirkt das Programm während
  // der Kaffee- und Mittagspausen fälschlich leer.
  const items = [
    ...(model.byDay[day] || []).filter((s) => s.start && s.end),
    ...(model.eventByDay?.[day] || []).filter((e) => e.start && e.end),
  ].sort((a, b) => itemStart(a) - itemStart(b));

  const currentItems = items.filter((x) => itemStart(x) <= tm && tm < itemEnd(x));
  const current = currentItems[0] || null;
  const nextStart = items.find((x) => itemStart(x) > tm)?.start || null;
  const nextItems = nextStart ? items.filter((x) => x.start === nextStart) : [];
  const next = nextItems[0] || null;

  const conf = model.conference;
  const inRange = day >= conf.start && day <= conf.end;

  let status;
  if (!inRange) {
    status = day < conf.start ? "before" : "after";
  } else if (current) {
    status = current.type === "break" ? "break" : "session";
  } else if (next) {
    status = "break";
  } else {
    status = "done";
  }

  return { day, time: t, status, current, next, currentItems, nextItems, items };
}
