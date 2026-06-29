// Tiny DOM helpers for the vanilla frontend.
import { langColor, difficultyColor, getDifficulty, isFoundation } from "./constants.js";

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

// Language identity is a quiet dot, not a saturated fill (the #1 list-cleanup).
// The dot color comes from the language map via a CSS var; .lang-dot mutes its
// saturation in CSS. The name is always available as a title/tooltip.
export function langDot(lang) {
  if (!lang) return "";
  return `<span class="lang-dot" style="--dot:${langColor(lang)}" title="${esc(lang)}"></span>`;
}

// Dot + name, for places the language should read inline (study card / queue).
export function langBadge(lang) {
  if (!lang) return "";
  return `<span class="lang"><span class="lang-dot" style="--dot:${langColor(lang)}"></span>${esc(lang)}</span>`;
}

// Familiarity is demoted: "fresh" is the default of most cards, so show nothing;
// "shaky" gets a single small warm dot. Not a saturated chip on every row.
export function famBadge(fam) {
  if (fam === "shaky") return `<span class="fam-dot" title="Shaky — worth a review"></span>`;
  return "";
}

// Category chip — kept quiet, for the detail view only (off list rows now).
export function catBadge(cat) {
  if (!cat) return "";
  return `<span class="pill">${esc(cat)}</span>`;
}

// Difficulty + foundation as quiet pills (Library rows + detail views), with a
// small color dot for difficulty rather than a full saturated fill.
export function metaBadges(tags) {
  const diff = getDifficulty(tags);
  let out = "";
  if (diff)
    out += `<span class="pill"><span class="pill-dot" style="--dot:${difficultyColor(diff)}"></span>${esc(diff)}</span>`;
  if (isFoundation(tags)) out += `<span class="pill">foundation</span>`;
  return out;
}

// Signature Hearth donut: a surface-3 track + an accent value arc (starts at 12
// o'clock), with a serif % in the center. Used for mastery / retention.
export function progressRing(pct, sublabel = "", size = 78) {
  const p = Math.max(0, Math.min(100, Math.round(pct)));
  const c = 2 * Math.PI * 30; // r = 30
  const fill = (p / 100) * c;
  return `
    <svg class="ring" width="${size}" height="${size}" viewBox="0 0 78 78" aria-hidden="true">
      <circle cx="39" cy="39" r="30" fill="none" stroke="var(--surface-3)" stroke-width="9" />
      <circle cx="39" cy="39" r="30" fill="none" stroke="var(--accent)" stroke-width="9"
        stroke-dasharray="${fill.toFixed(1)} ${(c - fill).toFixed(1)}" stroke-linecap="round"
        transform="rotate(-90 39 39)" />
      <text class="ring-num" x="39" y="37" text-anchor="middle">${p}%</text>
      ${sublabel ? `<text class="ring-sub" x="39" y="50" text-anchor="middle">${esc(sublabel)}</text>` : ""}
    </svg>`;
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
