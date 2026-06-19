// Stats: a GitHub-style year heatmap of study activity, streaks/totals, the
// topics you're weakest in, per-deck mastery, and a projected-retention curve.
// Everything is computed in the frontend from review_history + all shards.
import { el, esc } from "../dom.js";
import { SPECIAL_TAGS, difficultyColor } from "../constants.js";

const FAM_RANK = { shaky: 0, fresh: 1, solid: 2, mastered: 3 };

function ymd(d) {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function midnight(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

// 53 weeks of cells (Sun→Sat columns) ending today, GitHub-style.
function buildHeatmap(dayCount) {
  const today = midnight(new Date());
  const start = midnight(new Date());
  start.setDate(today.getDate() - 364);
  start.setDate(start.getDate() - start.getDay()); // back up to Sunday
  const weeks = [];
  const cur = new Date(start);
  while (cur <= today) {
    const week = [];
    for (let i = 0; i < 7; i++) {
      const ds = ymd(cur);
      week.push({ ds, count: dayCount.get(ds) || 0, future: cur > today });
      cur.setDate(cur.getDate() + 1);
    }
    weeks.push(week);
  }
  return weeks;
}

function level(c) {
  if (!c) return 0;
  if (c <= 2) return 1;
  if (c <= 5) return 2;
  if (c <= 9) return 3;
  return 4;
}

function fmtDuration(ms) {
  const totalMin = Math.round((ms || 0) / 60000);
  if (totalMin < 60) return `${totalMin}m`;
  return `${Math.floor(totalMin / 60)}h ${totalMin % 60}m`;
}

// Multi-line native-tooltip text for a heatmap day (item 8). Newlines render as
// line breaks in the browser's title tooltip.
function dayTooltip(ds, detail, deckName) {
  if (!detail || !detail.count) return `${ds}\nNo reviews`;
  const decks = (detail.deckCounts || []).map((dc) => `${deckName(dc.deckId)} (${dc.count})`).join(", ");
  const parts = [
    `${detail.count} card${detail.count === 1 ? "" : "s"}`,
    fmtDuration(detail.durationMs),
    `${detail.sessions || 0} session${detail.sessions === 1 ? "" : "s"}`,
  ];
  return `${ds}\n${parts.join(" · ")}${decks ? `\nDecks: ${decks}` : ""}`;
}

function isNextDay(a, b) {
  const da = new Date(a + "T00:00:00");
  da.setDate(da.getDate() + 1);
  return ymd(da) === b;
}

function streaks(dayCount) {
  const days = [...dayCount.entries()]
    .filter(([, c]) => c > 0)
    .map(([d]) => d)
    .sort();
  let longest = 0;
  let run = 0;
  let prev = null;
  for (const d of days) {
    run = prev && isNextDay(prev, d) ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = d;
  }
  // Current streak: count back from today (or yesterday if nothing today yet).
  let current = 0;
  const probe = midnight(new Date());
  if (!(dayCount.get(ymd(probe)) > 0)) probe.setDate(probe.getDate() - 1);
  while (dayCount.get(ymd(probe)) > 0) {
    current++;
    probe.setDate(probe.getDate() - 1);
  }
  return { longest, current };
}

function sumSince(dayCount, days) {
  const cutoff = midnight(new Date());
  cutoff.setDate(cutoff.getDate() - (days - 1));
  const c = ymd(cutoff);
  let total = 0;
  for (const [d, n] of dayCount) if (d >= c) total += n;
  return total;
}

// Topic tags you're weakest in (skips the reserved keyword tags).
function weakTags(shards) {
  const map = new Map();
  for (const s of shards) {
    for (const tag of s.tags || []) {
      if (SPECIAL_TAGS.has(tag)) continue;
      const e = map.get(tag) || { count: 0, famSum: 0, easeSum: 0, lapses: 0 };
      e.count++;
      e.famSum += FAM_RANK[s.familiarity] ?? 1;
      e.easeSum += s.reviewEase || 2.5;
      e.lapses += s.lapses || 0;
      map.set(tag, e);
    }
  }
  return [...map.entries()]
    .filter(([, e]) => e.count >= 2)
    .map(([tag, e]) => ({
      tag,
      count: e.count,
      avgFam: e.famSum / e.count,
      avgEase: e.easeSum / e.count,
      lapses: e.lapses,
      weakness: 3 - e.famSum / e.count + (2.5 - e.easeSum / e.count) + e.lapses / e.count,
    }))
    .sort((a, b) => b.weakness - a.weakness)
    .slice(0, 8);
}

function deckMastery(decks, allShards) {
  return decks
    .map((d) => {
      const cards = allShards.filter((s) => (s.deckIds || []).includes(d.id));
      const mastery = cards.length
        ? Math.round((cards.reduce((a, s) => a + (FAM_RANK[s.familiarity] ?? 1) / 3, 0) / cards.length) * 100)
        : 0;
      return { name: d.name, count: cards.length, mastery };
    })
    .filter((d) => d.count > 0)
    .sort((a, b) => b.mastery - a.mastery);
}

// Average projected recall probability over the next `horizon` days, using the
// FSRS forgetting curve R=(1+t/9S)^-1 (SM-2 cards approximate S from interval).
function retentionCurve(shards, horizon = 60) {
  const enabled = shards.filter((s) => s.reviewEnabled);
  const today = midnight(new Date());
  const pts = [];
  for (let t = 0; t <= horizon; t += 2) {
    let sum = 0;
    for (const s of enabled) {
      const S = s.fsrsStability > 0 ? s.fsrsStability : Math.max(s.reviewInterval || 1, 1);
      let elapsed = 0;
      if (s.lastReviewed) {
        const lr = midnight(new Date(s.lastReviewed));
        elapsed = Math.max(0, (today - lr) / 86400000);
      }
      sum += Math.pow(1 + (elapsed + t) / (9 * S), -1);
    }
    pts.push({ t, r: enabled.length ? sum / enabled.length : 0 });
  }
  return { pts, count: enabled.length };
}

// Average days until each enabled card next dips below 90% recall.
function avgDaysToReview(shards) {
  const enabled = shards.filter((s) => s.reviewEnabled);
  if (!enabled.length) return null;
  const today = midnight(new Date());
  let sum = 0;
  for (const s of enabled) {
    const S = s.fsrsStability > 0 ? s.fsrsStability : Math.max(s.reviewInterval || 1, 1);
    let elapsed = 0;
    if (s.lastReviewed) {
      const lr = midnight(new Date(s.lastReviewed));
      elapsed = Math.max(0, (today - lr) / 86400000);
    }
    sum += Math.max(0, S - elapsed); // t where R≈0.9 is t≈S, minus time already elapsed
  }
  return Math.round(sum / enabled.length);
}

// Retention chart. The SVG holds only the shapes (which can stretch without
// looking wrong); the axis labels are HTML so text never distorts (item 9).
function retentionChart(pts) {
  const W = 620;
  const H = 200;
  const horizon = pts[pts.length - 1].t || 1;
  const x = (t) => (t / horizon) * W;
  const y = (r) => (1 - r) * H;
  const line = pts.map((p) => `${x(p.t).toFixed(1)},${y(p.r).toFixed(1)}`).join(" ");
  const area = `0,${H} ${line} ${W},${H}`;
  const grid = [0.9, 0.7, 0.5]
    .map((r) => `<line class="ret-grid" x1="0" y1="${y(r).toFixed(1)}" x2="${W}" y2="${y(r).toFixed(1)}" />`)
    .join("");
  const mid = Math.round(horizon / 2);
  // %-axis labels absolutely positioned to line up exactly with the grid lines.
  const yLabels = [0.9, 0.7, 0.5]
    .map((r) => `<span class="ret-ylabel" style="top:${((1 - r) * 100).toFixed(0)}%">${Math.round(r * 100)}%</span>`)
    .join("");
  return `
    <div class="ret-plot">
      <svg class="ret-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
        ${grid}
        <polygon class="ret-area" points="${area}" />
        <polyline class="ret-line" points="${line}" />
      </svg>
      ${yLabels}
      <div class="ret-xaxis"><span>0d</span><span>${mid}d</span><span>${horizon}d</span></div>
    </div>`;
}

// Card debt (item 5): cards whose scheduled review (reviewNext) is in the PAST.
// Purely computed — Bonfire stores nothing and changes nothing. Most overdue first.
function cardDebt(allShards) {
  const now = Date.now();
  const today = ymd(midnight(new Date()));
  return allShards
    .filter((s) => s.reviewEnabled && s.reviewNext && s.reviewNext < today)
    .map((s) => {
      const dueMs = new Date(s.reviewNext + "T00:00:00").getTime();
      const ms = Math.max(0, now - dueMs);
      return { s, ms, days: Math.floor(ms / 86400000), hours: Math.floor((ms % 86400000) / 3600000) };
    })
    .sort((a, b) => b.ms - a.ms);
}

const RESET_LEVELS = [
  { id: "new", label: "Brand new" },
  { id: "semiNew", label: "Semi-new" },
  { id: "half", label: "Half-remembered" },
  { id: "good", label: "Good" },
  { id: "full", label: "Fully remembered" },
];

// Modal asking the user how well they remember an overdue card. Resolves a level
// id (new/semiNew/half/good/full) or null on cancel. The USER decides — Bonfire
// never picks for them.
function resetLevelDialog(title) {
  return new Promise((resolve) => {
    const buttons = RESET_LEVELS.map(
      (l) => `<button class="btn btn-secondary reset-lvl" data-lvl="${l.id}" style="justify-content:flex-start">${esc(l.label)}</button>`
    ).join("");
    const backdrop = el(`
      <div class="modal-backdrop confirm-backdrop">
        <div class="modal modal-confirm">
          <h2>${esc(title)}</h2>
          <div class="desc" style="margin-bottom:12px">How well do you remember this card now? Bonfire will re-set its schedule accordingly — pick the one that fits.</div>
          <div class="vlist">${buttons}</div>
          <div class="actions"><button class="btn btn-tool" id="reset-cancel">Cancel</button></div>
        </div>
      </div>
    `);
    function done(v) {
      backdrop.remove();
      document.removeEventListener("keydown", onKey, true);
      resolve(v);
    }
    function onKey(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        done(null);
      }
    }
    backdrop.querySelectorAll(".reset-lvl").forEach((b) =>
      b.addEventListener("click", () => done(b.dataset.lvl))
    );
    backdrop.querySelector("#reset-cancel").addEventListener("click", () => done(null));
    backdrop.addEventListener("mousedown", (e) => {
      if (e.target === backdrop) done(null);
    });
    document.body.appendChild(backdrop);
    document.addEventListener("keydown", onKey, true);
  });
}

export async function renderStats(container, ctx) {
  let days = [];
  try {
    days = await ctx.api.studyDays();
  } catch (_e) {
    /* ignore — empty history */
  }
  const dayCount = new Map(days.map((d) => [d.day, d.count]));
  const dayDetail = new Map(days.map((d) => [d.day, d]));
  const deckMap = new Map(ctx.decks().map((d) => [d.id, d.name]));
  const deckName = (id) => deckMap.get(id) || id || "(none)";
  const all = ctx.state.allShards;

  const weeks = buildHeatmap(dayCount);
  const { current, longest } = streaks(dayCount);
  const total = [...dayCount.values()].reduce((a, b) => a + b, 0);
  const todayN = dayCount.get(ymd(midnight(new Date()))) || 0;
  const last7 = sumSince(dayCount, 7);
  const last30 = sumSince(dayCount, 30);
  const weak = weakTags(all);
  const debt = cardDebt(all);
  const decks = deckMastery(ctx.decks(), all);
  const { pts, count: retCount } = retentionCurve(ctx.state.shards);
  const avgDays = avgDaysToReview(ctx.state.shards);

  // Month labels aligned to heatmap columns.
  let lastMonth = -1;
  const monthLabels = weeks
    .map((w) => {
      const first = new Date(w[0].ds + "T00:00:00");
      const mo = first.getMonth();
      if (mo !== lastMonth) {
        lastMonth = mo;
        return `<span class="hm-month">${first.toLocaleDateString(undefined, { month: "short" })}</span>`;
      }
      return '<span class="hm-month"></span>';
    })
    .join("");

  const heatCols = weeks
    .map(
      (w) =>
        `<div class="hm-col">${w
          .map((c) =>
            c.future
              ? '<div class="hm-cell future"></div>'
              : `<div class="hm-cell" data-level="${level(c.count)}" title="${esc(dayTooltip(c.ds, dayDetail.get(c.ds), deckName))}"></div>`
          )
          .join("")}</div>`
    )
    .join("");

  const root = el(`
    <div>
      <div class="row" style="margin-bottom:14px">
        <h2 style="margin:0;font-size:16px">Study stats</h2>
      </div>

      <div class="stats">
        <div class="stat-card"><div class="stat-num">${current}</div><div class="stat-label">Current streak</div></div>
        <div class="stat-card"><div class="stat-num">${longest}</div><div class="stat-label">Longest streak</div></div>
        <div class="stat-card"><div class="stat-num">${total}</div><div class="stat-label">Total reviews</div></div>
        <div class="stat-card"><div class="stat-num">${avgDays == null ? "—" : avgDays}</div><div class="stat-label">Avg days to review</div></div>
      </div>

      <div class="panel">
        <div class="row" style="align-items:flex-start">
          <div class="section-title" style="margin:0">Activity</div>
          <div class="spacer"></div>
          <div class="hm-totals">
            <span>Today: ${todayN} Review${todayN === 1 ? "" : "s"}</span>
            <span>7d: ${last7} Review${last7 === 1 ? "" : "s"}</span>
            <span>30d: ${last30} Review${last30 === 1 ? "" : "s"}</span>
          </div>
        </div>
        <div class="heatmap-scroll">
          <div class="hm-months">${monthLabels}</div>
          <div class="heatmap-grid">${heatCols}</div>
          <div class="hm-legend"><span class="muted">Less</span>
            <div class="hm-cell" data-level="0"></div>
            <div class="hm-cell" data-level="1"></div>
            <div class="hm-cell" data-level="2"></div>
            <div class="hm-cell" data-level="3"></div>
            <div class="hm-cell" data-level="4"></div>
            <span class="muted">More</span>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="row" style="align-items:center">
          <div class="section-title" style="margin:0">Card debt <span class="muted">(${debt.length} card${debt.length === 1 ? "" : "s"} past their scheduled review)</span></div>
          <div class="spacer"></div>
          <button class="btn btn-primary mini" id="debt-study-all" ${debt.length ? "" : "disabled"}>Study all</button>
        </div>
        <div class="muted" style="margin:6px 0 8px">These cards are overdue — time has passed since SM-2/FSRS said to review them. Bonfire changes nothing on its own: <b>Study all</b> (or per-card <b>Study</b>) to clear the debt (the schedule then continues as if studied on time), or <b>Reset</b> how well you remember a card if you'd rather re-introduce it.</div>
        <div id="debt-list"></div>
      </div>

      <div class="panel">
        <div class="section-title">Projected retention — current deck${retCount ? "" : " (no review-enabled cards yet)"}</div>
        <div class="muted" style="margin-bottom:8px">Average chance you'd still recall a card on a given day, from each card's memory strength. ${
          avgDays == null ? "" : `Cards trend review-worthy in ~${avgDays} day(s).`
        }</div>
        ${retCount ? retentionChart(pts) : '<div class="muted">Enable spaced repetition on some cards to see a forecast.</div>'}
      </div>

      <div class="panel">
        <div class="section-title">Areas you're lacking <span class="muted">(weakest topics across all decks)</span></div>
        <div id="weak-list"></div>
      </div>

      <div class="panel">
        <div class="section-title">Deck mastery</div>
        <div id="deck-mastery"></div>
      </div>
    </div>
  `);

  const weakList = root.querySelector("#weak-list");
  if (!weak.length) {
    weakList.innerHTML = '<div class="muted">Not enough tagged cards yet — add topic tags to see weak spots.</div>';
  } else {
    weak.forEach((w) => {
      const pct = Math.round((w.avgFam / 3) * 100);
      const row = el(`
        <div class="list-row">
          <span class="badge" style="background:${difficultyColor("advanced")}">#${esc(w.tag)}</span>
          <span class="cat">${w.count} card${w.count === 1 ? "" : "s"}</span>
          <span class="mastery-track"><span class="mastery-fill" style="width:${pct}%"></span></span>
          <span class="muted">${pct}% familiar${w.lapses ? ` · ${w.lapses} lapse${w.lapses === 1 ? "" : "s"}` : ""}</span>
          <button class="btn mini weak-drill" data-tag="${esc(w.tag)}">Drill</button>
        </div>
      `);
      row.querySelector(".weak-drill").addEventListener("click", () => ctx.weakStudy());
      weakList.appendChild(row);
    });
  }

  // ---- Card debt list ----
  const studyAllBtn = root.querySelector("#debt-study-all");
  if (studyAllBtn) {
    studyAllBtn.addEventListener("click", () => ctx.studyCards(debt.map((d) => d.s.id)));
  }
  const debtList = root.querySelector("#debt-list");
  if (!debt.length) {
    debtList.innerHTML = '<div class="muted">✓ No overdue cards — you\'re all caught up.</div>';
  } else {
    debt.slice(0, 50).forEach(({ s, days, hours }) => {
      const overdue = days > 0 ? `${days}d ${hours}h overdue` : `${hours}h overdue`;
      const row = el(`
        <div class="list-row">
          <span class="title">${esc(s.title) || "(untitled)"}</span>
          <span class="cat">${esc(overdue)}</span>
          <button class="btn btn-secondary mini debt-study">Study</button>
          <button class="btn btn-accent mini debt-reset">Reset…</button>
        </div>
      `);
      row.querySelector(".debt-study").addEventListener("click", () => ctx.reviewCard(s.id));
      row.querySelector(".debt-reset").addEventListener("click", async () => {
        const level = await resetLevelDialog(`Reset "${(s.title || "untitled").slice(0, 40)}"`);
        if (!level) return;
        await ctx.api.resetCardSchedule(s.id, level);
        ctx.toast("Card schedule reset");
        ctx.refreshView();
      });
      debtList.appendChild(row);
    });
    if (debt.length > 50) {
      debtList.appendChild(el(`<div class="muted" style="padding:6px 8px">+${debt.length - 50} more</div>`));
    }
  }

  const masteryList = root.querySelector("#deck-mastery");
  if (!decks.length) {
    masteryList.innerHTML = '<div class="muted">No cards yet.</div>';
  } else {
    decks.forEach((d) => {
      masteryList.appendChild(
        el(`
        <div class="list-row">
          <span class="title">${esc(d.name)}</span>
          <span class="cat">${d.count} card${d.count === 1 ? "" : "s"}</span>
          <span class="mastery-track"><span class="mastery-fill" style="width:${d.mastery}%"></span></span>
          <span class="muted">${d.mastery}%</span>
        </div>
      `)
      );
    });
  }

  container.appendChild(root);
}
