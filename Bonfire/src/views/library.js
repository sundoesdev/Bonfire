// Library: fuzzy search + language/category/familiarity/tag filters + 3 sort modes,
// plus multi-select with bulk actions (item 1: delete / re-tag / add-to-deck /
// remove-from-deck / edit).
import { el, esc, langDot, metaBadges, isDue } from "../dom.js";
import { CATEGORIES, FAMILIARITIES, FAMILIARITY_ORDER } from "../constants.js";
import {
  bulkDelete,
  bulkAddToDeck,
  bulkRemoveFromDeck,
  openBulkMenu,
  fieldMenuItems,
  mediaMenuItems,
} from "../components/bulkBar.js";

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

  // Ids selected for bulk actions (persists across filter/sort changes this render).
  const selected = new Set();
  let lastResultIds = [];
  // Anchor for Shift+Click range selection (index into lastResultIds of the last
  // plain-clicked checkbox); null until the first click.
  let anchorIdx = null;

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
      <div class="row count-label bulk-toolbar">
        <label class="chk"><input type="checkbox" id="sel-all" /> Select all</label>
        <span id="count"></span>
        <span class="muted" id="sel-count"></span>
        <div class="spacer"></div>
        <span class="bulk-actions" id="bulk-actions" hidden>
          <button class="btn btn-accent mini" id="bulk-edit" disabled>Edit</button>
          <button class="btn btn-tool mini" id="bulk-fields">Edit field ▾</button>
          <button class="btn btn-tool mini" id="bulk-media">Add media ▾</button>
          <button class="btn btn-tool mini" id="bulk-deck-add">Add to deck</button>
          <button class="btn btn-tool mini" id="bulk-deck-rm">Remove from deck</button>
          <button class="btn btn-danger mini" id="bulk-del">Delete</button>
        </span>
      </div>
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
  const selAll = root.querySelector("#sel-all");
  const selCount = root.querySelector("#sel-count");
  const bulkActions = root.querySelector("#bulk-actions");
  const bulkEdit = root.querySelector("#bulk-edit");
  const bulkFields = root.querySelector("#bulk-fields");
  const bulkMedia = root.querySelector("#bulk-media");
  const bulkDeckAdd = root.querySelector("#bulk-deck-add");
  const bulkDeckRm = root.querySelector("#bulk-deck-rm");
  const bulkDel = root.querySelector("#bulk-del");

  function updateToolbar() {
    const n = selected.size;
    selCount.textContent = n ? `· ${n} selected` : "";
    // The action buttons appear only when something is selected (contextual bar).
    bulkActions.hidden = n === 0;
    bulkEdit.disabled = n !== 1; // single-card edit only
    selAll.checked = lastResultIds.length > 0 && lastResultIds.every((id) => selected.has(id));
  }

  async function runBulk(fn) {
    const ids = [...selected];
    if (!ids.length) return;
    const ok = await fn(ctx, ids);
    if (ok) {
      selected.clear();
      ctx.refreshView();
    }
  }

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

    lastResultIds = result.map((s) => s.id);
    count.textContent = `${result.length} shard${result.length === 1 ? "" : "s"}`;
    list.innerHTML = "";
    if (!result.length) {
      list.appendChild(el('<div class="empty">No matching shards.</div>'));
      updateToolbar();
      return;
    }
    result.forEach((s) => {
      const row = el(`
        <div class="list-row">
          <input type="checkbox" class="row-sel" ${selected.has(s.id) ? "checked" : ""} />
          ${langDot(s.language)}
          <span class="title">${esc(s.title) || "(untitled)"}</span>
          ${isDue(s) ? '<span class="review-dot" title="Due for review today">●</span>' : ""}
          ${metaBadges(s.tags)}
          <button class="btn btn-tool mini review-btn" title="Review this card (no answer shown first)">Review</button>
        </div>
      `);
      const cb = row.querySelector(".row-sel");
      // Selection happens on click (it carries shiftKey; `change` doesn't). Shift+Click
      // selects the whole range between the anchor and this row (item 5, notes-03).
      cb.addEventListener("click", (e) => {
        e.stopPropagation();
        const idx = lastResultIds.indexOf(s.id);
        if (e.shiftKey && anchorIdx !== null && idx !== -1) {
          const lo = Math.min(anchorIdx, idx);
          const hi = Math.max(anchorIdx, idx);
          const on = cb.checked; // apply the clicked box's new state across the range
          for (let i = lo; i <= hi; i++) {
            if (on) selected.add(lastResultIds[i]);
            else selected.delete(lastResultIds[i]);
          }
          applyAndRender(); // repaint checkboxes from `selected` (keeps the anchor)
          return;
        }
        if (cb.checked) selected.add(s.id);
        else selected.delete(s.id);
        anchorIdx = idx;
        updateToolbar();
      });
      row.addEventListener("dblclick", () => ctx.openShard(s.id));
      // Single-card review straight from the list, without opening the editor
      // (which would reveal the answer first).
      row.querySelector(".review-btn").addEventListener("click", (e) => {
        e.stopPropagation();
        ctx.reviewCard(s.id);
      });
      list.appendChild(row);
    });
    updateToolbar();
  }

  search.addEventListener("input", applyAndRender);
  [fLang, fCat, fFam, fTag, fSort].forEach((sel) => sel.addEventListener("change", applyAndRender));
  root.querySelector("#new-btn").addEventListener("click", () => ctx.newShard());

  selAll.addEventListener("change", () => {
    if (selAll.checked) lastResultIds.forEach((id) => selected.add(id));
    else lastResultIds.forEach((id) => selected.delete(id));
    applyAndRender();
  });
  bulkDel.addEventListener("click", () => runBulk(bulkDelete));
  bulkDeckAdd.addEventListener("click", () => runBulk(bulkAddToDeck));
  bulkDeckRm.addEventListener("click", () => runBulk(bulkRemoveFromDeck));
  bulkFields.addEventListener("click", () => openBulkMenu(bulkFields, fieldMenuItems(runBulk)));
  bulkMedia.addEventListener("click", () => openBulkMenu(bulkMedia, mediaMenuItems(runBulk)));
  bulkEdit.addEventListener("click", () => {
    const id = [...selected][0];
    if (id) ctx.openShard(id);
  });

  container.appendChild(root);
  applyAndRender();
  if (params.focusSearch) search.focus();
}
