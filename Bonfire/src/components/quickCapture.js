// Add New Shard modal (the one and only card-creation UI; opened by "New Shard"
// and Ctrl+N). Uses the shared cardFields builder so it stays identical in order
// and look to the View/Edit modal (cardModal.js). All new cards default into the
// review queue — there is no opt-out here.
//
// To make rapid-firing similar cards fast, the card's *classification* (type,
// category, familiarity, language, source, tags — which also carry the difficulty/
// foundation/reveal keyword tags) is remembered between adds in the `card_add_defaults`
// setting and pre-seeded into the next blank form. Only the content fields
// (title/prompt/answer/description/attachments) reset each time.
import { el } from "../dom.js";
import { ALL_DECKS, DEFAULT_DECK_ID } from "../constants.js";
import { buildCardFields, blankShard } from "./cardFields.js";
import { confirmDialog } from "./confirm.js";

const DEFAULTS_KEY = "card_add_defaults";
// Fields carried over to the next new card (everything except the content fields).
const REMEMBERED = ["cardType", "category", "familiarity", "language", "source", "tags"];

async function loadDefaults(ctx) {
  try {
    const raw = await ctx.api.getSetting(DEFAULTS_KEY);
    if (raw) {
      const obj = JSON.parse(raw);
      if (obj && typeof obj === "object") return obj;
    }
  } catch (_e) {
    /* ignore missing/invalid */
  }
  return {};
}

function persistDefaults(ctx, data) {
  const picked = {};
  for (const k of REMEMBERED) picked[k] = data[k];
  ctx.api.setSetting(DEFAULTS_KEY, JSON.stringify(picked));
}

export async function openQuickCapture(ctx) {
  const root = document.querySelector("#modal-root");
  if (root.querySelector(".modal-backdrop")) return; // already open

  const defaults = await loadDefaults(ctx);
  // Seed last-used classification; content fields stay blank (from blankShard()).
  // New cards join the current deck; if the library is on "All decks" (no deck
  // context), they land in the Default deck (the user can re-file them after).
  const cur = ctx.currentDeckId();
  const deckIds = [cur && cur !== ALL_DECKS ? cur : DEFAULT_DECK_ID];
  const shard = { ...blankShard(), ...defaults, deckIds };
  const fields = buildCardFields(ctx, shard);

  const backdrop = el(`
    <div class="modal-backdrop">
      <div class="modal modal-card">
        <h2>Add New Shard</h2>
        <div class="muted" style="margin-bottom:10px">Your last card's type, category, tags, language &amp; source carry over to the next new card — only the title, prompt, answer, description &amp; attachments reset. Great for adding similar cards quickly.</div>
        <div id="qc-fields-slot"></div>
        <div class="actions">
          <button class="btn btn-secondary" id="qc-cancel">Cancel</button>
          <button class="btn btn-primary" id="qc-save">Save Shard</button>
        </div>
      </div>
    </div>
  `);
  backdrop.querySelector("#qc-fields-slot").appendChild(fields.node);

  // Track whether the user has typed anything, so an accidental click-outside on a
  // dirty form asks before discarding (item 8) but an untouched form closes freely.
  let dirty = false;
  fields.node.addEventListener("input", () => { dirty = true; });
  fields.node.addEventListener("change", () => { dirty = true; });

  function close() {
    root.innerHTML = "";
    document.removeEventListener("keydown", onKey);
  }
  // Guarded close: confirm before discarding unsaved work (item 8).
  async function tryClose() {
    if (!dirty) {
      close();
      return;
    }
    const ok = await confirmDialog({
      title: "Discard this card?",
      message: "Your unsaved changes will be lost.",
      confirmLabel: "Discard",
      confirmClass: "btn-danger",
      cancelLabel: "Keep editing",
    });
    if (ok) close();
  }
  async function save() {
    const data = fields.collect();
    if (!data.title || !data.code.trim()) {
      alert("Title and answer are required.");
      return;
    }
    await ctx.api.saveShard({
      ...shard,
      ...data,
      // New cards always enter the review queue, due today.
      reviewEnabled: true,
      reviewNext: new Date().toISOString().slice(0, 10),
    });
    // Remember this card's classification for the next add.
    persistDefaults(ctx, data);
    close();
    ctx.navigate(document.querySelector("#sidebar nav button.active")?.dataset.view || "dashboard");
  }
  function onKey(e) {
    if (e.key === "Escape") tryClose();
    else if (e.ctrlKey && e.key === "Enter") {
      e.preventDefault();
      save();
    }
  }
  backdrop.addEventListener("mousedown", (e) => {
    if (e.target === backdrop) tryClose();
  });
  backdrop.querySelector("#qc-cancel").addEventListener("click", close);
  backdrop.querySelector("#qc-save").addEventListener("click", save);

  root.appendChild(backdrop);
  document.addEventListener("keydown", onKey);
  fields.focusTitle();
}
