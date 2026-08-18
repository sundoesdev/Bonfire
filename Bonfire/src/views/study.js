// Study: active-recall testing. A configurable, editable, due-first queue of cards;
// each card shows a question, you type an answer, reveal + compare, then self-grade (SM-2).
import { el, esc, langBadge, metaBadges, isDue, enableTab, todayStr } from "../dom.js";
import { DIFFICULTIES, FAMILIARITY_ORDER, ALL_DECKS, getDifficulty, isFoundation, isRevealOnly, cmMode } from "../constants.js";
import { highlightInto } from "../highlight.js";
import { mdLite } from "../markdown.js";
import { confirmDialog } from "../components/confirm.js";
import { syncNow, syncAfterCard } from "../sync.js";

// Whether the CodeMirror answer editor starts in VIM mode (persisted `editor_vim`).
let vimEnabled = false;

// Card ids referenced by any playbook — used to drop them from normal study when the
// "exclude playbook cards" toggle is on. Set at the top of renderStudy each time.
let playbookIds = new Set();

// Markup for a card's attachments on one side ("question" or "answer").
function mediaHtml(media, side) {
  const items = (media || []).filter((m) => (m.side || "question") === side);
  if (!items.length) return "";
  const cells = items
    .map((m) => {
      const cap = m.caption ? `<div class="muted media-cap">${mdLite(m.caption)}</div>` : "";
      const body =
        m.kind === "image"
          ? `<img class="study-image" src="${esc(m.dataUrl)}" alt="${esc(m.caption || "image")}" />`
          : `<audio controls src="${esc(m.dataUrl)}"></audio>`;
      return `<div class="media-view-item">${body}${cap}</div>`;
    })
    .join("");
  return `<div class="study-media">${cells}</div>`;
}

const CONFIG_KEY = "daily_study";
const PROGRESS_KEY = "study_progress";

// ---- Cloze helpers ----
const CLOZE_RE = /\{\{(?:c\d+::)?([\s\S]*?)\}\}/g;

function hasClozeMarkers(text) {
  CLOZE_RE.lastIndex = 0;
  return CLOZE_RE.test(text || "");
}

// Render cloze text to escaped HTML. mode "masked" hides deletions as blanks;
// mode "reveal" shows them highlighted.
function clozeHtml(text, mode) {
  const re = new RegExp(CLOZE_RE.source, "g");
  let out = "";
  let last = 0;
  let m;
  while ((m = re.exec(text || ""))) {
    out += esc(text.slice(last, m.index));
    out +=
      mode === "masked"
        ? '<span class="cloze-blank">[ … ]</span>'
        : `<mark class="cloze-fill">${esc(m[1])}</mark>`;
    last = m.index + m[0].length;
  }
  out += esc((text || "").slice(last));
  return out;
}

// Small badge for non-basic card types shown on the study card.
function cardTypeBadge(type) {
  return type && type !== "basic" ? `<span class="badge">${esc(type)}</span>` : "";
}

export const DEFAULT_CONFIG = {
  // A session is EITHER count-based (N cards, no timer) OR time-based (timer only,
  // serve every due card) — never both (item 7).
  sessionMode: "count", // "count" | "time"
  timeLimitMinutes: 30,
  maxCards: 20,
  languages: [], // [] = all
  difficulties: [], // [] = all
  foundationOnly: false,
  includeTags: [], // card must have all of these
  excludeTags: [], // card must have none of these
  cram: false, // ignore due dates, draw from whole matching set
  hints: false, // show the per-card Hints pane while studying
  shuffle: true, // randomize the queue each session (so quitting midway varies the set)
  excludePlaybook: false, // skip cards that belong to a playbook (studied via the playbook)
  showPreview: true, // quick-start lands on the editable preview first
  limitNew: false, // cap brand-new cards introduced per day
  newPerDay: 20,
  limitReviews: false, // cap review cards per day
  reviewsPerDay: 100,
};

// Per-day study counters (new cards introduced + reviews done), reset at midnight,
// so the daily caps hold across multiple sessions in the same day.
export async function loadProgress(ctx) {
  let raw = null;
  try {
    raw = await ctx.api.getSetting(PROGRESS_KEY);
  } catch (_e) {
    /* ignore */
  }
  const today = todayStr();
  const p = raw ? JSON.parse(raw) : null;
  if (!p || p.date !== today) return { date: today, newDone: 0, reviewsDone: 0 };
  return { date: today, newDone: p.newDone || 0, reviewsDone: p.reviewsDone || 0 };
}

async function bumpProgress(ctx, isNew) {
  const p = await loadProgress(ctx);
  if (isNew) p.newDone++;
  else p.reviewsDone++;
  try {
    await ctx.api.setSetting(PROGRESS_KEY, JSON.stringify(p));
  } catch (_e) {
    /* ignore */
  }
}

// A card is "new" until it has been successfully reviewed at least once.
const isNewCard = (s) => (s.reviewRepetitions || 0) === 0;

export async function loadConfig(ctx) {
  let raw = null;
  try {
    raw = await ctx.api.getSetting(CONFIG_KEY);
  } catch (_e) {
    /* ignore */
  }
  return { ...DEFAULT_CONFIG, ...(raw ? JSON.parse(raw) : {}) };
}

export const saveConfig = (ctx, cfg) => ctx.api.setSetting(CONFIG_KEY, JSON.stringify(cfg));

// Cards matching the config's filters.
function matchingCards(shards, cfg) {
  return shards.filter((s) => {
    if (cfg.excludePlaybook && playbookIds.has(s.id)) return false;
    const tags = s.tags || [];
    if (cfg.languages.length && !cfg.languages.includes(s.language)) return false;
    if (cfg.difficulties.length && !cfg.difficulties.includes(getDifficulty(tags))) return false;
    if (cfg.foundationOnly && !isFoundation(tags)) return false;
    if (cfg.includeTags.length && !cfg.includeTags.every((t) => tags.includes(t))) return false;
    if (cfg.excludeTags.length && cfg.excludeTags.some((t) => tags.includes(t))) return false;
    return true;
  });
}

const diffRank = (s) => {
  const i = DIFFICULTIES.indexOf(getDifficulty(s.tags));
  return i === -1 ? 99 : i;
};

// Fisher–Yates shuffle in place (returns the same array).
function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// The session queue. Strict SM-2 by default: ONLY cards that are due, most overdue
// first. Cram mode ignores due dates and practices the whole matching set.
// `progress` (today's counters) lets the daily new/review caps span sessions.
// How many cards to keep in the queue: a time-based session serves every matching
// card (no count cap); a count-based session caps at maxCards (item 7).
function queueCap(cfg, len) {
  if (cfg.sessionMode === "time") return len;
  return Math.max(1, cfg.maxCards || len);
}

function buildQueue(shards, cfg, progress) {
  const matches = matchingCards(shards, cfg);
  let ordered;
  if (cfg.cram) {
    // Cram ignores both due dates and the daily caps.
    ordered = [...matches];
    if (cfg.shuffle)
      shuffleInPlace(ordered);
    else
      ordered.sort((a, b) => diffRank(a) - diffRank(b) || (a.title || "").localeCompare(b.title || ""));
    return ordered.slice(0, queueCap(cfg, ordered.length));
  }

  // Due cards. Shuffle before the cap so a capped session draws a varied subset each
  // time (quit at card 10 and next time you see different cards, not the same 10);
  // otherwise fall back to most-overdue-first.
  const due = matches.filter(isDue);
  if (cfg.shuffle) shuffleInPlace(due);
  else due.sort((a, b) => (a.reviewNext || "").localeCompare(b.reviewNext || ""));

  // Apply per-day caps, accounting for what's already been studied today.
  let allowedNew = Infinity;
  let allowedReviews = Infinity;
  if (cfg.limitNew) allowedNew = Math.max(0, (cfg.newPerDay || 0) - (progress?.newDone || 0));
  if (cfg.limitReviews)
    allowedReviews = Math.max(0, (cfg.reviewsPerDay || 0) - (progress?.reviewsDone || 0));

  let newSeen = 0;
  let reviewSeen = 0;
  ordered = due.filter((s) => {
    if (isNewCard(s)) return newSeen++ < allowedNew;
    return reviewSeen++ < allowedReviews;
  });
  return ordered.slice(0, queueCap(cfg, ordered.length));
}

// Weak-spot queue: ignores due dates and surfaces the cards you're struggling with
// most — shakiest familiarity first, then lowest SM-2 ease, then hardest difficulty.
function buildWeakQueue(shards, cfg) {
  const matches = matchingCards(shards, cfg);
  const famRank = (s) => {
    const i = FAMILIARITY_ORDER.indexOf(s.familiarity);
    return i === -1 ? 99 : i;
  };
  const ordered = [...matches].sort(
    (a, b) =>
      famRank(a) - famRank(b) ||
      (a.reviewEase || 2.5) - (b.reviewEase || 2.5) ||
      diffRank(a) - diffRank(b)
  );
  // Pick the weakest N by the ranking above, then (if shuffling) randomize just the
  // presentation order of that selected set.
  const picked = ordered.slice(0, Math.max(1, cfg.maxCards || ordered.length));
  if (cfg.shuffle) shuffleInPlace(picked);
  return picked;
}

// ---------- Shared config form (used by setup screen + Settings) ----------
// Returns { node, collect } where collect() reads the current values into a config object.
export function buildStudyConfigForm(ctx, cfg, opts = {}) {
  // The Study setup screen stays lean: only Deck/Max time/Max cards/Cram/Difficulty.
  // Daily caps, the Languages & Include-tags filters, and the preview toggle live in
  // Settings so the high-traffic screen isn't an option dump. Each is opt-in here.
  const showCaps = !!opts.showDailyCaps;
  const showFilters = !!opts.showFilters; // Languages + Include-tags panels
  const showPreviewToggle = !!opts.showPreviewToggle;
  const langs = ctx.languages();
  const allTags = [...new Set(ctx.state.shards.flatMap((s) => s.tags || []))].sort();

  const checkList = (items, selected, name) =>
    items
      .map(
        (it) =>
          `<label class="chk"><input type="checkbox" data-group="${name}" value="${esc(it)}" ${
            selected.includes(it) ? "checked" : ""
          }/> ${esc(it)}</label>`
      )
      .join("");

  // Same selected-set semantics as checkList (a hidden checkbox carries the value
  // so readGroup/collect are unchanged), rendered as on/off pill chips.
  const chipList = (items, selected, name) =>
    items
      .map(
        (it) =>
          `<label class="chip-toggle ${selected.includes(it) ? "on" : ""}"><input type="checkbox" data-group="${name}" value="${esc(it)}" ${
            selected.includes(it) ? "checked" : ""
          } hidden/> ${esc(it)}</label>`
      )
      .join("");

  const node = el(`
    <div>
      <div class="panel">
        <div class="section-title">Session limits</div>
        <div class="muted" style="margin-bottom:8px">A session is either <b>by card count</b> (study a fixed number of cards, no timer) or <b>by time</b> (study every due card until your time budget runs out) — pick one.</div>
        <div class="form-grid">
          <label>Session type</label>
          <div>
            <div class="segmented" id="c-mode-seg">
              <button type="button" class="seg ${cfg.sessionMode !== "time" ? "on" : ""}" data-mode="count">By card count</button>
              <button type="button" class="seg ${cfg.sessionMode === "time" ? "on" : ""}" data-mode="time">By time</button>
            </div>
            <select id="c-mode" hidden>
              <option value="count" ${cfg.sessionMode !== "time" ? "selected" : ""}>By card count (no timer)</option>
              <option value="time" ${cfg.sessionMode === "time" ? "selected" : ""}>By time (all due cards)</option>
            </select>
          </div>
          <label id="c-max-label">Max cards</label>
          <input type="text" id="c-max" value="${cfg.maxCards}" />
          <label id="c-time-label">Max time (min)</label>
          <input type="text" id="c-time" value="${cfg.timeLimitMinutes}" />
          ${
            showCaps
              ? `
          <label>New cards / day</label>
          <div class="row" style="gap:8px">
            <label class="chk"><input type="checkbox" id="c-limitnew" ${cfg.limitNew ? "checked" : ""}/> Limit to</label>
            <input type="text" id="c-newper" value="${cfg.newPerDay}" style="width:64px" />
          </div>
          <label>Reviews / day</label>
          <div class="row" style="gap:8px">
            <label class="chk"><input type="checkbox" id="c-limitrev" ${cfg.limitReviews ? "checked" : ""}/> Limit to</label>
            <input type="text" id="c-revper" value="${cfg.reviewsPerDay}" style="width:64px" />
          </div>`
              : ""
          }
        </div>
        <div class="muted" id="c-mode-hint" style="margin-bottom:8px"></div>
        ${
          showCaps
            ? `<div class="muted" style="margin-bottom:8px">Daily caps count new cards and reviews across all of today's sessions; Cram mode ignores them.</div>`
            : ""
        }
        <div style="margin-bottom:8px">
          <button type="button" class="btn btn-toggle ${cfg.cram ? "on" : ""}" id="c-cram">Cram mode</button>
          <div class="muted" style="margin-top:6px">Practice the whole set, ignoring due dates. Cram never changes a card's schedule, but still counts toward your heatmap and streak.</div>
        </div>
        <div style="margin-bottom:8px">
          <button type="button" class="btn btn-toggle ${cfg.hints ? "on" : ""}" id="c-hints">Hints</button>
          <div class="muted" style="margin-top:6px">Add a small notes pane beside each card while you study. Write down why you missed a card and it's waiting for you the next time that card comes up.</div>
        </div>
        <div style="margin-bottom:8px">
          <button type="button" class="btn btn-toggle ${cfg.shuffle ? "on" : ""}" id="c-shuffle">Shuffle order</button>
          <div class="muted" style="margin-top:6px">Randomize the queue each session, so if you stop midway you get a fresh mix next time instead of the same opening cards.</div>
        </div>
        <div style="margin-bottom:8px">
          <button type="button" class="btn btn-toggle ${cfg.excludePlaybook ? "on" : ""}" id="c-exclude-pb">Exclude playbook cards</button>
          <div class="muted" style="margin-top:6px">Skip cards that belong to a playbook during normal study (you follow those via their playbook instead). It never hides them from your library.</div>
        </div>
        ${
          showPreviewToggle
            ? `<div>
          <button type="button" class="btn btn-toggle ${cfg.showPreview ? "on" : ""}" id="c-preview">Queue preview</button>
          <div class="muted" style="margin-top:6px">Show the editable queue preview before a session starts. When off, quick-start (Ctrl+D) and "Build queue" drop you straight into studying.</div>
        </div>`
            : ""
        }
      </div>
      ${
        showFilters
          ? `<div class="panel">
        <div class="section-title">Languages <span class="muted">(none checked = all)</span></div>
        <div class="muted" style="margin-bottom:8px">Restrict sessions to specific languages. Leave everything unchecked to include all languages.</div>
        <div class="chk-grid">${checkList(langs, cfg.languages, "lang")}</div>
      </div>`
          : ""
      }
      <div class="panel">
        <div class="section-title">Difficulty <span class="muted">(none selected = all)</span></div>
        <div class="chip-row">
          ${chipList(DIFFICULTIES, cfg.difficulties, "diff")}
          <label class="chip-toggle ${cfg.foundationOnly ? "on" : ""}"><input type="checkbox" id="c-foundation" ${cfg.foundationOnly ? "checked" : ""} hidden/><i class="ti ti-flame"></i> foundation only</label>
        </div>
      </div>
      ${
        showFilters
          ? `<div class="panel">
        <div class="section-title">Include tags <span class="muted">(card must have all)</span></div>
        <div class="muted" style="margin-bottom:8px">Only study cards carrying every checked tag. Leave unchecked to ignore tag filtering.</div>
        <div class="chk-grid">${allTags.length ? checkList(allTags, cfg.includeTags, "inc") : '<span class="muted">No tags yet</span>'}</div>
      </div>`
          : ""
      }
    </div>
  `);

  // Toggle buttons (Cram, Queue preview) flip their own .on class.
  node.querySelectorAll(".btn-toggle").forEach((b) =>
    b.addEventListener("click", () => b.classList.toggle("on"))
  );

  // Session-type selector shows only the relevant limit field (item 7).
  const modeSel = node.querySelector("#c-mode");
  const maxLabel = node.querySelector("#c-max-label");
  const maxInput = node.querySelector("#c-max");
  const timeLabel = node.querySelector("#c-time-label");
  const timeInput = node.querySelector("#c-time");
  const modeHint = node.querySelector("#c-mode-hint");
  function syncMode() {
    const timed = modeSel.value === "time";
    maxLabel.style.display = timed ? "none" : "";
    maxInput.style.display = timed ? "none" : "";
    timeLabel.style.display = timed ? "" : "none";
    timeInput.style.display = timed ? "" : "none";
    modeHint.textContent = timed
      ? "Time-based: every due card is queued and the timer counts your budget down (and into the negative — it never hard-stops). When you clear all due cards, Hearth offers Cram to keep going until you stop."
      : "Count-based: study up to Max cards, no timer.";
  }
  modeSel.addEventListener("change", syncMode);
  syncMode();

  // Segmented session-type control drives the (hidden) #c-mode select, so syncMode
  // and collect keep reading modeSel.value — no downstream logic changes.
  const segBtns = node.querySelectorAll("#c-mode-seg .seg");
  segBtns.forEach((b) =>
    b.addEventListener("click", () => {
      modeSel.value = b.dataset.mode;
      segBtns.forEach((x) => x.classList.toggle("on", x === b));
      modeSel.dispatchEvent(new Event("change", { bubbles: true }));
    })
  );

  // Chip toggles (difficulty + foundation) mirror their hidden checkbox's state into
  // the .on class; readGroup/collect still read the checkboxes' :checked.
  node.querySelectorAll(".chip-toggle input[type=checkbox]").forEach((cb) =>
    cb.addEventListener("change", () => cb.closest(".chip-toggle").classList.toggle("on", cb.checked))
  );

  const readGroup = (name) =>
    [...node.querySelectorAll(`input[data-group="${name}"]:checked`)].map((c) => c.value);

  const collect = () => ({
    ...cfg,
    sessionMode: modeSel.value === "time" ? "time" : "count",
    timeLimitMinutes: parseInt(timeInput.value, 10) || 0,
    maxCards: parseInt(maxInput.value, 10) || 0,
    cram: node.querySelector("#c-cram").classList.contains("on"),
    hints: node.querySelector("#c-hints").classList.contains("on"),
    shuffle: node.querySelector("#c-shuffle").classList.contains("on"),
    excludePlaybook: node.querySelector("#c-exclude-pb").classList.contains("on"),
    showPreview: showPreviewToggle ? node.querySelector("#c-preview").classList.contains("on") : cfg.showPreview,
    limitNew: showCaps ? node.querySelector("#c-limitnew").checked : cfg.limitNew,
    newPerDay: showCaps ? parseInt(node.querySelector("#c-newper").value, 10) || 0 : cfg.newPerDay,
    limitReviews: showCaps ? node.querySelector("#c-limitrev").checked : cfg.limitReviews,
    reviewsPerDay: showCaps ? parseInt(node.querySelector("#c-revper").value, 10) || 0 : cfg.reviewsPerDay,
    foundationOnly: node.querySelector("#c-foundation").checked,
    languages: showFilters ? readGroup("lang") : cfg.languages,
    difficulties: readGroup("diff"),
    includeTags: showFilters ? readGroup("inc") : cfg.includeTags,
  });

  return { node, collect };
}

export async function renderStudy(container, ctx, params = {}) {
  const cfg = await loadConfig(ctx);
  playbookIds = ctx.state.playbookCardIds || new Set();
  try {
    vimEnabled = (await ctx.api.getSetting("editor_vim")) === "true";
  } catch (_e) {
    /* default off */
  }

  // Single-card review (from the editor's Review button): one card, no timer.
  if (params.single) {
    const shard = ctx.state.shards.find((s) => s.id === params.single);
    if (!shard) {
      renderSetup(container, ctx, cfg, "That card no longer exists.");
      return;
    }
    runSession(container, ctx, cfg, [shard], {
      single: true,
      onDone: async () => {
        await ctx.navigate("dashboard");
        if (params.reopen) ctx.openShard(shard.id);
      },
    });
    return;
  }

  // Study an explicit card set (e.g. "Study all" from Card Debt). The queue is
  // exactly these cards in order; studying them reschedules normally (clearing
  // their debt). Count-based (no timer) so the whole set is served, never capped.
  if (params.cards) {
    const byId = new Map(ctx.state.allShards.map((s) => [s.id, s]));
    const queue = params.cards.map((id) => byId.get(id)).filter(Boolean);
    if (!queue.length) {
      renderSetup(container, ctx, cfg, "Those cards no longer exist.");
      return;
    }
    runSession(container, ctx, { ...cfg, sessionMode: "count", cram: false }, queue, { pool: queue });
    return;
  }

  // Weak-spot drill: practice the shakiest cards regardless of due date.
  if (params.weak) {
    const queue = buildWeakQueue(ctx.state.allShards, cfg);
    if (!queue.length) {
      renderSetup(container, ctx, cfg, "No cards to drill yet.");
      return;
    }
    if (cfg.showPreview) renderPreview(container, ctx, cfg, queue, ctx.state.allShards);
    else runSession(container, ctx, cfg, queue, { pool: ctx.state.allShards });
    return;
  }

  // Quick-start (Ctrl+D): focus the daily/active deck's due cards first, holding the
  // rest of the library's due cards for the "continue to the rest" prompt at the end.
  if (params.quick) {
    const focusId = params.deckId;
    const focused = focusId && focusId !== ALL_DECKS;
    const pool = focused
      ? ctx.state.allShards.filter((s) => (s.deckIds || []).includes(focusId))
      : ctx.state.allShards;
    const rest = focused ? ctx.state.allShards.filter((s) => !(s.deckIds || []).includes(focusId)) : [];
    const progress = await loadProgress(ctx);
    const queue = buildQueue(pool, cfg, progress);
    if (!queue.length) {
      renderSetup(container, ctx, cfg, "No cards are due right now. Turn on Cram mode to practice anyway.");
      return;
    }
    if (cfg.showPreview) renderPreview(container, ctx, cfg, queue, pool, rest);
    else runSession(container, ctx, cfg, queue, { pool, restPool: rest });
    return;
  }

  renderSetup(container, ctx, cfg);
}

// ---------- Setup screen ----------
function renderSetup(container, ctx, cfg, notice) {
  const form = buildStudyConfigForm(ctx, cfg);

  // Deck picker (item 5): study the current deck, another deck, or all at once.
  const deckOpts = ['<option value="__all__">All decks</option>']
    .concat(
      ctx.decks().map(
        (d) => `<option value="${esc(d.id)}" ${d.id === ctx.currentDeckId() ? "selected" : ""}>${esc(d.name) || "(unnamed)"}</option>`
      )
    )
    .join("");

  const root = el(`
    <div>
      <div class="row" style="margin-bottom:14px;align-items:baseline">
        <div class="page-greeting">Study</div>
        <span class="muted" id="algo-note" style="margin-left:10px"></span>
      </div>
      ${notice ? `<div class="panel" style="border-color:var(--accent);background:var(--accent-soft);color:var(--text)">${esc(notice)}</div>` : ""}
      <div class="study-cols">
        <div>
          <div class="panel">
            <div class="section-title">Deck</div>
            <select id="study-deck">${deckOpts}</select>
            <div class="muted" style="margin-top:6px">Study one deck, or pick “All decks” to draw from every deck at once.</div>
          </div>
          <div id="form-slot"></div>
        </div>
        <div class="panel preview-card">
          <div class="section-title" style="text-align:left">Session preview</div>
          <div class="preview-num" id="prev-count">0</div>
          <div class="preview-cap">cards in this queue</div>
          <div class="preview-line"><span>Deck</span><b id="prev-deck"></b></div>
          <div class="preview-line"><span>Type</span><b id="prev-type"></b></div>
          <div class="preview-line"><span>Difficulty</span><b id="prev-diff"></b></div>
          <button class="btn btn-primary full-width" id="build" style="margin-top:14px"><i class="ti ti-player-play"></i> Build queue</button>
          <button class="btn btn-tool full-width" id="daily" style="margin-top:8px"><i class="ti ti-bolt"></i> Daily (Ctrl+D)</button>
          <button class="btn btn-tool full-width" id="weak" style="margin-top:8px">Drill weak spots</button>
        </div>
      </div>
    </div>
  `);
  root.querySelector("#form-slot").appendChild(form.node);

  const deckSel = root.querySelector("#study-deck");
  // Decks are filters, not scopes: derive the study pool by filtering the whole
  // library on the picked deck (no global re-scope). `restPool` is everything else,
  // held for the "continue to the rest of your cards" prompt when the deck is done.
  const studyPool = () =>
    deckSel.value === "__all__"
      ? ctx.state.allShards
      : ctx.state.allShards.filter((s) => (s.deckIds || []).includes(deckSel.value));
  const restPool = () =>
    deckSel.value === "__all__"
      ? []
      : ctx.state.allShards.filter((s) => !(s.deckIds || []).includes(deckSel.value));

  // Live session preview: queue size + summary, recomputed as the form changes.
  const prevCount = root.querySelector("#prev-count");
  const prevDeck = root.querySelector("#prev-deck");
  const prevType = root.querySelector("#prev-type");
  const prevDiff = root.querySelector("#prev-diff");
  function refreshPreview() {
    const next = form.collect();
    const matches = matchingCards(studyPool(), next);
    prevCount.textContent = queueCap(next, matches.length);
    prevDeck.textContent = deckSel.options[deckSel.selectedIndex]?.text || "";
    prevType.textContent = next.sessionMode === "time" ? "By time" : "By card count";
    prevDiff.textContent = next.foundationOnly
      ? "foundation only"
      : (next.difficulties || []).length
        ? next.difficulties.join(", ")
        : "all";
  }
  form.node.addEventListener("input", refreshPreview);
  form.node.addEventListener("change", refreshPreview);

  // The deck picker is local to this session (it never re-scopes the app): just
  // recompute the live preview from the newly selected pool.
  deckSel.addEventListener("change", refreshPreview);

  // Show which scheduling algorithm is active (set in Settings → Spaced repetition).
  ctx.api
    .getSetting("sr_algorithm")
    .then((a) => {
      const note = root.querySelector("#algo-note");
      if (note) note.textContent = `Scheduling: ${(a || "sm2").toUpperCase()}`;
    })
    .catch(() => {});

  root.querySelector("#daily").addEventListener("click", () => ctx.quickStudy());

  root.querySelector("#weak").addEventListener("click", () => {
    const next = form.collect();
    const pool = studyPool();
    const queue = buildWeakQueue(pool, next);
    if (!queue.length) {
      renderSetup(container, ctx, next, "No cards to drill — loosen the filters.");
      return;
    }
    renderPreview(container, ctx, next, queue, pool);
  });

  root.querySelector("#build").addEventListener("click", async () => {
    const next = form.collect();
    const pool = studyPool();
    const progress = await loadProgress(ctx);
    const queue = buildQueue(pool, next, progress);
    if (!queue.length) {
      renderSetup(container, ctx, next, "No cards match — nothing due (try Cram mode), daily caps reached, or loosen filters.");
      return;
    }
    renderPreview(container, ctx, next, queue, pool, restPool());
  });

  container.innerHTML = "";
  container.appendChild(root);
  refreshPreview();
}

// ---------- Editable queue preview ----------
// `pool` is the matching universe (for the timed Cram continuation offer); `restPool`
// is the rest of the library's cards (for the "continue to the rest" prompt).
function renderPreview(container, ctx, cfg, queue, pool, restPool) {
  function draw() {
    const root = el(`
      <div>
        <div class="row" style="margin-bottom:14px">
          <h2 style="margin:0;font-size:16px">Queue (${queue.length})</h2>
          <div class="spacer"></div>
          <button class="btn btn-tool" id="back">← Setup</button>
          <button class="btn btn-primary" id="start" ${queue.length ? "" : "disabled"}>Start ▶</button>
        </div>
        <div class="panel">
          <div class="row" style="margin-bottom:8px">
            <input type="text" id="add-search" class="search-input" placeholder="Add a card by title/language…" />
          </div>
          <div id="add-results"></div>
        </div>
        <div id="queue-list"></div>
      </div>
    `);

    const list = root.querySelector("#queue-list");
    if (!queue.length) {
      list.appendChild(el('<div class="empty">Queue is empty — add cards or go back to setup.</div>'));
    }
    queue.forEach((s, i) => {
      const row = el(`
        <div class="list-row">
          <span class="muted" style="width:24px">${i + 1}</span>
          ${langBadge(s.language)}
          <span class="title">${esc(s.title) || "(untitled)"}</span>
          ${metaBadges(s.tags)}
          ${isRevealOnly(s.tags) ? '<span class="badge">reveal</span>' : ""}
          <button class="btn btn-tool mini" data-act="up" ${i === 0 ? "disabled" : ""}>↑</button>
          <button class="btn btn-tool mini" data-act="down" ${i === queue.length - 1 ? "disabled" : ""}>↓</button>
          <button class="btn btn-danger mini" data-act="rm">✕</button>
        </div>
      `);
      row.querySelector('[data-act="up"]').addEventListener("click", () => {
        [queue[i - 1], queue[i]] = [queue[i], queue[i - 1]];
        draw();
      });
      row.querySelector('[data-act="down"]').addEventListener("click", () => {
        [queue[i + 1], queue[i]] = [queue[i], queue[i + 1]];
        draw();
      });
      row.querySelector('[data-act="rm"]').addEventListener("click", () => {
        queue.splice(i, 1);
        draw();
      });
      list.appendChild(row);
    });

    // Add-card search.
    const search = root.querySelector("#add-search");
    const results = root.querySelector("#add-results");
    search.addEventListener("input", () => {
      const q = search.value.trim().toLowerCase();
      results.innerHTML = "";
      if (!q) return;
      const inQueue = new Set(queue.map((s) => s.id));
      const matches = ctx.state.shards
        .filter((s) => !inQueue.has(s.id))
        .filter((s) => (s.title + " " + s.language).toLowerCase().includes(q))
        .slice(0, 8);
      matches.forEach((s) => {
        const r = el(`
          <div class="list-row">
            ${langBadge(s.language)}
            <span class="title">${esc(s.title) || "(untitled)"}</span>
            <button class="btn btn-tool mini" data-act="add">+ Add</button>
          </div>
        `);
        r.querySelector('[data-act="add"]').addEventListener("click", () => {
          queue.push(s);
          draw();
        });
        results.appendChild(r);
      });
    });

    root.querySelector("#back").addEventListener("click", () => renderSetup(container, ctx, cfg));
    root.querySelector("#start").addEventListener("click", () =>
      runSession(container, ctx, cfg, queue, { pool: pool || queue, restPool })
    );

    container.innerHTML = "";
    container.appendChild(root);
  }
  draw();
}

// ---------- Running session ----------
// opts: { single, onDone, pool, restPool }. `pool` is the matching universe the queue
// was built from — used to offer a Cram continuation when a timed session clears all
// due cards (item 7). `restPool` is the rest of the library (cards outside the focused
// deck) — used to offer "continue to the rest of your cards" when the deck is done.
function runSession(container, ctx, cfg, queue, opts = {}) {
  // A session is timed only in "time" mode (and never for a single-card review).
  const timed = cfg.sessionMode === "time" && !opts.single;
  const limitMs = timed ? (cfg.timeLimitMinutes || 0) * 60000 : 0;
  const onDone = opts.onDone || (() => ctx.navigate("dashboard"));
  const pool = opts.pool || queue;
  const restPool = opts.restPool || [];
  // Cram can be turned on mid-session by the end-of-time offer, so it's mutable.
  let cram = !!cfg.cram;
  let offeredCram = false;
  let offeredRest = false;

  // Lock navigation away while a real (non single-card) session runs (item 6).
  // Also quiet the chrome (dim the sidebar) so the card is the focus field (§11).
  if (!opts.single) {
    ctx.studyActive = true;
    ctx.endStudySession = () => finish();
    document.body.classList.add("studying");
  }

  // Pull before the session starts, so a session begun on this machine builds on
  // whatever was studied elsewhere. Not awaited — the queue is already built and
  // a slow remote must never delay the first card.
  syncNow(ctx);

  const session = {
    queue: queue.slice(),
    index: 0,
    startMs: Date.now(),
    limitMs,
    // Unique id for this session (per-day session counts in the heatmap) + the
    // moment the current card was shown (per-card time spent).
    sessionId: `sess-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    cardShownMs: Date.now(),
    stats: { reviewed: 0, forgot: 0, advanced: 0 },
    // Removes the active grade-key listener (set by showReveal); null when none.
    cleanupKeys: null,
    // Persists an edited hint before the current card goes away; null when the
    // Hints pane is off or already flushed (set by card()).
    flushHint: null,
  };

  function fmt(ms) {
    const neg = ms < 0;
    const total = Math.floor(Math.abs(ms) / 1000);
    const m = String(Math.floor(total / 60)).padStart(2, "0");
    const s = String(total % 60).padStart(2, "0");
    return `${neg ? "-" : ""}${m}:${s}`;
  }

  function startTimer(root) {
    if (!session.limitMs) return; // no limit / single review
    const tEl = root.querySelector("#timer");
    const banner = root.querySelector("#time-banner");
    const id = setInterval(() => {
      if (!document.body.contains(tEl)) {
        clearInterval(id);
        return;
      }
      const remaining = session.limitMs - (Date.now() - session.startMs);
      tEl.textContent = fmt(remaining);
      tEl.classList.toggle("overtime", remaining < 0);
      if (remaining < 0 && banner) banner.style.display = "block";
    }, 500);
  }

  // End the session for good: clear the nav lock and show the summary screen.
  function finish() {
    // The nav-lock path reaches finish() without going through render(), so save a
    // pending hint and tear down any active grade-key listener here too (item 4).
    if (session.flushHint) {
      session.flushHint();
      session.flushHint = null;
    }
    if (session.cleanupKeys) {
      session.cleanupKeys();
      session.cleanupKeys = null;
    }
    ctx.studyActive = false;
    ctx.endStudySession = null;
    document.body.classList.remove("studying");
    container.innerHTML = "";
    container.appendChild(summary());
    // Publish the session the moment it ends — completed or quit early. This is
    // what makes picking up on another machine work, and it is also what keeps
    // the conflict window down to "studied the same card on two machines during
    // overlapping sessions", which for one person is effectively impossible.
    syncNow(ctx);
  }

  // When the queue empties: first (for a deck-focused session) offer to continue to
  // the rest of the library's due cards; then, for a timed non-cram session, offer
  // to keep going in Cram until time runs out (item 7).
  function maybeFinish() {
    // Deck complete → continue to the rest of your cards?
    if (!offeredRest && restPool.length && !cram) {
      offeredRest = true;
      const studied = new Set(session.queue.map((s) => s.id));
      const more = matchingCards(restPool, cfg)
        .filter(isDue)
        .filter((s) => !studied.has(s.id));
      if (cfg.shuffle) shuffleInPlace(more);
      if (more.length) {
        confirmDialog({
          title: "Deck complete — keep going?",
          message: "You've finished this deck's due cards. Continue to the rest of your due cards?",
          confirmLabel: "Continue",
          cancelLabel: "Finish",
        }).then((yes) => {
          if (yes) {
            session.queue.push(...more);
            render();
          } else {
            finish();
          }
        });
        return;
      }
    }
    if (offeredCram || !timed || cram) {
      finish();
      return;
    }
    offeredCram = true;
    const studied = new Set(session.queue.map((s) => s.id));
    const more = buildQueue(pool, { ...cfg, cram: true }).filter((s) => !studied.has(s.id));
    if (!more.length) {
      finish();
      return;
    }
    confirmDialog({
      title: "Time-based session — keep going?",
      message:
        "You've cleared every due card. Activate Cram mode to keep practicing this set until you run out of time? (Cram never changes a card's schedule.)",
      confirmLabel: "Start cram",
      cancelLabel: "Finish",
    }).then((yes) => {
      if (yes) {
        cram = true;
        session.queue.push(...more);
        render();
      } else {
        finish();
      }
    });
  }

  function render() {
    // Save any hint edit and tear down the previous card's grade-key listener
    // (item 4) before drawing the next card, so the keys never leak onto a card
    // that hasn't been revealed yet.
    if (session.flushHint) {
      session.flushHint();
      session.flushHint = null;
    }
    if (session.cleanupKeys) {
      session.cleanupKeys();
      session.cleanupKeys = null;
    }
    if (session.index >= session.queue.length) {
      maybeFinish();
      return;
    }
    // Clear and let card() attach the new card to the live DOM *before* it wires
    // up the answer editor / controls — the wiring uses querySelector + CodeMirror,
    // which misbehave on a still-detached <template> fragment (WebKitGTK).
    session.cardShownMs = Date.now();
    container.innerHTML = "";
    let root;
    try {
      root = card(session.queue[session.index]);
    } catch (e) {
      // A single malformed card must not brick the whole session — skip it.
      try {
        ctx.toast(`Skipped a card that failed to render: ${e?.message || e}`, "error");
      } catch (_e) {
        /* ignore toast failures */
      }
      session.index++;
      render();
      return;
    }
    startTimer(root);
  }

  function gradeAndAdvance(s, rating) {
    // One grade per card render: ignore repeat/rapid clicks on the same buttons.
    let used = false;
    return () => {
      if (used) return;
      used = true;
      const wasNew = isNewCard(s);
      const durationMs = Math.max(0, Date.now() - (session.cardShownMs || Date.now()));
      // Before the review write, never after — see the note where flushHint is set.
      if (session.flushHint) session.flushHint();

      // Persist in the background. The UI advance below must NOT be gated on this:
      // a slow / hung / failed submitReview must never freeze the rating buttons.
      (async () => {
        try {
          await ctx.api.submitReview(s.id, rating, durationMs, session.sessionId, cram);
        } catch (_e) {
          /* keep going even if persistence fails */
        }
        // Count toward today's per-day caps (skip in cram, which ignores them).
        if (!cram) {
          try {
            await bumpProgress(ctx, wasNew);
          } catch (_e) {
            /* ignore */
          }
        }
        // Opt-in only (Settings → Sync). Inside the same detached block as the
        // review write, so it can never gate the UI advance either.
        syncAfterCard(ctx);
      })();

      session.stats.reviewed++;
      if (rating === "forgot" || rating === "bombed") session.stats.forgot++;
      else session.stats.advanced++;
      session.index++;
      render();
    };
  }

  function card(s) {
    const revealOnly = isRevealOnly(s.tags);
    const type = s.cardType || "basic";
    const isCloze = type === "cloze" && hasClozeMarkers(s.code);
    const isReverse = type === "reverse";
    // Highlighting follows the CARD, not the sidebar deck filter: a C card is still
    // code when the Library happens to be filtered to a prose deck. Only a card with
    // no language at all falls back to the deck preset (prose/vocab render as markdown).
    const highlight = !!s.language || ctx.currentPreset().highlight;

    // Reverse cards hide the title (it's the thing to recall); other types show it.
    const headerHtml = isReverse
      ? `<div class="title-big">Recall the title / term</div>`
      : `<div class="title-big">${esc(s.title) || "(untitled)"}</div>`;

    const reviewCardHtml = `
        <div class="review-card">
          <div class="row">${langBadge(s.language)} ${metaBadges(s.tags)} ${cardTypeBadge(type)}</div>
          ${headerHtml}
          ${s.prompt ? `<div class="desc markdown-body" style="margin-bottom:6px">${mdLite(s.prompt)}</div>` : ""}
          <div id="question-extra"></div>
          <hr class="sep" />
          <div id="answer-area"></div>
          <div id="controls"></div>
        </div>`;
    // Hints (opt-in, Settings → Study): a notes pane beside the card, readable from
    // the question phase — the whole point is to see it *before* you answer. Only
    // wrapped when it's on, so the default layout is untouched.
    const bodyHtml = cfg.hints
      ? `<div class="study-row">${reviewCardHtml}
        <aside class="hint-pane">
          <div class="section-title">Hints</div>
          <textarea id="card-hint" class="hint-input" placeholder="e.g. you need &amp; to take the address">${esc(s.hint || "")}</textarea>
          <div class="hint-help">Why you missed this last time — not the answer itself.</div>
        </aside>
      </div>`
      : reviewCardHtml;

    const root = el(`
      <div>
        <div class="row progress-row">
          <span class="muted">${session.index + 1} of ${session.queue.length}</span>
          <div class="spacer"></div>
          <span id="timer" class="timer">${session.limitMs ? fmt(session.limitMs) : ""}</span>
        </div>
        <div id="time-banner" class="time-banner" style="display:none">⏰ Time's up — wrap up when you're ready.</div>
        ${bodyHtml}
        <div class="row study-controls">
          <button class="btn btn-tool" id="skip">Skip</button>
          <button class="btn btn-tool" id="end">End session</button>
          <div class="spacer"></div>
          <button class="btn btn-tool" id="toggle-queue">Queue (${session.queue.length})</button>
        </div>
        <div id="queue-panel"></div>
      </div>
    `);

    // Attach to the live DOM before wiring. The answer editor (CodeMirror) and the
    // querySelector lookups below need the card in a real document — on a detached
    // <template> fragment they fail (e.g. #submit comes back null on WebKitGTK).
    container.appendChild(root);

    const answerArea = root.querySelector("#answer-area");
    const controls = root.querySelector("#controls");

    // Persist an edited hint when the card goes away (graded, skipped, or the
    // session ends). Writes only the hint column via setShardHint — a whole-shard
    // save from here would push this stale copy over the schedule submitReview
    // just wrote. Nulled by render()/finish() after firing.
    const hintInput = root.querySelector("#card-hint");
    if (hintInput) {
      let savedHint = s.hint || "";
      session.flushHint = () => {
        if (hintInput.value === savedHint) return;
        savedHint = hintInput.value;
        s.hint = savedHint; // keep the in-memory card in step for this session
        ctx.api.setShardHint(s.id, savedHint).catch(() => {
          /* a lost hint must never interrupt studying */
        });
      };
      hintInput.addEventListener("blur", () => session.flushHint && session.flushHint());
    }

    // Question content shown before answering: cloze blanks, or (reverse) the answer side.
    const questionExtra = root.querySelector("#question-extra");
    if (isCloze) {
      questionExtra.innerHTML = `<div class="cloze-text">${clozeHtml(s.code, "masked")}</div>`;
    } else if (isReverse) {
      questionExtra.innerHTML = '<pre class="code-block"><code id="reverse-q"></code></pre>';
      highlightInto(questionExtra.querySelector("#reverse-q"), s.code, s.language);
    }
    // Question-side attachments (shown before answering), any card type.
    questionExtra.insertAdjacentHTML("beforeend", mediaHtml(s.media, "question"));

    // CodeMirror answer editor (code decks). Hoisted so showReveal can tear it
    // down before wiping #answer-area — otherwise each card leaks an instance
    // (with its global resize/blur listeners) referencing detached DOM.
    let cm = null;

    function showReveal(typed) {
      if (cm) {
        try {
          cm.toTextArea();
        } catch (_e) {
          /* ignore disposal errors */
        }
        cm = null;
      }
      // The "correct answer" pane varies by card type.
      let answerPaneHtml;
      if (isCloze) {
        answerPaneHtml = `<div class="cloze-text reveal">${clozeHtml(s.code, "reveal")}</div>`;
      } else if (isReverse) {
        answerPaneHtml = `<pre class="code-block"><code id="answer">${esc(s.title)}</code></pre>`;
      } else if (highlight) {
        answerPaneHtml = `<pre class="code-block"><code id="answer"></code></pre>`;
      } else {
        // Prose/vocab deck: render the answer as markdown-lite, not code.
        answerPaneHtml = `<div class="markdown-body answer-prose" id="answer-prose">${mdLite(s.code)}</div>`;
      }

      answerArea.innerHTML = `
        <div class="compare">
          ${
            revealOnly
              ? ""
              : `<div class="compare-col"><div class="section-title">Your answer</div><pre class="code-block"><code id="typed"></code></pre></div>`
          }
          <div class="compare-col"><div class="section-title">Answer</div>${answerPaneHtml}</div>
        </div>
        ${mediaHtml(s.media, "answer")}
        ${s.description ? `<div class="section-title" style="margin-top:10px">Notes</div><div class="desc markdown-body">${mdLite(s.description)}</div>` : ""}
      `;
      if (!revealOnly) {
        const typedEl = answerArea.querySelector("#typed");
        // Cloze/reverse and prose answers aren't code — render the typed text plainly.
        if (isCloze || isReverse || !highlight) typedEl.textContent = typed || "(blank)";
        else highlightInto(typedEl, typed || "(blank)", s.language);
      }
      // Basic code cards highlight the stored answer; cloze/reverse/prose already filled it.
      if (!isCloze && !isReverse && highlight) {
        highlightInto(answerArea.querySelector("#answer"), s.code, s.language);
      }

      controls.innerHTML = `
        <div class="muted" style="margin-top:12px">How well did you recall it? <span class="muted-2">(keys 1–6)</span></div>
        <div class="rating">
          <button class="bombed" data-r="bombed" title="Back today — you didn't have it at all"><span class="rating-key">1</span> Bombed It</button>
          <button class="forgot" data-r="forgot"><span class="rating-key">2</span> Forgot</button>
          <button class="hard" data-r="hard"><span class="rating-key">3</span> Hard</button>
          <button class="good" data-r="good"><span class="rating-key">4</span> Good</button>
          <button class="easy" data-r="easy"><span class="rating-key">5</span> Easy</button>
          <button class="supereasy" data-r="supereasy" title="Twice as far out as Easy — this one is welded in"><span class="rating-key">6</span> Super Easy</button>
        </div>
      `;
      // Grade via click OR keys 1–6 (left→right). The keys are wired ONLY here,
      // after the answer is revealed — so typing 1234 into the answer never grades.
      // A single `graded` flag shared by both paths prevents a click+key double-fire.
      let graded = false;
      function grade(rating) {
        if (graded) return;
        graded = true;
        if (session.cleanupKeys) {
          session.cleanupKeys();
          session.cleanupKeys = null;
        }
        gradeAndAdvance(s, rating)();
      }
      controls.querySelectorAll(".rating button").forEach((b) =>
        b.addEventListener("click", () => grade(b.dataset.r))
      );
      const KEY_RATINGS = { 1: "bombed", 2: "forgot", 3: "hard", 4: "good", 5: "easy", 6: "supereasy" };
      function onGradeKey(e) {
        // A single-card review has no nav lock, so the user can leave mid-reveal and
        // strand this listener — grading a card that is no longer on screen. If the
        // controls are gone, so are we.
        if (!document.body.contains(controls)) {
          document.removeEventListener("keydown", onGradeKey);
          return;
        }
        const rating = KEY_RATINGS[e.key];
        if (!rating) return;
        // Defensive: ignore if focus is in an editable field (the answer editor is
        // already torn down on reveal, but a stray focus shouldn't grade).
        const a = document.activeElement;
        if (a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.isContentEditable)) return;
        e.preventDefault();
        grade(rating);
      }
      document.addEventListener("keydown", onGradeKey);
      session.cleanupKeys = () => document.removeEventListener("keydown", onGradeKey);
    }

    if (revealOnly) {
      answerArea.innerHTML = '<div class="hidden-code-msg">Recall it, then reveal.</div>';
      controls.innerHTML = '<button class="btn btn-primary full-width" id="reveal">Reveal Answer</button>';
      controls.querySelector("#reveal").addEventListener("click", () => showReveal(""));
    } else {
      const ph = isCloze
        ? "Type the missing word(s), then Submit (Ctrl+Enter)"
        : isReverse
          ? "Type the title / term, then Submit (Ctrl+Enter)"
          : "Type your answer, then Submit (Ctrl+Enter)";
      // Code answers (highlighting decks, non-cloze/reverse) get a CodeMirror
      // editor with live syntax highlighting + optional VIM (items 6 & 7).
      const useCM = highlight && !isCloze && !isReverse && !!window.CodeMirror;
      answerArea.innerHTML = `
        ${useCM ? `<label class="editor-vim-toggle"><input type="checkbox" id="vim-toggle" ${vimEnabled ? "checked" : ""}/> <span>VIM mode</span></label>` : ""}
        <textarea class="code-editor" id="type-answer" spellcheck="false" placeholder="${esc(ph)}"></textarea>`;
      controls.innerHTML = '<button class="btn btn-primary full-width" id="submit">Submit <span class="kbd">Ctrl + Enter</span></button>';
      const ta = answerArea.querySelector("#type-answer");
      const getValue = () => (cm ? cm.getValue() : ta.value);
      const submit = () => showReveal(getValue());
      if (useCM) {
        cm = window.CodeMirror.fromTextArea(ta, {
          mode: cmMode(s.language) || "text/plain",
          lineNumbers: false,
          lineWrapping: true,
          viewportMargin: Infinity,
          placeholder: ph,
          keyMap: vimEnabled ? "vim" : "default",
          extraKeys: { "Ctrl-Enter": submit },
        });
        const vimToggle = answerArea.querySelector("#vim-toggle");
        vimToggle.addEventListener("change", async () => {
          vimEnabled = vimToggle.checked;
          cm.setOption("keyMap", vimEnabled ? "vim" : "default");
          cm.focus();
          try {
            await ctx.api.setSetting("editor_vim", vimEnabled ? "true" : "false");
          } catch (_e) {
            /* ignore */
          }
        });
        setTimeout(() => cm.focus(), 0);
      } else {
        enableTab(ta);
        ta.addEventListener("keydown", (e) => {
          if (e.ctrlKey && e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        });
        setTimeout(() => ta.focus(), 0);
      }
      controls.querySelector("#submit").addEventListener("click", submit);
    }

    root.querySelector("#skip").addEventListener("click", () => {
      session.index++;
      render();
    });
    root.querySelector("#end").addEventListener("click", () => {
      session.index = session.queue.length;
      render();
    });

    // Collapsible queue panel: jump or remove remaining cards.
    const queuePanel = root.querySelector("#queue-panel");
    root.querySelector("#toggle-queue").addEventListener("click", () => {
      if (queuePanel.innerHTML) {
        queuePanel.innerHTML = "";
        return;
      }
      const panel = el('<div class="panel" style="margin-top:10px"></div>');
      session.queue.forEach((q, i) => {
        const r = el(`
          <div class="list-row ${i === session.index ? "current" : ""}">
            <span class="muted" style="width:24px">${i + 1}</span>
            ${langBadge(q.language)}
            <span class="title">${esc(q.title) || "(untitled)"}</span>
            <button class="btn btn-tool mini" data-act="go">Go</button>
            <button class="btn btn-danger mini" data-act="rm">✕</button>
          </div>
        `);
        r.querySelector('[data-act="go"]').addEventListener("click", () => {
          session.index = i;
          render();
        });
        r.querySelector('[data-act="rm"]').addEventListener("click", () => {
          session.queue.splice(i, 1);
          if (session.index > i) session.index--;
          render();
        });
        panel.appendChild(r);
      });
      queuePanel.appendChild(panel);
    });

    return root;
  }

  function summary() {
    const elapsedMin = Math.round((Date.now() - session.startMs) / 60000);
    const root = el(`
      <div>
        <div class="review-card" style="text-align:center">
          <div class="title-big">Embers warm</div>
          <div class="desc">You reviewed ${session.stats.reviewed} shard${session.stats.reviewed === 1 ? "" : "s"} today${elapsedMin ? ` in ~${elapsedMin} min` : ""}. ${session.stats.advanced} advanced${session.stats.forgot ? `, ${session.stats.forgot} to revisit` : ""}.</div>
          <button class="btn btn-primary" id="done" style="margin-top:16px">Done</button>
        </div>
      </div>
    `);
    root.querySelector("#done").addEventListener("click", onDone);
    return root;
  }

  render();
}
