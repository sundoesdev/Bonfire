// Tags: manage tags across every deck. Grouped into Special (keyword) vs Topic,
// each row with a usage bar; rename (merge into an existing tag), delete, or
// create a new topic tag by applying it to chosen cards.
import { el, esc } from "../dom.js";
import { SPECIAL_TAGS, toggleTag } from "../constants.js";

export function renderTags(container, ctx) {
  // Tags are global, so operate over every card (not just the current deck).
  const shards = ctx.state.allShards;
  const counts = {};
  for (const s of shards) {
    for (const t of s.tags || []) counts[t] = (counts[t] || 0) + 1;
  }
  const allTags = Object.keys(counts).sort();
  const special = allTags.filter((t) => SPECIAL_TAGS.has(t));
  const topic = allTags.filter((t) => !SPECIAL_TAGS.has(t));
  const maxCount = allTags.reduce((m, t) => Math.max(m, counts[t]), 0) || 1;

  const root = el(`
    <div>
      <div class="page-greeting">Tags</div>
      <div class="page-sub">Manage tags across every deck. Renaming onto an existing tag merges them; deleting removes it from all cards.</div>
      <div class="section-title" style="margin-top:18px">Special — keyword tags</div>
      <div class="panel" id="special-panel"></div>
      <div class="section-title">Topic tags</div>
      <div class="panel" id="topic-panel"></div>
      <div style="margin-top:2px"><button class="btn btn-tool" id="new-tag">+ New topic tag</button></div>
    </div>
  `);

  const specialPanel = root.querySelector("#special-panel");
  const topicPanel = root.querySelector("#topic-panel");

  // One tag row: #name + (special marker) + usage bar + count + quiet actions.
  function tagRow(t) {
    const isSpecial = SPECIAL_TAGS.has(t);
    const n = counts[t];
    const pct = Math.round((n / maxCount) * 100);
    const row = el(`
      <div class="list-row">
        <span class="title">#${esc(t)}</span>
        ${isSpecial ? '<span class="pill" title="Special keyword tag (difficulty / foundation / reveal-only)">special</span>' : ""}
        <span class="mastery-track"><span class="mastery-fill" style="width:${pct}%"></span></span>
        <span class="cat">${n} card${n === 1 ? "" : "s"}</span>
        <button class="btn btn-tool mini tag-rename">Rename</button>
        <button class="btn btn-danger mini tag-del">Delete</button>
      </div>
    `);

    row.querySelector(".tag-rename").addEventListener("click", async () => {
      const next = prompt(`Rename "${t}" to (type an existing tag to merge into it):`, t);
      const newName = (next || "").trim().toLowerCase();
      if (newName && newName !== t) {
        await ctx.api.renameTag(t, newName);
        await ctx.navigate("tags");
      }
    });

    row.querySelector(".tag-del").addEventListener("click", async () => {
      const warn = isSpecial
        ? " This is a special keyword tag — removing it changes how those cards behave in study."
        : "";
      if (confirm(`Delete tag "${t}" from ${n} card(s)?${warn}`)) {
        await ctx.api.deleteTag(t);
        await ctx.navigate("tags");
      }
    });

    return row;
  }

  if (!special.length) {
    specialPanel.appendChild(el('<div class="muted">No keyword tags in use yet.</div>'));
  } else {
    special.forEach((t) => specialPanel.appendChild(tagRow(t)));
  }

  if (!topic.length) {
    topicPanel.appendChild(
      el('<div class="empty">No topic tags yet — add one like <code>networking</code> to organize cards by subject.</div>')
    );
  } else {
    topic.forEach((t) => topicPanel.appendChild(tagRow(t)));
  }

  root.querySelector("#new-tag").addEventListener("click", () => newTopicTagModal(ctx));

  container.innerHTML = "";
  container.appendChild(root);
}

// Create a topic tag and apply it to one or more cards. Tags only exist on cards,
// so a new tag must attach to at least one. Uses the existing save_shard command
// (one save per chosen card) — the same frontend pattern as the bulk-field edits.
function newTopicTagModal(ctx) {
  const root = document.querySelector("#modal-root");
  if (root.querySelector(".modal-backdrop")) return;

  const cards = ctx.state.allShards
    .slice()
    .sort((a, b) => (a.title || "").toLowerCase().localeCompare((b.title || "").toLowerCase()));
  const selected = new Set();

  const backdrop = el(`
    <div class="modal-backdrop">
      <div class="modal">
        <h2>New topic tag</h2>
        <div class="desc" style="margin-bottom:10px">Create a topic tag and apply it to one or more cards. Tags live on cards, so a new tag needs at least one card to belong to.</div>
        <div class="field"><label>Tag name *</label><input type="text" id="nt-name" placeholder="e.g. networking" autocomplete="off" /></div>
        <div class="field"><label>Apply to cards *</label><input type="search" id="nt-search" placeholder="Filter cards by title or language…" autocomplete="off" /></div>
        <div id="nt-list" class="nt-card-list"></div>
        <div class="muted" id="nt-selcount" style="margin-top:6px"></div>
        <div class="actions">
          <button class="btn btn-tool" id="nt-cancel">Cancel</button>
          <button class="btn btn-primary" id="nt-apply" disabled>Create tag</button>
        </div>
      </div>
    </div>
  `);

  const nameEl = backdrop.querySelector("#nt-name");
  const searchEl = backdrop.querySelector("#nt-search");
  const listEl = backdrop.querySelector("#nt-list");
  const applyBtn = backdrop.querySelector("#nt-apply");
  const selCountEl = backdrop.querySelector("#nt-selcount");

  function updateApply() {
    selCountEl.textContent = selected.size ? `${selected.size} card${selected.size === 1 ? "" : "s"} selected` : "";
    applyBtn.disabled = !(nameEl.value.trim() && selected.size);
  }

  function drawList() {
    const q = searchEl.value.trim().toLowerCase();
    const matches = cards.filter(
      (c) => !q || (c.title || "").toLowerCase().includes(q) || (c.language || "").toLowerCase().includes(q)
    );
    listEl.innerHTML = "";
    if (!matches.length) {
      listEl.appendChild(el('<div class="muted" style="padding:8px">No matching cards.</div>'));
      return;
    }
    matches.slice(0, 200).forEach((c) => {
      const row = el(
        `<label class="chk nt-card-row"><input type="checkbox" ${selected.has(c.id) ? "checked" : ""}/> <span class="title">${
          esc(c.title) || "(untitled)"
        }</span> <span class="cat">${esc(c.language || "")}</span></label>`
      );
      row.querySelector("input").addEventListener("change", (e) => {
        if (e.target.checked) selected.add(c.id);
        else selected.delete(c.id);
        updateApply();
      });
      listEl.appendChild(row);
    });
    if (matches.length > 200) {
      listEl.appendChild(el(`<div class="muted" style="padding:6px 8px">+${matches.length - 200} more — narrow your filter</div>`));
    }
  }

  function close() {
    root.innerHTML = "";
    document.removeEventListener("keydown", onKey);
  }
  function onKey(e) {
    if (e.key === "Escape") close();
  }

  nameEl.addEventListener("input", updateApply);
  searchEl.addEventListener("input", drawList);
  backdrop.querySelector("#nt-cancel").addEventListener("click", close);
  backdrop.addEventListener("mousedown", (e) => {
    if (e.target === backdrop) close();
  });
  applyBtn.addEventListener("click", async () => {
    const name = nameEl.value.trim().toLowerCase();
    if (!name || !selected.size) return;
    if (SPECIAL_TAGS.has(name)) {
      alert(`"${name}" is a reserved keyword tag — pick a different topic name.`);
      return;
    }
    const byId = new Map(ctx.state.allShards.map((s) => [s.id, s]));
    const tasks = [];
    for (const id of selected) {
      const s = byId.get(id);
      if (!s) continue;
      tasks.push(ctx.api.saveShard({ ...s, tags: toggleTag(s.tags, name, true) }));
    }
    await Promise.all(tasks);
    close();
    ctx.toast(`Tag "${name}" added to ${selected.size} card${selected.size === 1 ? "" : "s"}`);
    ctx.navigate("tags");
  });

  root.appendChild(backdrop);
  document.addEventListener("keydown", onKey);
  drawList();
  nameEl.focus();
}
