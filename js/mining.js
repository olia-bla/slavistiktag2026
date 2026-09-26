// mining.js – Auto-Tagging, Sprachheuristik, TF-IDF, Clustering (DOM-frei testbar)
import { TAGS, TAG_BY_ID } from "./lexicon.js";

// ---------- Normalisierung (kompatibel zur Programm-App) ----------
export function normText(s) {
  return (s || "")
    .toLowerCase()
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2010-\u2015\u00ad]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------- Tagging ----------
// Ein Tag matcht, wenn eines seiner Muster als Teilstring im normalisierten
// Titel (inkl. Sprecher) vorkommt. Absicht: Komposita ("Ukrainischunterricht",
// "Kriegsliteratur", "Erinnerungskultur") treffen — das ist im Deutschen der
// Normalfall und die Lexikon-Muster sind darauf geprüft (tools/verify_lexicon.mjs).
export function tagsFor(session) {
  const hay = normText([session.title, ...(session.speakers || [])].filter(Boolean).join(" "));
  if (!hay) return [];
  const hits = [];
  for (const tag of TAGS) {
    for (const pat of tag.patterns) {
      const p = normText(pat);
      if (p && hay.includes(p)) { hits.push(tag.id); break; }
    }
  }
  return hits;
}

// ---------- Sprachheuristik ----------
// de / en / ru / uk / cs+sk+pl … als Hinweis, nicht als Klassifikation.
const DE_FN = ["der","die","das","den","dem","des","und","oder","ein","eine","einer","eines","im","in","zur","zum","von","mit","für","uber","über","als","auch","nicht","wird","werden","wenn","wie","was","sich","ihre","seine","zwischen","beim","nach","vor","aus","bei","auf","vom","durch","sowie","seit","noch","mehr","sehr","ihren","seinen","dessen","deren"];
const EN_FN = ["the","of","and","in","to","a","on","for","with","from","by","at","is","are","as","its","their","between","after","before","during","into","about","over","under","how","what","why","not","or","an","be","been","this","that","which","than","can","will","does","did","new","other"];
const RU_FN = ["и","в","во","не","на","что","как","это","от","для","по","из","за","то","же","бы","ли","или","при","между","среди","после","около","через","свой","своей","своего","который","которые","традиции","языка","языке","язык"];
const UK_FN = ["і","та","не","на","що","як","це","від","для","по","із","за","то","ж","би","ли","або","при","між","після","про","своєї","своїх","який","які","мови","мові","мова","україни"];
const CS_PL_HINT = [["ě","š","č","ř","ž","ů","ú","ý","í"], ["ą","ć","ę","ł","ń","ś","ź","ż","ó"]];

export function detectLanguage(title) {
  const t = title || "";
  if (!t) return null;
  const low = t.toLowerCase();

  // 1) Kyrillisch: Russisch vs. Ukrainisch über Funktionswörter + Spezialbuchstaben
  if (/[а-яё]/.test(low)) {
    if (/[іїєґ]/.test(low)) return "uk";
    if (/[ыъэё]/.test(low)) return "ru";
    const words = low.split(/[^\p{L}]+/u).filter(Boolean);
    let ru = 0, uk = 0;
    for (const w of words) {
      if (RU_FN.includes(w)) ru++;
      if (UK_FN.includes(w)) uk++;
    }
    if (ru > uk) return "ru";
    if (uk > ru) return "uk";
    return "ru"; // Kyrillisch ohne Indizien: meist Russisch
  }
  const words = low.normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/[^a-z]+/).filter(Boolean);
  let de = 0, en = 0;
  for (const w of words) {
    if (DE_FN.includes(w)) de++;
    if (EN_FN.includes(w)) en++;
  }
  // 2) Diakritika als sekundäres Signal (tschech./slowak. vs. polnisch)
  let cs = 0, pl = 0;
  for (const ch of low) {
    if (CS_PL_HINT[0].includes(ch)) cs++;
    if (CS_PL_HINT[1].includes(ch)) pl++;
  }
  if (de >= en && de >= 1) return "de";
  if (en > de) return "en";
  if (pl >= 2 && pl > cs) return "pl";
  if (cs >= 2 && cs > pl) return "cs";
  // 3) Nichts spricht dagegen: Titel enthalten deutsche Komposita wie „…unterricht"
  if (/(unterricht|sprache|literatur|forschung|analyse)/.test(low)) return "de";
  return null;
}

// ---------- TF-IDF ----------
export function tokenize(title) {
  return normText(title)
    .split(/[^a-zа-яё0-9]+/)
    .filter((w) => w.length > 3);
}

const STOP = new Set(["eine","einer","eines","einen","einem","der","die","das","den","dem","des","und","oder","aber","ist","sind","wird","werden","wurde","wurden","kann","können","nicht","auch","noch","nur","schon","sehr","mehr","dann","wenn","wie","was","wer","sich","ihre","seine","seiner","ihres","durch","nach","vor","über","unter","zwischen","seit","bei","mit","von","vom","zur","zum","für","aus","bei","auf","the","and","for","with","from","this","that","have","has","are","was","were","been","their","between","after","before","during","into","about","over","under","how","what","why","not","or","новых","новые","также","которые","который"]);

export function tfidf(texts) {
  // texts: Array von Strings. Liefert pro Text die charakteristischen Begriffe.
  const docs = texts.map(tokenize);
  const df = new Map();
  for (const doc of docs) {
    for (const w of new Set(doc)) df.set(w, (df.get(w) || 0) + 1);
  }
  const N = docs.length;
  return docs.map((doc) => {
    const tf = new Map();
    for (const w of doc) tf.set(w, (tf.get(w) || 0) + 1);
    const scored = [...tf.entries()].map(([w, c]) => {
      const idf = Math.log((N + 1) / ((df.get(w) || 0) + 0.5));
      return [w, c * idf];
    });
    scored.sort((a, b) => b[1] - a[1]);
    return scored.slice(0, 8).map(([w]) => w);
  });
}

// ---------- Clustering ----------
// Multi-Label: Ein Vortrag erscheint in JEDEM Cluster seiner Tags (Cluster-
// Größe == Tag-Anzahl, siehe Themen-Übersicht). Vorträge ohne Treffer sind
// in keinem Cluster — das ist gewollt und wird in der Info dokumentiert.
export function clusterSessions(sessions) {
  const clusters = new Map();
  for (const s of sessions) {
    for (const tag of s._tags || tagsFor(s)) {
      if (!clusters.has(tag)) clusters.set(tag, []);
      clusters.get(tag).push(s);
    }
  }
  return clusters;
}

export function tagStats(sessions) {
  const counts = new Map();
  for (const s of sessions) {
    for (const tag of s._tags || tagsFor(s)) {
      counts.set(tag, (counts.get(tag) || 0) + 1);
    }
  }
  return counts;
}

export function languageStats(sessions) {
  const counts = {};
  for (const s of sessions) {
    const l = s._lang || detectLanguage(s.title);
    if (l) counts[l] = (counts[l] || 0) + 1;
  }
  return counts;
}
