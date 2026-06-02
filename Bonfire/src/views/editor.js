// Shard editor: read-only View mode and a form-based Edit mode.
import { el, esc, metaBadges, enableTab } from "../dom.js";
import {
  CATEGORIES,
  FAMILIARITIES,
  DIFFICULTIES,
  REVEAL_ONLY_TAG,
  FOUNDATION_TAG,
  getDifficulty,
  isFoundation,
  isRevealOnly,
  setDifficulty,
  toggleTag,
} from "../constants.js";
import { highlightInto } from "../highlight.js";

const ADD_CUSTOM = "__add_custom__";

function blankShard() {
  return {
    id: "",
    title: "",
    language: "",
    prompt: "",
    code: "",
    description: "",
    deckId: "",
    tags: [],
    category: "snippet",
    familiarity: "fresh",
    source: "",
    relatedIds: [],
    createdAt: "",
    modifiedAt: "",
    lastReviewed: "",
    reviewEnabled: false,
    reviewInterval: 0,
    reviewRepetitions: 0,
    reviewEase: 2.5,
    reviewNext: "",
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

export function renderEditor(container, ctx, params = {}) {
  const isNew = !params.id;
  const shard = isNew
    ? blankShard()
    : { ...blankShard(), ...ctx.state.shards.find((s) => s.id === params.id) };
  if (isNew) shard.deckId = ctx.currentDeckId();

  // The active deck's preset gates code-only fields and relabels the answer.
  const preset = ctx.currentPreset();

  let mode = isNew ? "edit" : "view";

  function render() {
    container.innerHTML = "";
    container.appendChild(mode === "view" ? viewMode() : editMode());
  }

  // ---- View mode ----
  function viewMode() {
    const meta = [shard.language, shard.category, shard.familiarity].filter(Boolean).join(" · ");
    const root = el(`
      <div>
        <div class="toolbar">
          <button class="btn btn-tool" id="back">← Back</button>
          <div class="spacer"></div>
          <button class="btn btn-tool" id="review">Review</button>
          ${shard.reviewEnabled ? '<button class="btn btn-tool" id="mark">Mark Reviewed</button>' : ""}
          <button class="btn btn-danger" id="del">Delete</button>
          <button class="btn btn-tool" id="edit">Edit</button>
        </div>
        <div class="title-big">${esc(shard.title) || "(untitled)"}</div>
        ${shard.prompt ? `<div class="desc" style="margin-bottom:8px">${esc(shard.prompt)}</div>` : ""}
        <div class="meta-line">${esc(meta)} ${metaBadges(shard.tags)}${
          shard.reviewEnabled && shard.reviewNext ? " · Review: " + esc(shard.reviewNext) : ""
        }</div>
        <pre class="code-block"><code id="code"></code></pre>
        ${
          shard.description
            ? `<div class="section-title">Description</div><div class="desc">${esc(shard.description)}</div>`
            : ""
        }
        ${shard.source ? `<div class="muted" style="margin-top:10px">Source: ${esc(shard.source)}</div>` : ""}
        ${
          (shard.tags || []).length
            ? `<div class="muted" style="margin-top:6px">${shard.tags.map((t) => "#" + esc(t)).join("  ")}</div>`
            : ""
        }
      </div>
    `);

    const codeEl = root.querySelector("#code");
    if (preset.highlight) {
      highlightInto(codeEl, shard.code, shard.language);
    } else {
      codeEl.textContent = shard.code; // non-code decks: render the answer as plain text
    }

    root.querySelector("#back").addEventListener("click", () => ctx.navigate("library"));
    root.querySelector("#review").addEventListener("click", () => ctx.reviewCard(shard.id));
    root.querySelector("#edit").addEventListener("click", () => {
      mode = "edit";
      render();
    });
    root.querySelector("#del").addEventListener("click", async () => {
      if (confirm("Delete this shard?")) {
        await ctx.api.deleteShard(shard.id);
        ctx.navigate("library");
      }
    });
    const mark = root.querySelector("#mark");
    if (mark) {
      mark.addEventListener("click", async () => {
        await ctx.api.markReviewed(shard.id);
        ctx.navigate("editor", { id: shard.id });
      });
    }
    return root;
  }

  // ---- Edit mode ----
  function editMode() {
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
    const diffOpts = [`<option value="">(none)</option>`]
      .concat(DIFFICULTIES.map((d) => `<option value="${d}">${d}</option>`))
      .join("");

    // The Language field only appears for code presets.
    const languageField = preset.showLanguage
      ? `<label>Language</label>\n          <select id="f-lang">${langOpts}</select>`
      : "";

    const root = el(`
      <div>
        <div class="toolbar">
          <button class="btn btn-tool" id="back">← Back</button>
          <div class="spacer"></div>
          <button class="btn btn-tool" id="cancel">Cancel</button>
          <button class="btn btn-primary" id="save">Save</button>
        </div>
        <div class="form-grid">
          <label>Title *</label>
          <input type="text" id="f-title" placeholder="Short label or the question, e.g. 'Hello world in C'" value="${esc(shard.title)}" />
          <label>Prompt</label>
          <textarea id="f-prompt" style="min-height:48px" placeholder="Optional: the full task shown during testing">${esc(shard.prompt)}</textarea>
          ${languageField}
          <label>Category</label>
          <select id="f-cat">${catOpts}</select>
          <label>Familiarity</label>
          <select id="f-fam">${famOpts}</select>
          <label>Difficulty</label>
          <select id="f-diff">${diffOpts}</select>
          <label>Flags</label>
          <div class="vlist">
            <label class="chk"><input type="checkbox" id="f-foundation" /> Foundation</label>
            <label class="chk"><input type="checkbox" id="f-revealonly" /> Reveal-only (no typing)</label>
          </div>
          <label>Source</label>
          <input type="text" id="f-source" placeholder="URL, book, man page…" value="${esc(shard.source)}" />
          <label>Tags</label>
          <input type="text" id="f-tags" placeholder="Comma-separated: networking, advanced, foundation" value="${esc(renderTags(shard.tags || []))}" />
          <label>Review</label>
          <button type="button" class="btn btn-toggle ${shard.reviewEnabled ? "on" : ""}" id="f-review">Enable Spaced Repetition</button>
        </div>
        <div class="section-title">${esc(preset.answerLabel)} *</div>
        <textarea class="code-editor" id="f-code" spellcheck="false" placeholder="${esc(preset.answerPlaceholder)}">${esc(shard.code)}</textarea>
        <div class="section-title" style="margin-top:12px">Description</div>
        <textarea id="f-desc" style="width:100%;min-height:80px" placeholder="Why does this work? When would you use it?">${esc(shard.description)}</textarea>
      </div>
    `);

    enableTab(root.querySelector("#f-code"));
    const langSel = root.querySelector("#f-lang"); // null for non-code presets
    if (langSel) langSel.value = shard.language;
    const tagsInput = root.querySelector("#f-tags");
    const diffSel = root.querySelector("#f-diff");
    const foundationChk = root.querySelector("#f-foundation");
    const revealChk = root.querySelector("#f-revealonly");
    let reviewEnabled = shard.reviewEnabled;
    const reviewBtn = root.querySelector("#f-review");

    // ---- Two-way sync between the tag controls and the free-form tags field ----
    function controlsFromField() {
      const tags = parseTags(tagsInput.value);
      diffSel.value = getDifficulty(tags);
      foundationChk.checked = isFoundation(tags);
      revealChk.checked = isRevealOnly(tags);
    }
    function applyControlToField(mutate) {
      let tags = parseTags(tagsInput.value);
      tags = mutate(tags);
      tagsInput.value = renderTags(tags);
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

    reviewBtn.addEventListener("click", () => {
      reviewEnabled = !reviewEnabled;
      reviewBtn.classList.toggle("on", reviewEnabled);
    });

    root.querySelector("#back").addEventListener("click", () => ctx.navigate("library"));
    root.querySelector("#cancel").addEventListener("click", () => {
      if (isNew) {
        ctx.navigate("library");
      } else {
        mode = "view";
        render();
      }
    });

    root.querySelector("#save").addEventListener("click", async () => {
      const title = root.querySelector("#f-title").value.trim();
      const code = root.querySelector("#f-code").value;
      if (!title) {
        alert("Title is required.");
        return;
      }
      if (!code.trim()) {
        alert("Answer (code) is required.");
        return;
      }
      const wasEnabled = shard.reviewEnabled;
      const updated = {
        ...shard,
        title,
        prompt: root.querySelector("#f-prompt").value.trim(),
        language: langSel ? (langSel.value === ADD_CUSTOM ? shard.language : langSel.value) : shard.language,
        category: root.querySelector("#f-cat").value,
        familiarity: root.querySelector("#f-fam").value,
        source: root.querySelector("#f-source").value.trim(),
        tags: parseTags(tagsInput.value),
        code,
        description: root.querySelector("#f-desc").value,
        reviewEnabled,
      };
      if (reviewEnabled && !wasEnabled && !updated.reviewNext) {
        updated.reviewNext = new Date().toISOString().slice(0, 10);
      }
      const saved = await ctx.api.saveShard(updated);
      ctx.navigate("editor", { id: saved.id });
    });

    return root;
  }

  render();
}
