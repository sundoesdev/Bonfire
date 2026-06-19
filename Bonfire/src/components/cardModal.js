// View/Edit a card in a popout modal. Replaces the old full-page editor view:
// clicking a card opens this. It shares buildCardFields with the Add modal so the
// edit form is identical in order and look. Two states: read-only "view" and the
// editable "edit" form, toggled in place.
import { el, esc, metaBadges } from "../dom.js";
import { mdLite } from "../markdown.js";
import { highlightInto } from "../highlight.js";
import { buildCardFields, blankShard } from "./cardFields.js";
import { confirmDialog } from "./confirm.js";

// Read-only attachments markup for View mode, grouped by side.
function mediaViewHtml(media) {
  if (!media || !media.length) return "";
  const block = (side, title) => {
    const its = media.filter((m) => (m.side || "question") === side);
    if (!its.length) return "";
    const cells = its
      .map((m) => {
        const cap = m.caption ? `<div class="muted media-cap">${mdLite(m.caption)}</div>` : "";
        const node =
          m.kind === "image"
            ? `<img class="study-image" src="${esc(m.dataUrl)}" alt="${esc(m.caption || "image")}" />`
            : `<audio controls src="${esc(m.dataUrl)}"></audio>`;
        return `<div class="media-view-item">${node}${cap}</div>`;
      })
      .join("");
    return `<div class="section-title" style="margin-top:12px">${title}</div><div class="media-view">${cells}</div>`;
  };
  return block("question", "Attachments (question)") + block("answer", "Attachments (answer)");
}

export function openCardModal(ctx, { id } = {}) {
  const root = document.querySelector("#modal-root");
  if (root.querySelector(".modal-backdrop")) return; // already open

  const found = ctx.state.allShards.find((s) => s.id === id);
  if (!found) return;
  let shard = { ...blankShard(), ...found };
  const preset = ctx.currentPreset();

  let mode = "view";
  // Edit-mode dirty flag + current save handler, for the discard guard (item 8)
  // and Ctrl+Enter save (item 3).
  let dirty = false;
  let editSave = null;

  const backdrop = el(`<div class="modal-backdrop"><div class="modal modal-card" id="cm-modal"></div></div>`);
  const modal = backdrop.querySelector("#cm-modal");

  function close() {
    root.innerHTML = "";
    document.removeEventListener("keydown", onKey);
  }
  // Guarded close: in edit mode with unsaved changes, confirm before discarding.
  async function tryClose() {
    if (mode === "edit" && dirty) {
      const ok = await confirmDialog({
        title: "Discard changes?",
        message: "Your unsaved edits to this card will be lost.",
        confirmLabel: "Discard",
        confirmClass: "btn-danger",
        cancelLabel: "Keep editing",
      });
      if (!ok) return;
    }
    close();
  }
  function onKey(e) {
    if (e.key === "Escape") tryClose();
    else if (mode === "edit" && e.ctrlKey && e.key === "Enter") {
      e.preventDefault();
      if (editSave) editSave();
    }
  }
  backdrop.addEventListener("mousedown", (e) => {
    if (e.target === backdrop) tryClose();
  });

  // ---- View mode ----
  function renderView() {
    editSave = null;
    const meta = [shard.language, shard.category, shard.familiarity].filter(Boolean).join(" · ");
    modal.innerHTML = "";
    const body = el(`
      <div>
        <div class="title-big">${esc(shard.title) || "(untitled)"}</div>
        ${shard.prompt ? `<div class="desc markdown-body" style="margin-bottom:8px">${mdLite(shard.prompt)}</div>` : ""}
        <div class="meta-line">${esc(meta)} ${metaBadges(shard.tags)}${
          shard.reviewEnabled && shard.reviewNext ? " · Review: " + esc(shard.reviewNext) : ""
        }</div>
        <pre class="code-block"><code id="cm-code"></code></pre>
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
        <div class="actions">
          <button class="btn btn-danger" id="cm-del">Delete</button>
          <div class="spacer"></div>
          <button class="btn btn-secondary" id="cm-review">Review</button>
          <button class="btn btn-accent" id="cm-edit">Edit</button>
          <button class="btn btn-secondary" id="cm-close">Close</button>
        </div>
      </div>
    `);
    modal.appendChild(body);

    const codeEl = body.querySelector("#cm-code");
    if (preset.highlight) highlightInto(codeEl, shard.code, shard.language);
    else codeEl.textContent = shard.code;

    body.querySelector("#cm-edit").addEventListener("click", () => {
      mode = "edit";
      render();
    });
    body.querySelector("#cm-close").addEventListener("click", close);
    body.querySelector("#cm-review").addEventListener("click", () => {
      close();
      ctx.reviewCard(shard.id);
    });
    body.querySelector("#cm-del").addEventListener("click", async () => {
      if (!confirm("Delete this shard?")) return;
      await ctx.api.deleteShard(shard.id);
      close();
      ctx.refreshView();
    });
  }

  // ---- Edit mode ----
  function renderEdit() {
    modal.innerHTML = "";
    dirty = false;
    const fields = buildCardFields(ctx, shard);
    const wrap = el(`
      <div>
        <h2>Edit Shard</h2>
        <div id="cm-fields-slot"></div>
        <div class="actions">
          <button class="btn btn-danger" id="cm-edel">Delete</button>
          <div class="spacer"></div>
          <button class="btn btn-secondary" id="cm-cancel">Cancel</button>
          <button class="btn btn-primary" id="cm-save">Save</button>
        </div>
      </div>
    `);
    wrap.querySelector("#cm-fields-slot").appendChild(fields.node);
    modal.appendChild(wrap);

    // Mark dirty on any user edit, for the discard guard (item 8).
    fields.node.addEventListener("input", () => { dirty = true; });
    fields.node.addEventListener("change", () => { dirty = true; });

    async function doSave() {
      const data = fields.collect();
      if (!data.title) {
        alert("Title is required.");
        return;
      }
      if (!data.code.trim()) {
        alert("Answer is required.");
        return;
      }
      const updated = { ...shard, ...data };
      // Cards default into the review queue; ensure a due date once enabled.
      if (updated.reviewEnabled && !updated.reviewNext) {
        updated.reviewNext = new Date().toISOString().slice(0, 10);
      }
      shard = await ctx.api.saveShard(updated);
      dirty = false;
      await ctx.refreshView();
      mode = "view";
      render();
    }
    editSave = doSave;

    wrap.querySelector("#cm-cancel").addEventListener("click", () => {
      mode = "view";
      render();
    });
    wrap.querySelector("#cm-edel").addEventListener("click", async () => {
      if (!confirm("Delete this shard?")) return;
      await ctx.api.deleteShard(shard.id);
      close();
      ctx.refreshView();
    });
    wrap.querySelector("#cm-save").addEventListener("click", doSave);
  }

  function render() {
    if (mode === "view") renderView();
    else renderEdit();
  }

  root.appendChild(backdrop);
  document.addEventListener("keydown", onKey);
  render();
}
