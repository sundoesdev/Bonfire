// Tiny DOM helpers for the vanilla frontend.
import { langColor, famColor, difficultyColor, getDifficulty, isFoundation } from "./constants.js";

// Build a single element from an HTML string.
export function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

// Escape text for safe interpolation into innerHTML.
export function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Colored language badge markup.
export function langBadge(lang) {
  if (!lang) return "";
  return `<span class="badge" style="background:${langColor(lang)}">${esc(lang)}</span>`;
}

// Colored familiarity badge markup.
export function famBadge(fam) {
  if (!fam) return "";
  return `<span class="badge" style="background:${famColor(fam)}">${esc(fam)}</span>`;
}

// Category chip (e.g. "snippet"). Uses theme vars for a readable, non-black look.
export function catBadge(cat) {
  if (!cat) return "";
  return `<span class="badge cat-badge">${esc(cat)}</span>`;
}

// Difficulty + foundation badges derived from a card's tags.
export function metaBadges(tags) {
  const diff = getDifficulty(tags);
  let out = "";
  if (diff) out += `<span class="badge" style="background:${difficultyColor(diff)}">${esc(diff)}</span>`;
  if (isFoundation(tags)) out += `<span class="badge" style="background:#7e7eff">foundation</span>`;
  return out;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

// Make Tab insert a tab character in a textarea instead of moving focus.
export function enableTab(textarea) {
  textarea.addEventListener("keydown", (e) => {
    if (e.key !== "Tab") return;
    e.preventDefault();
    const { selectionStart: a, selectionEnd: b, value } = textarea;
    textarea.value = value.slice(0, a) + "\t" + value.slice(b);
    textarea.selectionStart = textarea.selectionEnd = a + 1;
  });
}

// Today's date as YYYY-MM-DD (local), for "due for review" comparisons.
export function todayStr() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export function isDue(shard) {
  return (
    shard.reviewEnabled &&
    shard.reviewNext &&
    shard.reviewNext <= todayStr()
  );
}
