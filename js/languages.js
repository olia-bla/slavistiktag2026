// Einheitliche Bezeichnungen für Vortragssprachen in Programm, Themenansicht
// und Detailfenster.
export const LANGUAGE_NAMES = Object.freeze({
  de: "Deutsch",
  en: "Englisch",
  ru: "Russisch",
  uk: "Ukrainisch",
  pl: "Polnisch",
  cs: "Tschechisch",
  sk: "Slowakisch",
});

export function languageName(lang) {
  return LANGUAGE_NAMES[lang] || (lang ? lang.toUpperCase() : "");
}

export function nonGermanLanguageBadge(lang) {
  if (!lang || lang === "de") return null;
  return {
    label: lang.toUpperCase(),
    title: `Vortragssprache: ${languageName(lang)}`,
  };
}
