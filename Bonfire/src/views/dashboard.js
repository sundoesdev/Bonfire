// Dashboard: stats, language breakdown, due-for-review, recently added.
import { el, esc, langBadge, famBadge, isDue } from "../dom.js";
import { langColor } from "../constants.js";
import { exportVault, importVault } from "../data.js";

export function renderDashboard(container, ctx) {
  const shards = ctx.state.shards;
  const due = shards.filter(isDue);
  const langs = new Set(shards.map((s) => s.language).filter(Boolean));
  const shaky = shards.filter((s) => s.familiarity === "shaky").length;

  // Language counts, sorted descending.
  const counts = {};
  for (const s of shards) {
    if (s.language) counts[s.language] = (counts[s.language] || 0) + 1;
  }
  const langEntries = Object.entries(counts).sort((a, b) => b[1] - a[1]);

  const recent = shards.slice(0, 10); // already modified_at DESC from backend

  const root = el(`
    <div>
      <div class="row" style="margin-bottom:14px">
        <h2 style="margin:0;font-size:16px">Bonfire</h2>
        <div class="spacer"></div>
        <button class="btn btn-tool" id="export-btn">Export</button>
        <button class="btn btn-tool" id="import-btn">Import</button>
      </div>

      <div class="stats">
        <div class="stat-card"><div class="stat-num">${shards.length}</div><div class="stat-label">Total Shards</div></div>
        <div class="stat-card"><div class="stat-num due">${due.length}</div><div class="stat-label">Due for Review</div></div>
        <div class="stat-card"><div class="stat-num">${langs.size}</div><div class="stat-label">Languages</div></div>
        <div class="stat-card"><div class="stat-num shaky">${shaky}</div><div class="stat-label">Shaky</div></div>
      </div>

      <div class="panel">
        <div class="section-title">Languages</div>
        <div class="lang-list">
          ${
            langEntries.length
              ? langEntries
                  .map(
                    ([l, c]) =>
                      `<span class="badge lang-chip" style="background:${langColor(l)}">${esc(l)}<span class="count">${c}</span></span>`
                  )
                  .join("")
              : '<span class="muted">No languages yet</span>'
          }
        </div>
      </div>

      <div class="panel">
        <div class="row">
          <div class="section-title" style="margin:0">Due for Review</div>
          <div class="spacer"></div>
          <button class="btn btn-tool" id="daily">Daily (Ctrl+D)</button>
          <button class="btn btn-primary" id="start-study">Start Study</button>
        </div>
        <div id="due-list" style="margin-top:10px"></div>
      </div>

      <div class="panel">
        <div class="section-title">Recently Added</div>
        <div id="recent-list"></div>
      </div>
    </div>
  `);

  // Due list (max 5 + "more" hint).
  const dueList = root.querySelector("#due-list");
  if (!due.length) {
    dueList.innerHTML = '<div class="muted">Nothing due. Nice.</div>';
  } else {
    due.slice(0, 5).forEach((s) => dueList.appendChild(shardRow(s, ctx)));
    if (due.length > 5) {
      dueList.appendChild(el(`<div class="muted" style="padding:6px 8px">+${due.length - 5} more</div>`));
    }
  }

  // Recent list.
  const recentList = root.querySelector("#recent-list");
  if (!recent.length) {
    recentList.innerHTML = '<div class="muted">No shards yet — press Ctrl+N to capture one.</div>';
  } else {
    recent.forEach((s) => recentList.appendChild(shardRow(s, ctx)));
  }

  root.querySelector("#start-study").addEventListener("click", () => ctx.startStudy());
  root.querySelector("#daily").addEventListener("click", () => ctx.quickStudy());
  root.querySelector("#export-btn").addEventListener("click", () => exportVault(ctx));
  root.querySelector("#import-btn").addEventListener("click", async () => {
    await importVault(ctx);
    ctx.navigate("dashboard");
  });

  container.appendChild(root);
}

function shardRow(s, ctx) {
  const row = el(`
    <div class="list-row">
      ${langBadge(s.language)}
      <span class="title">${esc(s.title) || "(untitled)"}</span>
      ${s.reviewEnabled ? '<span class="review-dot">●</span>' : ""}
      <span class="cat">${esc(s.category)}</span>
      ${famBadge(s.familiarity)}
    </div>
  `);
  row.addEventListener("click", () => ctx.openShard(s.id));
  return row;
}
