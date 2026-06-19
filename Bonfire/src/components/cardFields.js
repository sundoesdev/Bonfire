// Shared card-authoring fields, used by BOTH the Add modal (quickCapture.js) and
// the View/Edit modal (cardModal.js). Extracting the form here guarantees the two
// stay in the same order and likeness — change a field once, both pick it up.
import { el, esc, enableTab } from "../dom.js";
import {
  CATEGORIES,
  FAMILIARITIES,
  DIFFICULTIES,
  FOUNDATION_TAG,
  REVEAL_ONLY_TAG,
  cardTypeOptions,
  getDifficulty,
  isFoundation,
  isRevealOnly,
  setDifficulty,
  toggleTag,
} from "../constants.js";
import { buildMediaEditor } from "./mediaEditor.js";
import { loadTemplates } from "../templates.js";

const ADD_CUSTOM = "__add_custom__";

// A fresh shard with frontend defaults. New cards default INTO the review queue
// (reviewEnabled true); the caller stamps reviewNext on save. The Rust `Shard`
// Default stays false so old/partial imports are unaffected.
export function blankShard() {
  return {
    id: "",
    title: "",
    language: "",
    prompt: "",
    code: "",
    description: "",
    deckId: "",
    deckIds: [],
    cardType: "basic",
    tags: [],
    category: "snippet",
    familiarity: "fresh",
    source: "",
    relatedIds: [],
    createdAt: "",
    modifiedAt: "",
    lastReviewed: "",
    reviewEnabled: true,
    reviewInterval: 0,
    reviewRepetitions: 0,
    reviewEase: 2.5,
    reviewNext: "",
    fsrsStability: 0,
    fsrsDifficulty: 0,
    fsrsState: "new",
    lapses: 0,
    media: [],
  };
}

function parseTags(raw) {
  return [
    ...new Set(
      raw
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean)
    ),
  ];
}

const renderTags = (arr) => arr.join(", ");

// Build the canonical card form. `shard` supplies initial values (a blank shard
// for Add, the existing card for Edit). Returns { node, collect, focusTitle }.
export function buildCardFields(ctx, shard) {
  const preset = ctx.currentPreset();

  const langs = ctx.languages();
  if (shard.language && !langs.includes(shard.language)) langs.push(shard.language);
  const langOpts = [`<option value="">(none)</option>`]
    .concat(
      langs.map(
        (l) => `<option value="${esc(l)}" ${l === shard.language ? "selected" : ""}>${esc(l)}</option>`
      )
    )
    .concat(`<option value="${ADD_CUSTOM}">+ Add custom language…</option>`)
    .join("");
  const catOpts = CATEGORIES.map(
    (c) => `<option value="${c}" ${c === shard.category ? "selected" : ""}>${c}</option>`
  ).join("");
  const famOpts = FAMILIARITIES.map(
    (f) => `<option value="${f}" ${f === shard.familiarity ? "selected" : ""}>${f}</option>`
  ).join("");
  // Difficulty is mandatory (item 2) — no "(none)" option; blank cards default to
  // the first level (beginner) below.
  const diffOpts = DIFFICULTIES.map((d) => `<option value="${d}">${d}</option>`).join("");

  // The Language row only exists for code presets (the deck preset gates it).
  const languageField = preset.showLanguage
    ? `<label>Language</label><select id="cf-lang">${langOpts}</select>`
    : "";

  const node = el(`
    <div class="card-fields">
      <div class="row" style="margin-bottom:12px">
        <select id="cf-template" title="Prefill every field from a saved template"><option value="">Start from a template…</option></select>
        <span class="muted">(optional)</span>
      </div>

      <!-- Section A: the fast-fill core — Title → Prompt → Answer. -->
      <div class="form-grid">
        <label>Title *</label>
        <input type="text" id="cf-title" placeholder="Short label or the question, e.g. 'Hello world in C'" value="${esc(shard.title)}" />
        <label>Prompt</label>
        <textarea id="cf-prompt" style="min-height:48px" placeholder="Optional: the full task shown during testing">${esc(shard.prompt)}</textarea>
      </div>
      <div class="section-title">${esc(preset.answerLabel)} *</div>
      <div class="muted" id="cf-cardtype-hint" style="margin-bottom:6px;display:none">For cloze cards, wrap the words to hide in <code>{{c1::double braces}}</code>. They'll be blanked out during study.</div>
      <textarea class="code-editor" id="cf-code" spellcheck="false" placeholder="${esc(preset.answerPlaceholder)}">${esc(shard.code)}</textarea>

      <!-- Section B: classification & metadata. -->
      <div class="form-grid" style="margin-top:14px">
        ${languageField}
        <label>Card type</label>
        <select id="cf-cardtype">${cardTypeOptions(shard.cardType)}</select>
        <label>Category</label>
        <select id="cf-cat">${catOpts}</select>
        <label>Familiarity</label>
        <select id="cf-fam">${famOpts}</select>
        <label>Difficulty *</label>
        <select id="cf-diff">${diffOpts}</select>
        <label>Flags</label>
        <div class="vlist">
          <label class="chk"><input type="checkbox" id="cf-foundation" /> Foundation (critical must-know)</label>
          <label class="chk"><input type="checkbox" id="cf-revealonly" /> Reveal-only (no typing — classic flip card)</label>
        </div>
        <label>Source</label>
        <input type="text" id="cf-source" placeholder="URL, book, man page…" value="${esc(shard.source)}" />
        <label>Tags</label>
        <input type="text" id="cf-tags" placeholder="Comma-separated: networking, advanced, foundation" value="${esc(renderTags(shard.tags || []))}" />
      </div>
      <div class="section-title" style="margin-top:12px">Description</div>
      <textarea id="cf-desc" style="width:100%;min-height:80px" placeholder="Why does this work? When would you use it? (markdown-lite: **bold**, *italic*, \`code\`)">${esc(shard.description)}</textarea>
      <div id="cf-media-slot"></div>
    </div>
  `);

  // ---- Attachments editor (images/audio) + paste-to-add ----
  const media = buildMediaEditor(shard.media || []);
  node.querySelector("#cf-media-slot").appendChild(media.node);
  node.addEventListener("paste", media.handlePaste);

  enableTab(node.querySelector("#cf-code"));
  const langSel = node.querySelector("#cf-lang"); // null for non-code presets
  if (langSel) langSel.value = shard.language;
  const tagsInput = node.querySelector("#cf-tags");
  const diffSel = node.querySelector("#cf-diff");
  const foundationChk = node.querySelector("#cf-foundation");
  const revealChk = node.querySelector("#cf-revealonly");
  const cardTypeSel = node.querySelector("#cf-cardtype");

  // ---- Two-way sync between the tag controls and the free-form tags field ----
  function controlsFromField() {
    const tags = parseTags(tagsInput.value);
    // Difficulty is mandatory — the dropdown always shows a valid level (defaulting
    // to the first, "beginner"), even if the free-form tags don't list one yet.
    diffSel.value = getDifficulty(tags) || DIFFICULTIES[0];
    foundationChk.checked = isFoundation(tags);
    revealChk.checked = isRevealOnly(tags);
  }
  function applyControlToField(mutate) {
    tagsInput.value = renderTags(mutate(parseTags(tagsInput.value)));
  }
  controlsFromField();
  tagsInput.addEventListener("input", controlsFromField);
  diffSel.addEventListener("change", () => applyControlToField((t) => setDifficulty(t, diffSel.value)));
  foundationChk.addEventListener("change", () =>
    applyControlToField((t) => toggleTag(t, FOUNDATION_TAG, foundationChk.checked))
  );
  revealChk.addEventListener("change", () =>
    applyControlToField((t) => toggleTag(t, REVEAL_ONLY_TAG, revealChk.checked))
  );

  // ---- Custom language ("+ Add custom language…") ----
  if (langSel) {
    langSel.addEventListener("change", async () => {
      if (langSel.value === ADD_CUSTOM) {
        const name = prompt("New language name:");
        if (name && name.trim()) {
          await ctx.api.addCustomLanguage(name.trim());
          const o = document.createElement("option");
          o.value = name.trim();
          o.textContent = name.trim();
          langSel.insertBefore(o, langSel.querySelector(`option[value="${ADD_CUSTOM}"]`));
          langSel.value = name.trim();
        } else {
          langSel.value = shard.language;
        }
      }
    });
  }

  // ---- Cloze hint shows only for the cloze card type ----
  const cardTypeHint = node.querySelector("#cf-cardtype-hint");
  const syncCardTypeHint = () => {
    cardTypeHint.style.display = cardTypeSel.value === "cloze" ? "block" : "none";
  };
  cardTypeSel.addEventListener("change", syncCardTypeHint);
  syncCardTypeHint();

  // ---- Templates: populate the dropdown and prefill fields on selection ----
  const templateSel = node.querySelector("#cf-template");
  const promptEl = node.querySelector("#cf-prompt");
  const codeEl = node.querySelector("#cf-code");
  const descEl = node.querySelector("#cf-desc");
  let templates = [];
  loadTemplates(ctx).then((list) => {
    templates = list;
    for (const t of list) {
      const o = document.createElement("option");
      o.value = t.id;
      o.textContent = t.name;
      templateSel.appendChild(o);
    }
  });
  templateSel.addEventListener("change", () => {
    const t = templates.find((x) => x.id === templateSel.value);
    templateSel.value = "";
    if (!t) return;
    const dirty = promptEl.value.trim() || codeEl.value.trim() || tagsInput.value.trim();
    if (dirty && !confirm(`Apply template "${t.name}"? This overwrites the current prompt, answer, tags, and card type.`))
      return;
    promptEl.value = t.prompt || "";
    codeEl.value = t.code || "";
    descEl.value = t.description || "";
    if (langSel && t.language) langSel.value = t.language;
    cardTypeSel.value = t.cardType || "basic";
    tagsInput.value = t.tags || "";
    controlsFromField();
    syncCardTypeHint();
  });

  function collect() {
    // Guarantee a difficulty tag (mandatory, item 2): if the free-form tags don't
    // carry one, stamp in the dropdown's selected level (defaulting to beginner).
    let tags = parseTags(tagsInput.value);
    if (!getDifficulty(tags)) tags = setDifficulty(tags, diffSel.value || DIFFICULTIES[0]);
    return {
      title: node.querySelector("#cf-title").value.trim(),
      prompt: promptEl.value.trim(),
      language: langSel ? (langSel.value === ADD_CUSTOM ? shard.language : langSel.value) : shard.language || "",
      cardType: cardTypeSel.value,
      category: node.querySelector("#cf-cat").value,
      familiarity: node.querySelector("#cf-fam").value,
      source: node.querySelector("#cf-source").value.trim(),
      tags,
      code: codeEl.value,
      description: descEl.value,
      media: media.getItems(),
    };
  }

  function focusTitle() {
    node.querySelector("#cf-title").focus();
  }

  return { node, collect, focusTitle };
}
