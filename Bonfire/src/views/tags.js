// Tags: manage tags across every deck — rename (merge into an existing tag) or delete.
import { el, esc } from "../dom.js";
import { SPECIAL_TAGS } from "../constants.js";

export function renderTags(container, ctx) {
  // Tags are global, so operate over every card (not just the current deck).
  const shards = ctx.state.allShards;
  const counts = {};
  for (const s of shards) {
    for (const t of s.tags || []) counts[t] = (counts[t] || 0) + 1;
  }
  const tags = Object.keys(counts).sort();

  const root = el(`
    <div>
      <h2 style="margin:0 0 6px;font-size:16px">Tags</h2>
      <div class="muted" style="margin-bottom:10px">Manage tags across every deck. Renaming onto an existing tag merges them; deleting removes the tag from all cards.</div>
      <div class="count-label">${tags.length} tag${tags.length === 1 ? "" : "s"}</div>
      <div id="tag-list"></div>
    </div>
  `);

  const list = root.querySelector("#tag-list");
  if (!tags.length) {
    list.appendChild(el('<div class="empty">No tags yet.</div>'));
  }

  tags.forEach((t) => {
    const special = SPECIAL_TAGS.has(t);
    const n = counts[t];
    const row = el(`
      <div class="list-row">
        <span class="title">#${esc(t)}</span>
        ${special ? '<span class="muted" title="Special keyword tag (difficulty / foundation / reveal-only)">special</span>' : ""}
        <span class="cat">${n} card${n === 1 ? "" : "s"}</span>
        <button class="btn btn-accent mini tag-rename">Rename / merge</button>
        <button class="btn mini btn-danger tag-del">Delete</button>
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
      const warn = special
        ? " This is a special keyword tag — removing it changes how those cards behave in study."
        : "";
      if (confirm(`Delete tag "${t}" from ${n} card(s)?${warn}`)) {
        await ctx.api.deleteTag(t);
        await ctx.navigate("tags");
      }
    });

    list.appendChild(row);
  });

  container.innerHTML = "";
  container.appendChild(root);
}
