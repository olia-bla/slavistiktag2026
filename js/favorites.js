// favorites.js – Favoriten in localStorage
import { store } from "./util.js";

const favStore = store("slavtag26.favs", []);

export const favs = {
  all() {
    return favStore.get();
  },
  has(id) {
    return favStore.get().includes(id);
  },
  toggle(id) {
    const cur = favStore.get();
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    favStore.set(next);
    return next.includes(id);
  },
};
