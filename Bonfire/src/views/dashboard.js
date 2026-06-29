// Dashboard: stats, language breakdown, due-for-review, recently added.
import { el, esc, langDot, isDue, progressRing } from "../dom.js";
import { langColor, getDifficulty } from "../constants.js";

// Familiarity → mastery rank (mirrors stats.js so the hero ring matches Deck mastery).
const FAM_RANK = { shaky: 0, fresh: 1, solid: 2, mastered: 3 };
import { exportVault, importVault } from "../data.js";
import {
  bulkDelete,
  bulkAddToDeck,
  bulkRemoveFromDeck,
  openBulkMenu,
  fieldMenuItems,
  mediaMenuItems,
} from "../components/bulkBar.js";

export async function renderDashboard(container, ctx) {
  const shards = ctx.state.shards;
  const due = shards.filter(isDue);

  // Language counts, sorted descending (for the Languages panel bars).
  const counts = {};
  for (const s of shards) {
    if (s.language) counts[s.language] = (counts[s.language] || 0) + 1;
  }
  const langEntries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const maxLang = langEntries.length ? langEntries[0][1] : 1;

  const recent = shards.slice(0, 10); // already modified_at DESC from backend

  // Current-deck mastery (avg familiarity rank) for the hero ring.
  const masteryPct = shards.length
    ? Math.round((shards.reduce((a, s) => a + (FAM_RANK[s.familiarity] ?? 1) / 3, 0) / shards.length) * 100)
    : 0;

  // Day streak + total reviews from the review log (best-effort; empty on error).
  let dayCount = new Map();
  try {
    const hist = await ctx.api.reviewHistory();
    dayCount = new Map(hist.map((d) => [d.day, d.count]));
  } catch (_e) {
    /* no history yet */
  }
  const streak = currentStreak(dayCount);
  const totalReviews = [...dayCount.values()].reduce((a, b) => a + b, 0);
  const greeting = timeGreeting();
  const sub = due.length
    ? `${due.length} shard${due.length === 1 ? "" : "s"} due — a short session keeps the embers warm.`
    : "You have a quiet day — nothing due right now.";

  // Multi-select for bulk actions (item 1), shared by the due + recent lists.
  const selected = new Set();
  // Shift+Click range selection (item 5). The anchor remembers which list it was set
  // in (`ids` array) so a range only spans within that one list. `checkboxes` maps a
  // card id to its rendered checkbox(es) so a range op can repaint them in place.
  let anchor = null; // { ids, idx }
  const checkboxes = new Map(); // id -> checkbox element[]

  const root = el(`
    <div>
      <div class="dash-head">
        <div>
          <div class="page-greeting">${esc(greeting)}</div>
          <div class="page-sub">${esc(sub)}</div>
        </div>
        <div class="row" style="gap:7px">
          <button class="btn btn-tool icon-btn" id="export-btn" title="Export vault" aria-label="Export vault"><i class="ti ti-download" aria-hidden="true"></i></button>
          <button class="btn btn-tool icon-btn" id="import-btn" title="Import vault" aria-label="Import vault"><i class="ti ti-upload" aria-hidden="true"></i></button>
        </div>
      </div>

      <div class="hero">
        ${progressRing(masteryPct, "mastery")}
        <div class="hero-txt">
          <h3>Tend the fire</h3>
          <p>Your deck is ${masteryPct}% mastered. ${
            due.length
              ? `${due.length} shard${due.length === 1 ? "" : "s"} ${due.length === 1 ? "is" : "are"} ready — a`
              : "A"
          } short session keeps the embers warm${streak ? ` and your ${streak}-day streak alive` : ""}.</p>
          <button class="btn btn-primary" id="hero-study"><i class="ti ti-player-play" aria-hidden="true"></i>Begin review</button>
        </div>
      </div>

      <div class="stats">
        <div class="stat-card"><div class="stat-num">${shards.length}</div><div class="stat-label">Total shards</div></div>
        <div class="stat-card"><div class="stat-num ${due.length ? "due" : ""}">${due.length}</div><div class="stat-label">Due today</div></div>
        <div class="stat-card"><div class="stat-num">${streak}</div><div class="stat-label">Day streak</div></div>
        <div class="stat-card"><div class="stat-num">${totalReviews}</div><div class="stat-label">Reviews</div></div>
      </div>

      <div class="dash-cols">
        <div class="panel" style="margin-bottom:0">
          <div class="section-title">Languages</div>
          ${
            langEntries.length
              ? langEntries
                  .map(
                    ([l, c]) =>
                      `<div class="lang-row" style="--dot:${langColor(l)}"><span class="lang-dot"></span><span class="lang-name">${esc(l)}</span><span class="lang-track"><span class="lang-fill" style="width:${Math.round((c / maxLang) * 100)}%"></span></span><span class="lang-cnt">${c}</span></div>`
                  )
                  .join("")
              : '<span class="muted">No languages yet</span>'
          }
        </div>

        <div class="panel" style="margin-bottom:0">
          <div class="section-title">Next 7 days</div>
          <div id="forecast"></div>
        </div>
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
        ${langDot(s.language)}
        <span class="title">${esc(s.title) || "(untitled)"}</span>
        ${isDue(s) ? '<span class="review-dot" title="Due for review today">●</span>' : ""}
        <span class="row-meta">${esc(s.language || "")}${getDifficulty(s.tags) ? " · " + esc(getDifficulty(s.tags)) : ""}</span>
        <button class="btn btn-tool mini review-btn" title="Review this card (no answer shown first)">Review</button>
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
  root.querySelector("#hero-study").addEventListener("click", () => ctx.startStudy());
  root.querySelector("#daily").addEventListener("click", () => ctx.quickStudy());
  root.querySelector("#weak").addEventListener("click", () => ctx.weakStudy());
  root.querySelector("#export-btn").addEventListener("click", () => exportVault(ctx));
  root.querySelector("#import-btn").addEventListener("click", async () => {
    await importVault(ctx);
    ctx.navigate("dashboard");
  });

  container.appendChild(root);
}

// Time-of-day greeting for the dashboard header.
function timeGreeting() {
  const h = new Date().getHours();
  if (h < 5) return "Still up";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

// Current consecutive-day study streak from a day→count map (mirrors stats.js).
function currentStreak(dayCount) {
  const probe = new Date();
  probe.setHours(0, 0, 0, 0);
  if (!(dayCount.get(ymd(probe)) > 0)) probe.setDate(probe.getDate() - 1);
  let n = 0;
  while (dayCount.get(ymd(probe)) > 0) {
    n++;
    probe.setDate(probe.getDate() - 1);
  }
  return n;
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
