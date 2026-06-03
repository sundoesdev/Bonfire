// Shard editor: read-only View mode and a form-based Edit mode.
import { el, esc, metaBadges, enableTab } from "../dom.js";
import {
  CATEGORIES,
  FAMILIARITIES,
  DIFFICULTIES,
  REVEAL_ONLY_TAG,
  FOUNDATION_TAG,
  cardTypeOptions,
  getDifficulty,
  isFoundation,
  isRevealOnly,
  setDifficulty,
  toggleTag,
} from "../constants.js";
import { highlightInto } from "../highlight.js";
import { mdLite } from "../markdown.js";
import { buildMediaEditor } from "../components/mediaEditor.js";
import { loadTemplates } from "../templates.js";

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

// Read-only attachments markup for View mode, grouped by side.
function mediaViewHtml(media) {
  if (!media || !media.length) return "";
  const block = (side, title) => {
    const its = media.filter((m) => (m.side || "question") === side);
    if (!its.length) return "";
    const cells = its
      .map((m) => {
        const cap = m.caption ? `<div class="muted media-cap">${mdLite(m.caption)}</div>` : "";
        const el =
          m.kind === "image"
            ? `<img class="study-image" src="${esc(m.dataUrl)}" alt="${esc(m.caption || "image")}" />`
            : `<audio controls src="${esc(m.dataUrl)}"></audio>`;
        return `<div class="media-view-item">${el}${cap}</div>`;
      })
      .join("");
    return `<div class="section-title" style="margin-top:12px">${title}</div><div class="media-view">${cells}</div>`;
  };
  return block("question", "Attachments (question)") + block("answer", "Attachments (answer)");
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
        ${shard.prompt ? `<div class="desc markdown-body" style="margin-bottom:8px">${mdLite(shard.prompt)}</div>` : ""}
        <div class="meta-line">${esc(meta)} ${metaBadges(shard.tags)}${
          shard.reviewEnabled && shard.reviewNext ? " · Review: " + esc(shard.reviewNext) : ""
        }</div>
        <pre class="code-block"><code id="code"></code></pre>
        ${
          shard.description
            ? `<div class="section-title">Description</div><div class="desc markdown-body">${mdLite(shard.description)}</div>`
            : ""
        }
        ${mediaViewHtml(shard.media)}
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
          <select id="f-template" title="Prefill from a template"><option value="">Template…</option></select>
          <button class="btn btn-tool" id="cancel">Cancel</button>
          <button class="btn btn-primary" id="save">Save</button>
        </div>
        <div class="form-grid">
          <label>Title *</label>
          <input type="text" id="f-title" placeholder="Short label or the question, e.g. 'Hello world in C'" value="${esc(shard.title)}" />
          <label>Prompt</label>
          <textarea id="f-prompt" style="min-height:48px" placeholder="Optional: the full task shown during testing">${esc(shard.prompt)}</textarea>
          ${languageField}
          <label>Card type</label>
          <select id="f-cardtype">${cardTypeOptions(shard.cardType)}</select>
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
          <button type="button" class="btn btn-toggle ${shard.reviewEnabled ? "on" : ""}" id="f-review">In review queue</button>
        </div>
        <div class="section-title">${esc(preset.answerLabel)} *</div>
        <div class="muted" id="cardtype-hint" style="margin-bottom:6px;display:none">For cloze cards, wrap the words to hide in <code>{{c1::double braces}}</code>. They'll be blanked out during study.</div>
        <textarea class="code-editor" id="f-code" spellcheck="false" placeholder="${esc(preset.answerPlaceholder)}">${esc(shard.code)}</textarea>
        <div class="section-title" style="margin-top:12px">Description</div>
        <textarea id="f-desc" style="width:100%;min-height:80px" placeholder="Why does this work? When would you use it? (markdown-lite: **bold**, *italic*, \`code\`)">${esc(shard.description)}</textarea>
        <div id="f-media-slot"></div>
      </div>
    `);

    // Attachments editor (images/audio), shared with quick-capture.
    const media = buildMediaEditor(shard.media || []);
    root.querySelector("#f-media-slot").appendChild(media.node);
    root.addEventListener("paste", media.handlePaste);

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

    // Show the cloze-syntax hint only when the cloze card type is selected.
    const cardTypeSel = root.querySelector("#f-cardtype");
    const cardTypeHint = root.querySelector("#cardtype-hint");
    const syncCardTypeHint = () => {
      cardTypeHint.style.display = cardTypeSel.value === "cloze" ? "block" : "none";
    };
    cardTypeSel.addEventListener("change", syncCardTypeHint);
    syncCardTypeHint();

    // ---- Templates: populate the dropdown and prefill fields on selection ----
    const templateSel = root.querySelector("#f-template");
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
      const promptEl = root.querySelector("#f-prompt");
      const codeEl = root.querySelector("#f-code");
      const dirty = promptEl.value.trim() || codeEl.value.trim() || tagsInput.value.trim();
      if (dirty && !confirm(`Apply template "${t.name}"? This overwrites the current prompt, answer, tags, and card type.`))
        return;
      promptEl.value = t.prompt || "";
      codeEl.value = t.code || "";
      root.querySelector("#f-desc").value = t.description || "";
      if (langSel && t.language) langSel.value = t.language;
      cardTypeSel.value = t.cardType || "basic";
      tagsInput.value = t.tags || "";
      controlsFromField();
      syncCardTypeHint();
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
      const updated = {
        ...shard,
        title,
        prompt: root.querySelector("#f-prompt").value.trim(),
        language: langSel ? (langSel.value === ADD_CUSTOM ? shard.language : langSel.value) : shard.language,
        cardType: cardTypeSel.value,
        category: root.querySelector("#f-cat").value,
        familiarity: root.querySelector("#f-fam").value,
        source: root.querySelector("#f-source").value.trim(),
        tags: parseTags(tagsInput.value),
        code,
        description: root.querySelector("#f-desc").value,
        media: media.getItems(),
        reviewEnabled,
      };
      // Cards default into the review queue; ensure a due date the first time it's enabled.
      if (reviewEnabled && !updated.reviewNext) {
        updated.reviewNext = new Date().toISOString().slice(0, 10);
      }
      const saved = await ctx.api.saveShard(updated);
      ctx.navigate("editor", { id: saved.id });
    });

    return root;
  }

  render();
}
