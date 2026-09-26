// util.js – DOM-Helfer und kleine Utilities (DOM-frei testbar)

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k === "html") el.innerHTML = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const DAY_NAMES = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];

export function dateLabel(iso) {
  const d = new Date(iso + "T12:00:00");
  return `${DAY_NAMES[d.getDay()]}, ${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.`;
}

export function shortDate(iso) {
  const [, m, d] = iso.split("-");
  return `${d}.${m}.`;
}

export function timeRange(s, e) {
  if (!s) return "";
  return e ? `${s}–${e}` : s;
}

export function debounce(fn, ms = 200) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export function store(key, fallback) {
  return {
    get() {
      try {
        const v = localStorage.getItem(key);
        return v == null ? fallback : JSON.parse(v);
      } catch {
        return fallback;
      }
    },
    set(v) {
      try {
        localStorage.setItem(key, JSON.stringify(v));
      } catch { /* private mode etc. */ }
    },
  };
}

export function isoDay(date) {
  // lokale Zeit → YYYY-MM-DD (Gerätezeit, Zielgruppe D/A/CH)
  const p = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

export function hhmm(date) {
  const p = (n) => String(n).padStart(2, "0");
  return `${p(date.getHours())}:${p(date.getMinutes())}`;
}

export function minutes(isoTime) {
  const [h, m] = isoTime.split(":").map(Number);
  return h * 60 + m;
}

export function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Toast: kurze Rückmeldung ohne alert(); auto-hide nach 3.5 s
// options.action: { label, onclick } zeigt zusätzlich einen Aktions-Button
// (z. B. „Neu laden" beim SW-Update); options.duration überschreibt die Anzeigezeit.
export function toast(msg, options) {
  if (typeof document === "undefined") return;
  const el = h("div", { class: "toast", role: "status", text: msg });
  if (options?.action?.label) {
    const btn = h("button", { class: "toast-action", text: options.action.label });
    btn.addEventListener("click", () => {
      options.action.onclick?.();
      el.remove();
    });
    el.append(btn);
  }
  document.body.append(el);
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => el.remove(), 350);
  }, options?.duration || 3500);
  return el;
}
