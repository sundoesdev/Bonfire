// Dashboard: stats, language breakdown, due-for-review, recently added.
import { el, esc, langBadge, famBadge, catBadge, isDue } from "../dom.js";
import { langColor } from "../constants.js";
import { exportVault, importVault } from "../data.js";
import {
  bulkDelete,
  bulkAddToDeck,
  bulkRemoveFromDeck,
  openBulkMenu,
  fieldMenuItems,
  mediaMenuItems,
} from "../components/bulkBar.js";

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

  // Multi-select for bulk actions (item 1), shared by the due + recent lists.
  const selected = new Set();
  // Shift+Click range selection (item 5). The anchor remembers which list it was set
  // in (`ids` array) so a range only spans within that one list. `checkboxes` maps a
  // card id to its rendered checkbox(es) so a range op can repaint them in place.
  let anchor = null; // { ids, idx }
  const checkboxes = new Map(); // id -> checkbox element[]

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
        <div class="section-title">Upcoming reviews (next 7 days)</div>
        <div id="forecast"></div>
      </div>

      <div class="panel">
        <div class="row" style="flex-wrap:wrap;row-gap:6px">
          <div class="section-title" style="margin:0">Due for Review</div>
          <div class="spacer"></div>
          <span class="muted" id="sel-count" style="margin-right:4px"></span>
          <button class="btn btn-accent mini" id="bulk-edit" disabled>Edit</button>
          <button class="btn btn-tool mini" id="bulk-fields" disabled>Edit field ▾</button>
          <button class="btn btn-tool mini" id="bulk-media" disabled>Add media ▾</button>
          <button class="btn btn-tool mini" id="bulk-deck-add" disabled>Add to deck</button>
          <button class="btn btn-tool mini" id="bulk-deck-rm" disabled>Remove from deck</button>
          <button class="btn btn-danger mini" id="bulk-del" disabled>Delete</button>
          <button class="btn btn-tool" id="weak">Weak spots</button>
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

  // ---- Bulk toolbar (lives in the Due-for-Review row, left of "Weak spots";
  // always visible but greyed out until cards are selected) ----
  const selCount = root.querySelector("#sel-count");
  const bulkEdit = root.querySelector("#bulk-edit");
  const bulkFields = root.querySelector("#bulk-fields");
  const bulkMedia = root.querySelector("#bulk-media");
  const bulkDeckAdd = root.querySelector("#bulk-deck-add");
  const bulkDeckRm = root.querySelector("#bulk-deck-rm");
  const bulkDel = root.querySelector("#bulk-del");

  function updateBulk() {
    const n = selected.size;
    selCount.textContent = n ? `${n} selected` : "";
    [bulkFields, bulkMedia, bulkDeckAdd, bulkDeckRm, bulkDel].forEach((b) => (b.disabled = n === 0));
    bulkEdit.disabled = n !== 1;
  }
  async function runBulk(fn) {
    const ids = [...selected];
    if (!ids.length) return;
    const ok = await fn(ctx, ids);
    if (ok) {
      selected.clear();
      ctx.refreshView();
    }
  }
  bulkDel.addEventListener("click", () => runBulk(bulkDelete));
  bulkDeckAdd.addEventListener("click", () => runBulk(bulkAddToDeck));
  bulkDeckRm.addEventListener("click", () => runBulk(bulkRemoveFromDeck));
  bulkFields.addEventListener("click", () => openBulkMenu(bulkFields, fieldMenuItems(runBulk)));
  bulkMedia.addEventListener("click", () => openBulkMenu(bulkMedia, mediaMenuItems(runBulk)));
  bulkEdit.addEventListener("click", () => {
    const id = [...selected][0];
    if (id) ctx.openShard(id);
  });

  function shardRow(s, listIds) {
    const row = el(`
      <div class="list-row">
        <input type="checkbox" class="row-sel" ${selected.has(s.id) ? "checked" : ""} />
        ${langBadge(s.language)}
        <span class="title">${esc(s.title) || "(untitled)"}</span>
        ${isDue(s) ? '<span class="review-dot" title="Due for review today">●</span>' : ""}
        ${catBadge(s.category)}
        ${famBadge(s.familiarity)}
        <button class="btn mini review-btn" title="Review this card (no answer shown first)">Review</button>
      </div>
    `);
    const cb = row.querySelector(".row-sel");
    if (!checkboxes.has(s.id)) checkboxes.set(s.id, []);
    checkboxes.get(s.id).push(cb);
    // Selection on click (carries shiftKey); Shift+Click selects the range within
    // this list (item 5).
    cb.addEventListener("click", (e) => {
      e.stopPropagation();
      const idx = listIds.indexOf(s.id);
      if (e.shiftKey && anchor && anchor.ids === listIds && idx !== -1) {
        const lo = Math.min(anchor.idx, idx);
        const hi = Math.max(anchor.idx, idx);
        const on = cb.checked;
        for (let i = lo; i <= hi; i++) {
          const id = listIds[i];
          if (on) selected.add(id);
          else selected.delete(id);
          (checkboxes.get(id) || []).forEach((box) => (box.checked = on));
        }
        updateBulk();
        return;
      }
      if (cb.checked) selected.add(s.id);
      else selected.delete(s.id);
      anchor = { ids: listIds, idx };
      updateBulk();
    });
    row.addEventListener("click", () => ctx.openShard(s.id));
    // Single-card review without opening the editor (which would reveal the answer first).
    row.querySelector(".review-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      ctx.reviewCard(s.id);
    });
    return row;
  }

  // Due list (max 5 + "more" hint).
  const dueList = root.querySelector("#due-list");
  if (!due.length) {
    dueList.innerHTML = '<div class="muted">Nothing due. Nice.</div>';
  } else {
    const dueShown = due.slice(0, 5);
    const dueIds = dueShown.map((s) => s.id);
    dueShown.forEach((s) => dueList.appendChild(shardRow(s, dueIds)));
    if (due.length > 5) {
      dueList.appendChild(el(`<div class="muted" style="padding:6px 8px">+${due.length - 5} more</div>`));
    }
  }

  // 7-day review forecast (current deck). Day 0 includes anything overdue.
  const forecastEl = root.querySelector("#forecast");
  const days = buildForecast(shards);
  forecastEl.innerHTML = "";
  days.forEach((d) => {
    // Bar width is the day's due count against a FIXED ceiling of 100 (50 due =
    // half full, 100+ = full) — not relative to the busiest day. Brightness is a
    // separate axis: dueLevel() buckets the count 0–4 (styled per data-level).
    const row = el(`
      <div class="forecast-row">
        <span class="forecast-label">${esc(d.label)}</span>
        <span class="forecast-bar-track"><span class="forecast-bar" data-level="${dueLevel(d.count)}" style="width:${Math.min(100, d.count)}%"></span></span>
        <span class="forecast-count">${d.count}</span>
      </div>
    `);
    forecastEl.appendChild(row);
  });

  // Recent list.
  const recentList = root.querySelector("#recent-list");
  if (!recent.length) {
    recentList.innerHTML = '<div class="muted">No shards yet — press Ctrl+N to capture one.</div>';
  } else {
    const recentIds = recent.map((s) => s.id);
    recent.forEach((s) => recentList.appendChild(shardRow(s, recentIds)));
  }

  root.querySelector("#start-study").addEventListener("click", () => ctx.startStudy());
  root.querySelector("#daily").addEventListener("click", () => ctx.quickStudy());
  root.querySelector("#weak").addEventListener("click", () => ctx.weakStudy());
  root.querySelector("#export-btn").addEventListener("click", () => exportVault(ctx));
  root.querySelector("#import-btn").addEventListener("click", async () => {
    await importVault(ctx);
    ctx.navigate("dashboard");
  });

  container.appendChild(root);
}

// YYYY-MM-DD for a Date in local time.
function ymd(d) {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

// Intensity bucket for a day's due count, mirroring the Stats heatmap's 0–4
// scale so a busier day reads as a brighter forecast bar.
function dueLevel(c) {
  if (!c) return 0;
  if (c <= 2) return 1;
  if (c <= 5) return 2;
  if (c <= 9) return 3;
  return 4;
}

// Count review-enabled cards due on each of the next 7 days. Day 0 ("Today")
// rolls in everything overdue (reviewNext on or before today).
function buildForecast(shards) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const out = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const ds = ymd(d);
    const count = shards.filter((s) => {
      if (!s.reviewEnabled || !s.reviewNext) return false;
      return i === 0 ? s.reviewNext <= ds : s.reviewNext === ds;
    }).length;
    const label =
      i === 0 ? "Today" : d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
    out.push({ label, count });
  }
  return out;
}
