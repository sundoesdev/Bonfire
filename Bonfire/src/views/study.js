// Study: active-recall testing. A configurable, editable, due-first queue of cards;
// each card shows a question, you type an answer, reveal + compare, then self-grade (SM-2).
import { el, esc, langBadge, metaBadges, isDue, enableTab } from "../dom.js";
import { DIFFICULTIES, getDifficulty, isFoundation, isRevealOnly } from "../constants.js";
import { highlightInto } from "../highlight.js";

const CONFIG_KEY = "daily_study";

export const DEFAULT_CONFIG = {
  timeLimitMinutes: 30,
  maxCards: 20,
  languages: [], // [] = all
  difficulties: [], // [] = all
  foundationOnly: false,
  includeTags: [], // card must have all of these
  excludeTags: [], // card must have none of these
  cram: false, // ignore due dates, draw from whole matching set
  showPreview: true, // quick-start lands on the editable preview first
};

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

// The session queue. Strict SM-2 by default: ONLY cards that are due, most overdue
// first. Cram mode ignores due dates and practices the whole matching set.
function buildQueue(shards, cfg) {
  const matches = matchingCards(shards, cfg);
  let ordered;
  if (cfg.cram) {
    ordered = [...matches].sort(
      (a, b) => diffRank(a) - diffRank(b) || (a.title || "").localeCompare(b.title || "")
    );
  } else {
    ordered = matches
      .filter(isDue)
      .sort((a, b) => (a.reviewNext || "").localeCompare(b.reviewNext || ""));
  }
  return ordered.slice(0, Math.max(1, cfg.maxCards || ordered.length));
}

// ---------- Shared config form (used by setup screen + Settings) ----------
// Returns { node, collect } where collect() reads the current values into a config object.
export function buildStudyConfigForm(ctx, cfg) {
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

  const node = el(`
    <div>
      <div class="panel">
        <div class="section-title">Session limits</div>
        <div class="form-grid">
          <label>Time limit (min)</label>
          <input type="text" id="c-time" value="${cfg.timeLimitMinutes}" />
          <label>Max cards</label>
          <input type="text" id="c-max" value="${cfg.maxCards}" />
        </div>
        <label class="chk"><input type="checkbox" id="c-cram" ${cfg.cram ? "checked" : ""}/> Cram mode (ignore due dates — practice the whole set)</label>
        <br/>
        <label class="chk"><input type="checkbox" id="c-preview" ${cfg.showPreview ? "checked" : ""}/> Show editable queue preview before starting (quick-start)</label>
      </div>
      <div class="panel">
        <div class="section-title">Languages <span class="muted">(none checked = all)</span></div>
        <div class="chk-grid">${checkList(langs, cfg.languages, "lang")}</div>
      </div>
      <div class="panel">
        <div class="section-title">Difficulty <span class="muted">(none checked = all)</span></div>
        <div class="chk-grid">${checkList(DIFFICULTIES, cfg.difficulties, "diff")}</div>
        <label class="chk" style="margin-top:8px"><input type="checkbox" id="c-foundation" ${cfg.foundationOnly ? "checked" : ""}/> Foundational cards only</label>
      </div>
      <div class="panel">
        <div class="section-title">Include tags <span class="muted">(card must have all)</span></div>
        <div class="chk-grid">${allTags.length ? checkList(allTags, cfg.includeTags, "inc") : '<span class="muted">No tags yet</span>'}</div>
      </div>
    </div>
  `);

  const readGroup = (name) =>
    [...node.querySelectorAll(`input[data-group="${name}"]:checked`)].map((c) => c.value);

  const collect = () => ({
    ...cfg,
    timeLimitMinutes: parseInt(node.querySelector("#c-time").value, 10) || 0,
    maxCards: parseInt(node.querySelector("#c-max").value, 10) || 0,
    cram: node.querySelector("#c-cram").checked,
    showPreview: node.querySelector("#c-preview").checked,
    foundationOnly: node.querySelector("#c-foundation").checked,
    languages: readGroup("lang"),
    difficulties: readGroup("diff"),
    includeTags: readGroup("inc"),
  });

  return { node, collect };
}

export async function renderStudy(container, ctx, params = {}) {
  const cfg = await loadConfig(ctx);

  // Single-card review (from the editor's Review button): one card, no timer.
  if (params.single) {
    const shard = ctx.state.shards.find((s) => s.id === params.single);
    if (!shard) {
      renderSetup(container, ctx, cfg, "That card no longer exists.");
      return;
    }
    runSession(container, ctx, cfg, [shard], {
      noTimer: true,
      onDone: () => ctx.navigate("editor", { id: shard.id }),
    });
    return;
  }

  // Quick-start: build queue now, then preview or straight into the session.
  if (params.quick) {
    const queue = buildQueue(ctx.state.shards, cfg);
    if (!queue.length) {
      renderSetup(container, ctx, cfg, "No cards are due right now. Turn on Cram mode to practice anyway.");
      return;
    }
    if (cfg.showPreview) renderPreview(container, ctx, cfg, queue);
    else runSession(container, ctx, cfg, queue);
    return;
  }

  renderSetup(container, ctx, cfg);
}

// ---------- Setup screen ----------
function renderSetup(container, ctx, cfg, notice) {
  const form = buildStudyConfigForm(ctx, cfg);

  const root = el(`
    <div>
      <div class="row" style="margin-bottom:14px">
        <h2 style="margin:0;font-size:16px">Study</h2>
        <div class="spacer"></div>
        <button class="btn btn-tool" id="save-default">Save as daily default</button>
        <button class="btn btn-primary" id="build">Build queue →</button>
      </div>
      ${notice ? `<div class="panel" style="border-color:#5a4a1f;color:#f5c451">${esc(notice)}</div>` : ""}
      <div id="form-slot"></div>
    </div>
  `);
  root.querySelector("#form-slot").appendChild(form.node);

  root.querySelector("#save-default").addEventListener("click", async () => {
    await saveConfig(ctx, form.collect());
    alert("Saved as your daily study default.");
  });

  root.querySelector("#build").addEventListener("click", () => {
    const next = form.collect();
    const queue = buildQueue(ctx.state.shards, next);
    if (!queue.length) {
      renderSetup(container, ctx, next, "No cards match — nothing due (try Cram mode) or loosen filters.");
      return;
    }
    renderPreview(container, ctx, next, queue);
  });

  container.innerHTML = "";
  container.appendChild(root);
}

// ---------- Editable queue preview ----------
function renderPreview(container, ctx, cfg, queue) {
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
          ${isRevealOnly(s.tags) ? '<span class="badge" style="background:#555">reveal</span>' : ""}
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
    root.querySelector("#start").addEventListener("click", () => runSession(container, ctx, cfg, queue));

    container.innerHTML = "";
    container.appendChild(root);
  }
  draw();
}

// ---------- Running session ----------
function runSession(container, ctx, cfg, queue, opts = {}) {
  const limitMs = opts.noTimer ? 0 : (cfg.timeLimitMinutes || 0) * 60000;
  const onDone = opts.onDone || (() => ctx.navigate("dashboard"));
  const session = {
    queue: queue.slice(),
    index: 0,
    startMs: Date.now(),
    limitMs,
    stats: { reviewed: 0, forgot: 0, advanced: 0 },
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

  function render() {
    if (session.index >= session.queue.length) {
      container.innerHTML = "";
      container.appendChild(summary());
      return;
    }
    const root = card(session.queue[session.index]);
    container.innerHTML = "";
    container.appendChild(root);
    startTimer(root);
  }

  function gradeAndAdvance(id, rating) {
    return async () => {
      try {
        await ctx.api.submitReview(id, rating);
      } catch (_e) {
        /* keep going even if persistence fails */
      }
      session.stats.reviewed++;
      if (rating === "forgot") session.stats.forgot++;
      else session.stats.advanced++;
      session.index++;
      render();
    };
  }

  function card(s) {
    const revealOnly = isRevealOnly(s.tags);
    const root = el(`
      <div>
        <div class="row progress-row">
          <span class="muted">${session.index + 1} of ${session.queue.length}</span>
          <div class="spacer"></div>
          <span id="timer" class="timer">${session.limitMs ? fmt(session.limitMs) : ""}</span>
        </div>
        <div id="time-banner" class="time-banner" style="display:none">⏰ Time's up — wrap up when you're ready.</div>
        <div class="review-card">
          <div class="row">${langBadge(s.language)} ${metaBadges(s.tags)}</div>
          <div class="title-big">${esc(s.title) || "(untitled)"}</div>
          ${s.prompt ? `<div class="desc" style="margin-bottom:6px">${esc(s.prompt)}</div>` : ""}
          <hr class="sep" />
          <div id="answer-area"></div>
          <div id="controls"></div>
        </div>
        <div class="row" style="max-width:760px;margin:0 auto;gap:8px">
          <button class="btn btn-tool" id="skip">Skip</button>
          <button class="btn btn-tool" id="end">End session</button>
          <div class="spacer"></div>
          <button class="btn btn-tool" id="toggle-queue">Queue (${session.queue.length})</button>
        </div>
        <div id="queue-panel"></div>
      </div>
    `);

    const answerArea = root.querySelector("#answer-area");
    const controls = root.querySelector("#controls");

    function showReveal(typed) {
      answerArea.innerHTML = `
        <div class="compare">
          ${
            revealOnly
              ? ""
              : `<div class="compare-col"><div class="section-title">Your answer</div><pre class="code-block"><code id="typed"></code></pre></div>`
          }
          <div class="compare-col"><div class="section-title">Answer</div><pre class="code-block"><code id="answer"></code></pre></div>
        </div>
        ${s.description ? `<div class="section-title" style="margin-top:10px">Notes</div><div class="desc">${esc(s.description)}</div>` : ""}
      `;
      if (!revealOnly) highlightInto(answerArea.querySelector("#typed"), typed || "(blank)", s.language);
      highlightInto(answerArea.querySelector("#answer"), s.code, s.language);

      controls.innerHTML = `
        <div class="muted" style="margin-top:12px">How well did you recall it?</div>
        <div class="rating">
          <button class="forgot" data-r="forgot">Forgot</button>
          <button class="hard" data-r="hard">Hard</button>
          <button class="good" data-r="good">Good</button>
          <button class="easy" data-r="easy">Easy</button>
        </div>
      `;
      controls.querySelectorAll(".rating button").forEach((b) =>
        b.addEventListener("click", gradeAndAdvance(s.id, b.dataset.r))
      );
    }

    if (revealOnly) {
      answerArea.innerHTML = '<div class="hidden-code-msg">Recall it, then reveal.</div>';
      controls.innerHTML = '<button class="btn btn-primary full-width" id="reveal">Reveal Answer</button>';
      controls.querySelector("#reveal").addEventListener("click", () => showReveal(""));
    } else {
      answerArea.innerHTML =
        '<textarea class="code-editor" id="type-answer" spellcheck="false" placeholder="Type your answer, then Submit (Ctrl+Enter)"></textarea>';
      controls.innerHTML = '<button class="btn btn-primary full-width" id="submit">Submit ▶</button>';
      const ta = answerArea.querySelector("#type-answer");
      enableTab(ta);
      const submit = () => showReveal(ta.value);
      controls.querySelector("#submit").addEventListener("click", submit);
      ta.addEventListener("keydown", (e) => {
        if (e.ctrlKey && e.key === "Enter") {
          e.preventDefault();
          submit();
        }
      });
      setTimeout(() => ta.focus(), 0);
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
        <div class="review-card">
          <div class="title-big">Session Complete</div>
          <div class="desc">Tested ${session.stats.reviewed} card(s) in ~${elapsedMin} min. ${session.stats.forgot} forgotten, ${session.stats.advanced} advanced.</div>
          <button class="btn btn-primary" id="done" style="margin-top:16px">Done</button>
        </div>
      </div>
    `);
    root.querySelector("#done").addEventListener("click", onDone);
    return root;
  }

  render();
}
