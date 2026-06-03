// Quick Capture modal (Ctrl+N): fast title/prompt/language/code/tags + key-tag controls.
import { el, esc, enableTab } from "../dom.js";
import {
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

export function openQuickCapture(ctx) {
  const root = document.querySelector("#modal-root");
  if (root.querySelector(".modal-backdrop")) return; // already open

  const preset = ctx.currentPreset();
  const langs = ctx.languages();
  const langOpts = [`<option value="">(select language)</option>`]
    .concat(langs.map((l) => `<option value="${esc(l)}">${esc(l)}</option>`))
    .join("");
  const diffOpts = [`<option value="">(no difficulty)</option>`]
    .concat(DIFFICULTIES.map((d) => `<option value="${d}">${d}</option>`))
    .join("");

  // The Language field only appears for code presets.
  const languageField = preset.showLanguage
    ? `<div class="field"><label>Language</label><select id="qc-lang">${langOpts}</select></div>`
    : "";

  const backdrop = el(`
    <div class="modal-backdrop">
      <div class="modal">
        <div class="row" style="align-items:center">
          <h2 style="margin:0">Quick Capture</h2>
          <div class="spacer"></div>
          <select id="qc-template" title="Prefill from a template"><option value="">Template…</option></select>
        </div>
        <div class="field">
          <label>Title *</label>
          <input type="text" id="qc-title" placeholder="e.g., Hello world in C" />
        </div>
        <div class="field">
          <label>Prompt</label>
          <input type="text" id="qc-prompt" placeholder="Optional question text shown during testing" />
        </div>
        ${languageField}
        <div class="field">
          <label>Difficulty</label>
          <select id="qc-diff">${diffOpts}</select>
        </div>
        <div class="field">
          <label>Card type</label>
          <select id="qc-cardtype">${cardTypeOptions("basic")}</select>
        </div>
        <div class="vlist" style="margin-bottom:10px">
          <label class="chk"><input type="checkbox" id="qc-review" checked /> Add to review queue</label>
          <label class="chk"><input type="checkbox" id="qc-foundation" /> Foundation</label>
          <label class="chk"><input type="checkbox" id="qc-revealonly" /> Reveal-only</label>
        </div>
        <div class="field">
          <label>Tag(s)</label>
          <input type="text" id="qc-tags" placeholder="e.g., networking, one-liner" />
        </div>
        <div class="field">
          <label>${esc(preset.answerLabel)} *</label>
          <textarea id="qc-code" class="code-editor" style="min-height:140px" spellcheck="false" placeholder="${esc(preset.answerPlaceholder)}"></textarea>
        </div>
        <div id="qc-media-slot"></div>
        <div class="actions">
          <button class="btn btn-tool" id="qc-cancel">Cancel</button>
          <button class="btn btn-primary" id="qc-save">Save Shard</button>
        </div>
      </div>
    </div>
  `);

  enableTab(backdrop.querySelector("#qc-code"));
  const tagsInput = backdrop.querySelector("#qc-tags");
  const diffSel = backdrop.querySelector("#qc-diff");
  const foundationChk = backdrop.querySelector("#qc-foundation");
  const revealChk = backdrop.querySelector("#qc-revealonly");

  // Keep the key-tag controls and the free-form tags field in sync.
  function controlsFromField() {
    const tags = parseTags(tagsInput.value);
    diffSel.value = getDifficulty(tags);
    foundationChk.checked = isFoundation(tags);
    revealChk.checked = isRevealOnly(tags);
  }
  function applyControlToField(mutate) {
    tagsInput.value = mutate(parseTags(tagsInput.value)).join(", ");
  }
  tagsInput.addEventListener("input", controlsFromField);
  diffSel.addEventListener("change", () => applyControlToField((t) => setDifficulty(t, diffSel.value)));
  foundationChk.addEventListener("change", () =>
    applyControlToField((t) => toggleTag(t, FOUNDATION_TAG, foundationChk.checked))
  );
  revealChk.addEventListener("change", () =>
    applyControlToField((t) => toggleTag(t, REVEAL_ONLY_TAG, revealChk.checked))
  );

  // Attachments editor (images/audio) + paste-to-add.
  const media = buildMediaEditor([]);
  backdrop.querySelector("#qc-media-slot").appendChild(media.node);
  backdrop.addEventListener("paste", media.handlePaste);

  // Templates: populate the dropdown and prefill on selection.
  const cardTypeSel = backdrop.querySelector("#qc-cardtype");
  const promptInput = backdrop.querySelector("#qc-prompt");
  const codeInput = backdrop.querySelector("#qc-code");
  const langInput = backdrop.querySelector("#qc-lang"); // absent for non-code presets
  const templateSel = backdrop.querySelector("#qc-template");
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
    const dirty = promptInput.value.trim() || codeInput.value.trim() || tagsInput.value.trim();
    if (dirty && !confirm(`Apply template "${t.name}"? This overwrites the current prompt, answer, tags, and card type.`))
      return;
    promptInput.value = t.prompt || "";
    codeInput.value = t.code || "";
    if (langInput && t.language) langInput.value = t.language;
    cardTypeSel.value = t.cardType || "basic";
    tagsInput.value = t.tags || "";
    controlsFromField();
  });

  function close() {
    root.innerHTML = "";
    document.removeEventListener("keydown", onKey);
  }
  function onKey(e) {
    if (e.key === "Escape") close();
  }

  backdrop.addEventListener("mousedown", (e) => {
    if (e.target === backdrop) close();
  });
  backdrop.querySelector("#qc-cancel").addEventListener("click", close);
  backdrop.querySelector("#qc-save").addEventListener("click", async () => {
    const title = backdrop.querySelector("#qc-title").value.trim();
    const code = backdrop.querySelector("#qc-code").value;
    if (!title || !code.trim()) {
      alert("Title and answer (code) are required.");
      return;
    }
    const review = backdrop.querySelector("#qc-review").checked;
    await ctx.api.saveShard({
      id: "",
      title,
      prompt: promptInput.value.trim(),
      language: langInput ? langInput.value : "",
      code,
      description: "",
      deckId: ctx.currentDeckId(),
      cardType: cardTypeSel.value,
      tags: parseTags(tagsInput.value),
      category: "snippet",
      familiarity: "fresh",
      source: "",
      relatedIds: [],
      media: media.getItems(),
      reviewEnabled: review,
      reviewInterval: 0,
      reviewRepetitions: 0,
      reviewEase: 2.5,
      reviewNext: review ? new Date().toISOString().slice(0, 10) : "",
    });
    close();
    ctx.navigate(document.querySelector("#sidebar nav button.active")?.dataset.view || "dashboard");
  });

  root.appendChild(backdrop);
  document.addEventListener("keydown", onKey);
  backdrop.querySelector("#qc-title").focus();
}
