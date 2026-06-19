// Bulk actions for multi-selected cards (item 1), shared by the Library and
// Dashboard. Each action takes the selected ids, does its work via the bulk
// backend commands, and resolves true on success / false if cancelled.
import { el, esc } from "../dom.js";
import { confirmDialog } from "./confirm.js";
import {
  CARD_TYPES,
  CATEGORIES,
  FAMILIARITIES,
  DIFFICULTIES,
  FOUNDATION_TAG,
  REVEAL_ONLY_TAG,
  setDifficulty,
  toggleTag,
} from "../constants.js";

// Modal to pick an existing deck (and, when allowNew, create one on the fly).
// Resolves a deck id, or null on cancel.
function chooseDeck(ctx, { title, allowNew = false }) {
  return new Promise((resolve) => {
    const opts = ctx
      .decks()
      .map((d) => `<option value="${esc(d.id)}">${esc(d.name) || "(unnamed)"}</option>`)
      .join("");
    const backdrop = el(`
      <div class="modal-backdrop confirm-backdrop">
        <div class="modal modal-confirm">
          <h2>${esc(title)}</h2>
          <div class="field"><label>Deck</label><select id="bd-deck">${opts}</select></div>
          ${
            allowNew
              ? `<div class="field"><label>…or create a new deck</label><input type="text" id="bd-new" placeholder="New deck name (optional)" /></div>`
              : ""
          }
          <div class="actions">
            <button class="btn btn-secondary" id="bd-cancel">Cancel</button>
            <button class="btn btn-primary" id="bd-ok">OK</button>
          </div>
        </div>
      </div>
    `);
    function done(v) {
      backdrop.remove();
      document.removeEventListener("keydown", onKey, true);
      resolve(v);
    }
    function onKey(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        done(null);
      }
    }
    backdrop.querySelector("#bd-cancel").addEventListener("click", () => done(null));
    backdrop.addEventListener("mousedown", (e) => {
      if (e.target === backdrop) done(null);
    });
    backdrop.querySelector("#bd-ok").addEventListener("click", async () => {
      const newName = allowNew ? backdrop.querySelector("#bd-new").value.trim() : "";
      if (newName) {
        const deck = await ctx.api.saveDeck({ name: newName, preset: "prose" });
        done(deck.id);
      } else {
        done(backdrop.querySelector("#bd-deck").value || null);
      }
    });
    document.body.appendChild(backdrop);
    document.addEventListener("keydown", onKey, true);
  });
}

export async function bulkDelete(ctx, ids) {
  const ok = await confirmDialog({
    title: `Delete ${ids.length} card${ids.length === 1 ? "" : "s"}?`,
    message: "This permanently deletes the selected cards. It cannot be undone.",
    confirmLabel: "Delete",
    confirmClass: "btn-danger",
  });
  if (!ok) return false;
  await ctx.api.deleteShards(ids);
  ctx.toast(`Deleted ${ids.length} card${ids.length === 1 ? "" : "s"}`);
  return true;
}

export async function bulkAddToDeck(ctx, ids) {
  const deckId = await chooseDeck(ctx, { title: `Add ${ids.length} card(s) to deck`, allowNew: true });
  if (!deckId) return false;
  await ctx.api.addCardsToDeck(ids, deckId);
  ctx.toast("Added to deck");
  return true;
}

export async function bulkRemoveFromDeck(ctx, ids) {
  const deckId = await chooseDeck(ctx, { title: `Remove ${ids.length} card(s) from a deck`, allowNew: false });
  if (!deckId) return false;
  await ctx.api.removeCardsFromDeck(ids, deckId);
  ctx.toast("Removed from deck");
  return true;
}

export async function bulkRetag(ctx, ids) {
  const raw = prompt(
    "Set tags for the selected cards (comma-separated). This REPLACES their current tags:"
  );
  if (raw === null) return false;
  const tags = raw
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  await ctx.api.retagShards(ids, tags);
  ctx.toast("Tags updated");
  return true;
}

// ---- Expanded bulk field edits (item 6, notes-03) ----
// These apply a single field change to many cards. They run frontend-side: load
// each selected card from state, mutate one field (scalar fields directly; tag-
// derived fields via the constants helpers so each card keeps its other tags),
// then persist with the existing save_shard command. No new backend command.

// Apply `mutate(shardCopy) -> shardCopy` to every selected card and save it.
async function applyToShards(ctx, ids, mutate) {
  const byId = new Map(ctx.state.allShards.map((s) => [s.id, s]));
  const tasks = [];
  for (const id of ids) {
    const s = byId.get(id);
    if (!s) continue;
    tasks.push(ctx.api.saveShard(mutate({ ...s })));
  }
  await Promise.all(tasks);
}

// Modal value-picker (mirrors chooseDeck). `options` is [{value,label}]. Resolves
// the chosen value (which may be ""), or null on cancel.
function chooseValue(ctx, { title, label, options }) {
  return new Promise((resolve) => {
    const opts = options
      .map((o) => `<option value="${esc(o.value)}">${esc(o.label)}</option>`)
      .join("");
    const backdrop = el(`
      <div class="modal-backdrop confirm-backdrop">
        <div class="modal modal-confirm">
          <h2>${esc(title)}</h2>
          <div class="field"><label>${esc(label)}</label><select id="cv-sel">${opts}</select></div>
          <div class="actions">
            <button class="btn btn-secondary" id="cv-cancel">Cancel</button>
            <button class="btn btn-primary" id="cv-ok">OK</button>
          </div>
        </div>
      </div>
    `);
    function done(v) {
      backdrop.remove();
      document.removeEventListener("keydown", onKey, true);
      resolve(v);
    }
    function onKey(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        done(null);
      }
    }
    backdrop.querySelector("#cv-cancel").addEventListener("click", () => done(null));
    backdrop.addEventListener("mousedown", (e) => {
      if (e.target === backdrop) done(null);
    });
    backdrop.querySelector("#cv-ok").addEventListener("click", () => {
      done(backdrop.querySelector("#cv-sel").value);
    });
    document.body.appendChild(backdrop);
    document.addEventListener("keydown", onKey, true);
  });
}

const N = (ids) => `${ids.length} card${ids.length === 1 ? "" : "s"}`;

export async function bulkSetLanguage(ctx, ids) {
  const langs = ctx.languages();
  const v = await chooseValue(ctx, {
    title: `Set language for ${N(ids)}`,
    label: "Language",
    options: [{ value: "", label: "(none)" }, ...langs.map((l) => ({ value: l, label: l }))],
  });
  if (v === null) return false;
  await applyToShards(ctx, ids, (s) => ({ ...s, language: v }));
  ctx.toast("Language updated");
  return true;
}

export async function bulkSetCardType(ctx, ids) {
  const v = await chooseValue(ctx, {
    title: `Set card type for ${N(ids)}`,
    label: "Card type",
    options: CARD_TYPES.map((t) => ({ value: t.id, label: t.label })),
  });
  if (v === null) return false;
  await applyToShards(ctx, ids, (s) => ({ ...s, cardType: v }));
  ctx.toast("Card type updated");
  return true;
}

export async function bulkSetCategory(ctx, ids) {
  const v = await chooseValue(ctx, {
    title: `Set category for ${N(ids)}`,
    label: "Category",
    options: CATEGORIES.map((c) => ({ value: c, label: c })),
  });
  if (v === null) return false;
  await applyToShards(ctx, ids, (s) => ({ ...s, category: v }));
  ctx.toast("Category updated");
  return true;
}

export async function bulkSetFamiliarity(ctx, ids) {
  const v = await chooseValue(ctx, {
    title: `Set familiarity for ${N(ids)}`,
    label: "Familiarity",
    options: FAMILIARITIES.map((f) => ({ value: f, label: f })),
  });
  if (v === null) return false;
  await applyToShards(ctx, ids, (s) => ({ ...s, familiarity: v }));
  ctx.toast("Familiarity updated");
  return true;
}

export async function bulkSetDifficulty(ctx, ids) {
  const v = await chooseValue(ctx, {
    title: `Set difficulty for ${N(ids)}`,
    label: "Difficulty",
    options: DIFFICULTIES.map((d) => ({ value: d, label: d })),
  });
  if (v === null) return false;
  // Difficulty lives in the tags as a keyword; setDifficulty swaps any existing one.
  await applyToShards(ctx, ids, (s) => ({ ...s, tags: setDifficulty(s.tags, v) }));
  ctx.toast("Difficulty updated");
  return true;
}

export async function bulkSetFoundation(ctx, ids) {
  const v = await chooseValue(ctx, {
    title: `Foundation flag for ${N(ids)}`,
    label: "Foundation",
    options: [
      { value: "on", label: "Mark as foundation" },
      { value: "off", label: "Remove foundation" },
    ],
  });
  if (v === null) return false;
  await applyToShards(ctx, ids, (s) => ({ ...s, tags: toggleTag(s.tags, FOUNDATION_TAG, v === "on") }));
  ctx.toast("Foundation flag updated");
  return true;
}

export async function bulkSetRevealOnly(ctx, ids) {
  const v = await chooseValue(ctx, {
    title: `Reveal-only for ${N(ids)}`,
    label: "Reveal-only",
    options: [
      { value: "on", label: "Mark as reveal-only" },
      { value: "off", label: "Remove reveal-only" },
    ],
  });
  if (v === null) return false;
  await applyToShards(ctx, ids, (s) => ({ ...s, tags: toggleTag(s.tags, REVEAL_ONLY_TAG, v === "on") }));
  ctx.toast("Reveal-only flag updated");
  return true;
}

export async function bulkSetSource(ctx, ids) {
  const raw = prompt(
    `Set source for ${N(ids)} (URL, book, man page…). This REPLACES the current source:`
  );
  if (raw === null) return false;
  const source = raw.trim();
  await applyToShards(ctx, ids, (s) => ({ ...s, source }));
  ctx.toast("Source updated");
  return true;
}

// ---- Bulk media: attach one file (image/audio) to every selected card ----
let mediaSeq = 0;
const mediaId = () => `m${Date.now().toString(36)}${(mediaSeq++).toString(36)}`;

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

// Open a native file picker; resolves the chosen File, or null if none chosen.
function pickFile(accept) {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.addEventListener("change", () => resolve(input.files[0] || null), { once: true });
    input.click();
  });
}

async function bulkAddMedia(ctx, ids, kind, accept) {
  const file = await pickFile(accept);
  if (!file) return false;
  const dataUrl = await fileToDataUrl(file);
  await applyToShards(ctx, ids, (s) => ({
    ...s,
    media: [...(s.media || []), { id: mediaId(), kind, dataUrl, caption: "", side: "answer" }],
  }));
  ctx.toast(`${kind === "image" ? "Image" : "Audio"} added to ${N(ids)}`);
  return true;
}

export const bulkAddImage = (ctx, ids) => bulkAddMedia(ctx, ids, "image", "image/*");
export const bulkAddAudio = (ctx, ids) => bulkAddMedia(ctx, ids, "audio", "audio/*");

// ---- Compact dropdown menu anchored to a trigger button (item 6) ----
// `items` is [{label, run}] (or {divider:true}). Closes on outside click / Escape.
export function openBulkMenu(triggerBtn, items) {
  document.querySelectorAll(".bulk-menu").forEach((m) => m.remove());
  const menu = el('<div class="bulk-menu"></div>');
  items.forEach((it) => {
    if (it.divider) {
      menu.appendChild(el('<div class="bulk-menu-sep"></div>'));
      return;
    }
    const b = el(`<button type="button" class="bulk-menu-item">${esc(it.label)}</button>`);
    b.addEventListener("click", () => {
      close();
      it.run();
    });
    menu.appendChild(b);
  });
  function close() {
    menu.remove();
    document.removeEventListener("mousedown", onDoc, true);
    document.removeEventListener("keydown", onKey, true);
  }
  function onDoc(e) {
    if (!menu.contains(e.target) && e.target !== triggerBtn) close();
  }
  function onKey(e) {
    if (e.key === "Escape") close();
  }
  document.body.appendChild(menu);
  // Position under the trigger (fixed, so it floats above the sticky toolbar).
  const rect = triggerBtn.getBoundingClientRect();
  menu.style.top = `${rect.bottom + 4}px`;
  // Keep the menu on-screen if the trigger is near the right edge.
  const left = Math.min(rect.left, window.innerWidth - menu.offsetWidth - 8);
  menu.style.left = `${Math.max(8, left)}px`;
  document.addEventListener("mousedown", onDoc, true);
  document.addEventListener("keydown", onKey, true);
}

// The shared "Edit field ▾" menu item set, wired to a `runBulk(fn)` dispatcher so
// both Library and Dashboard get identical options.
export function fieldMenuItems(runBulk) {
  return [
    { label: "Language…", run: () => runBulk(bulkSetLanguage) },
    { label: "Card type…", run: () => runBulk(bulkSetCardType) },
    { label: "Category…", run: () => runBulk(bulkSetCategory) },
    { label: "Familiarity…", run: () => runBulk(bulkSetFamiliarity) },
    { label: "Difficulty…", run: () => runBulk(bulkSetDifficulty) },
    { label: "Foundation flag…", run: () => runBulk(bulkSetFoundation) },
    { label: "Reveal-only flag…", run: () => runBulk(bulkSetRevealOnly) },
    { label: "Source…", run: () => runBulk(bulkSetSource) },
    { label: "Tags (replace)…", run: () => runBulk(bulkRetag) },
  ];
}

export function mediaMenuItems(runBulk) {
  return [
    { label: "Add image…", run: () => runBulk(bulkAddImage) },
    { label: "Add audio…", run: () => runBulk(bulkAddAudio) },
  ];
}
