// ics.js – ICS-Kalenderexport für Favoriten (DOM-frei testbar, Download in UI-Schicht)

const TZ = "Europe/Berlin";

function icsEscape(s) {
  return (s || "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

function icsDate(dayIso, time) {
  // DTSTART;TZID=...:YYYYMMDDTHHMMSS
  const [y, m, d] = dayIso.split("-");
  const [hh, mm] = (time || "00:00").split(":");
  return `${y}${m}${d}T${hh}${mm}00`;
}

function foldLine(line) {
  // RFC 5545: Zeilen max. 75 Oktetten, Fortsetzung mit Leerzeichen
  const parts = [];
  let cur = "";
  for (const ch of line) {
    if (cur.length + 1 > 73) {
      parts.push(cur);
      cur = " " + ch;
    } else {
      cur += ch;
    }
  }
  parts.push(cur);
  return parts.join("\r\n");
}

export function icsFor(events, opts = {}) {
  // events: [{day:'2026-10-01', start:'09:00', end:'10:00', title, room, description}]
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//slavistiktag2026//programm-app//DE",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VTIMEZONE",
    `TZID:${TZ}`,
    "BEGIN:STANDARD",
    "DTSTART:19701025T030000",
    "TZOFFSETFROM:+0200",
    "TZOFFSETTO:+0100",
    "TZNAME:CET",
    "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
    "END:STANDARD",
    "BEGIN:DAYLIGHT",
    "DTSTART:19700329T020000",
    "TZOFFSETFROM:+0100",
    "TZOFFSETTO:+0200",
    "TZNAME:CEST",
    "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
    "END:DAYLIGHT",
    "END:VTIMEZONE",
  ];
  events.forEach((e, i) => {
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:slavtag2026-${e.day}-${e.start}-${i}@programm-app`);
    lines.push(`DTSTAMP:${stamp}`);
    lines.push(`DTSTART;TZID=${TZ}:${icsDate(e.day, e.start)}`);
    lines.push(`DTEND;TZID=${TZ}:${icsDate(e.day, e.end || e.start)}`);
    lines.push(foldLine(`SUMMARY:${icsEscape(e.title)}`));
    if (e.room) lines.push(foldLine(`LOCATION:${icsEscape(e.room)}`));
    if (e.description) lines.push(foldLine(`DESCRIPTION:${icsEscape(e.description)}`));
    lines.push("END:VEVENT");
  });
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

export function downloadIcs(filename, text) {
  const blob = new Blob([text], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
