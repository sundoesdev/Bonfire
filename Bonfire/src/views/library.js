// Library: fuzzy search + language/category/familiarity/tag filters + 3 sort modes.
import { el, esc, langBadge, famBadge, metaBadges, catBadge } from "../dom.js";
import { CATEGORIES, FAMILIARITIES, FAMILIARITY_ORDER } from "../constants.js";

// Concatenated searchable text for a shard (title, language, category, tags, desc, code).
function searchText(s) {
  return [s.title, s.language, s.category, (s.tags || []).join(" "), s.description, s.code]
    .join(" ")
    .toLowerCase();
}

// All query words must appear somewhere in the search text.
function fuzzyMatch(query, s) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const text = searchText(s);
  return words.every((w) => text.includes(w));
}

export function renderLibrary(container, ctx, params = {}) {
  const shards = ctx.state.shards;
  const allLangs = [...new Set(shards.map((s) => s.language).filter(Boolean))].sort();
  const allTags = [...new Set(shards.flatMap((s) => s.tags || []))].sort();

  const opt = (v, label) => `<option value="${esc(v)}">${esc(label ?? v)}</option>`;

  const root = el(`
    <div>
      <div class="row">
        <input type="text" id="search" class="search-input" placeholder="Search shards... (title, language, code, tags)" />
        <button class="btn btn-primary" id="new-btn">+ New</button>
      </div>
      <div class="filters">
        <select id="f-lang">${opt("", "All languages")}${allLangs.map((l) => opt(l)).join("")}</select>
        <select id="f-cat">${opt("", "All categories")}${CATEGORIES.map((c) => opt(c)).join("")}</select>
        <select id="f-fam">${opt("", "All familiarity")}${FAMILIARITIES.map((f) => opt(f)).join("")}</select>
        <select id="f-tag">${opt("", "All tags")}${allTags.map((t) => opt(t)).join("")}</select>
        <select id="f-sort">
          ${opt("modified", "Recently modified")}
          ${opt("alpha", "Alphabetical")}
          ${opt("familiarity", "Familiarity (shaky first)")}
        </select>
      </div>
      <div class="count-label" id="count"></div>
      <div id="list"></div>
    </div>
  `);

  const search = root.querySelector("#search");
  const fLang = root.querySelector("#f-lang");
  const fCat = root.querySelector("#f-cat");
  const fFam = root.querySelector("#f-fam");
  const fTag = root.querySelector("#f-tag");
  const fSort = root.querySelector("#f-sort");
  const list = root.querySelector("#list");
  const count = root.querySelector("#count");

  function applyAndRender() {
    let result = shards.filter((s) => {
      if (!fuzzyMatch(search.value, s)) return false;
      if (fLang.value && s.language !== fLang.value) return false;
      if (fCat.value && s.category !== fCat.value) return false;
      if (fFam.value && s.familiarity !== fFam.value) return false;
      if (fTag.value && !(s.tags || []).includes(fTag.value)) return false;
      return true;
    });

    if (fSort.value === "alpha") {
      result.sort((a, b) => (a.title || "").toLowerCase().localeCompare((b.title || "").toLowerCase()));
    } else if (fSort.value === "familiarity") {
      const rank = (f) => {
        const i = FAMILIARITY_ORDER.indexOf(f);
        return i === -1 ? 99 : i;
      };
      result.sort((a, b) => rank(a.familiarity) - rank(b.familiarity));
    }
    // "modified" keeps backend order (modified_at DESC).

    count.textContent = `${result.length} shard${result.length === 1 ? "" : "s"}`;
    list.innerHTML = "";
    if (!result.length) {
      list.appendChild(el('<div class="empty">No matching shards.</div>'));
      return;
    }
    result.forEach((s) => {
      const row = el(`
        <div class="list-row">
          ${langBadge(s.language)}
          <span class="title">${esc(s.title) || "(untitled)"}</span>
          ${metaBadges(s.tags)}
          ${s.reviewEnabled ? '<span class="review-dot">●</span>' : ""}
          ${catBadge(s.category)}
          ${famBadge(s.familiarity)}
          <button class="btn mini review-btn" title="Review this card (no answer shown first)">Review</button>
        </div>
      `);
      row.addEventListener("dblclick", () => ctx.openShard(s.id));
      // Single-card review straight from the list, without opening the editor
      // (which would reveal the answer first).
      row.querySelector(".review-btn").addEventListener("click", (e) => {
        e.stopPropagation();
        ctx.reviewCard(s.id);
      });
      list.appendChild(row);
    });
  }

  search.addEventListener("input", applyAndRender);
  [fLang, fCat, fFam, fTag, fSort].forEach((sel) => sel.addEventListener("change", applyAndRender));
  root.querySelector("#new-btn").addEventListener("click", () => ctx.newShard());

  container.appendChild(root);
  applyAndRender();
  if (params.focusSearch) search.focus();
}
