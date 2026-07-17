// Settings: decks, study-session defaults, appearance (theme/font/scale), and data tools.
import { el, esc, enableTab } from "../dom.js";
import { exportVault, importVault } from "../data.js";
import { FONTS, SCALES, appearance, setAppearance } from "../theme.js";
import { buildStudyConfigForm, loadConfig, saveConfig } from "./study.js";
import {
  PRESET_OPTIONS,
  DEBT_DECK_ID,
  isNativeDeck,
  SR_ALGORITHMS,
  DEFAULT_ALGORITHM,
  SM2_DEFAULTS,
  FSRS_DEFAULTS,
  cardTypeOptions,
  getDifficulty,
  SPECIAL_TAGS,
} from "../constants.js";
import { loadTemplates, saveTemplates, isBuiltin } from "../templates.js";

// Read a JSON settings blob, falling back to `dflt` on miss/parse error.
async function loadJsonSetting(ctx, key, dflt) {
  try {
    const raw = await ctx.api.getSetting(key);
    if (raw) return { ...dflt, ...JSON.parse(raw) };
  } catch (_e) {
    /* ignore */
  }
  return { ...dflt };
}

const DELETE_PHRASE = "are you absolutely super dupe sure you want to delete every card?";

const presetOptionsHtml = (current) =>
  PRESET_OPTIONS.map(
    (p) => `<option value="${esc(p.id)}" ${p.id === current ? "selected" : ""}>${esc(p.label)}</option>`
  ).join("");

export async function renderSettings(container, ctx) {
  const cfg = await loadConfig(ctx);
  const form = buildStudyConfigForm(ctx, cfg, {
    showDailyCaps: true,
    showFilters: true,
    showPreviewToggle: true,
  });

  // Spaced-repetition settings.
  const algorithm = (await ctx.api.getSetting("sr_algorithm")) || DEFAULT_ALGORITHM;
  const sm2p = await loadJsonSetting(ctx, "sm2_params", SM2_DEFAULTS);
  const fsrsp = await loadJsonSetting(ctx, "fsrs_params", FSRS_DEFAULTS);
  const vimOn = (await ctx.api.getSetting("editor_vim")) === "true";
  const dailyDeck = (await ctx.api.getSetting("daily_deck")) || "";
  const hideNative = (await ctx.api.getSetting("hide_native_decks")) === "true";
  const savedTab = (await ctx.api.getSetting("settings_tab")) || "appearance";

  const sel = (id, items, current) =>
    `<select id="${id}">${items
      .map((o) => `<option value="${esc(o.id)}" ${o.id === current ? "selected" : ""}>${esc(o.label)}</option>`)
      .join("")}</select>`;

  const root = el(`
    <div>
      <div class="page-greeting" style="margin-bottom:14px">Settings</div>

      <div class="settings-tabs" role="tablist">
        <button type="button" class="settings-tab-btn active" data-tab="appearance"><i class="ti ti-palette"></i>Appearance</button>
        <button type="button" class="settings-tab-btn" data-tab="study"><i class="ti ti-player-play"></i>Study</button>
        <button type="button" class="settings-tab-btn" data-tab="decks"><i class="ti ti-stack-2"></i>Decks</button>
        <button type="button" class="settings-tab-btn" data-tab="scheduling"><i class="ti ti-clock"></i>Scheduling</button>
        <button type="button" class="settings-tab-btn" data-tab="templates"><i class="ti ti-template"></i>Templates</button>
        <button type="button" class="settings-tab-btn" data-tab="data"><i class="ti ti-database"></i>Data</button>
        <button type="button" class="settings-tab-btn" data-tab="integrity"><i class="ti ti-shield-check"></i>Integrity</button>
      </div>

      <section class="settings-tab" data-tab="integrity">
      <div class="section-title">Card integrity</div>
      <div class="panel">
        <div class="muted" style="margin-bottom:8px">Every card should belong to at least one deck and carry a difficulty. Any that don't are listed here — click <b>Fix</b> to open and correct one. Adding a descriptive <b>topic tag</b> (e.g. <code>networking</code>) is recommended but optional; cards missing one are listed separately as a gentle suggestion.</div>
        <div id="integrity-list"></div>
      </div>
      </section>

      <section class="settings-tab active" data-tab="appearance">
      <div class="section-title">Appearance</div>
      <div class="panel">
        <div class="muted" style="margin-bottom:8px"><b>Theme</b> sets the colour palette — a warm <b>Light</b> (cream &amp; ember) or <b>Dark</b> (coal &amp; ember). It applies across the whole app, including syntax highlighting. <b>UI font</b> changes the interface typeface (headings always use the brand serif). <b>UI scale</b> zooms the entire interface. Changes apply instantly and are remembered.</div>
        <div class="form-grid">
          <label>Theme</label>
          <div class="theme-toggle" id="set-theme">
            <button type="button" class="theme-swatch ${appearance.theme === "dark" ? "" : "on"}" data-theme="light"><span class="theme-chip light"></span>Light</button>
            <button type="button" class="theme-swatch ${appearance.theme === "dark" ? "on" : ""}" data-theme="dark"><span class="theme-chip dark"></span>Dark</button>
          </div>
          <label>UI font</label>${sel("set-font", FONTS, appearance.font)}
          <label>UI scale</label>${sel("set-scale", SCALES, appearance.scale)}
        </div>
      </div>

      <div class="section-title">Editor</div>
      <div class="panel">
        <div class="muted" style="margin-bottom:8px">Adds VIM keybindings to the syntax-highlighted code answer editor during study. You can also toggle it while answering a question.</div>
        <button type="button" class="btn btn-toggle ${vimOn ? "on" : ""}" id="set-vim">VIM mode in the answer editor</button>
      </div>
      </section>

      <section class="settings-tab" data-tab="decks">
      <div class="section-title">Decks</div>
      <div class="panel">
        <div class="muted" style="margin-bottom:8px">A deck's preset controls its fields — the <b>Code</b> preset shows the Language field and syntax highlighting; other presets hide them so you can study any subject. Cards in a deleted deck move to the default deck. Star one deck as your <b>daily default</b> — the Ctrl+D quick-start studies it. The built-in <b>Default</b> and <b>Debt</b> decks (greyed) are required by Hearth — they can't be renamed or deleted, but you can change their preset or make one your daily default.</div>
        <div class="row" style="margin-bottom:10px;gap:10px;align-items:center">
          <button type="button" class="btn btn-toggle ${hideNative ? "on" : ""}" id="toggle-native">Hide built-in decks</button>
          <div class="spacer"></div>
          <label for="daily-deck-select" class="muted">Daily deck (Ctrl+D)</label>
          <select id="daily-deck-select"></select>
        </div>
        <div id="deck-list"></div>
        <hr style="border:none;border-top:1px solid var(--border);margin:12px 0" />
        <div class="row">
          <input type="text" id="new-deck-name" placeholder="New deck name, e.g. World History" style="flex:1" />
          <select id="new-deck-preset">${presetOptionsHtml("prose")}</select>
          <button class="btn btn-primary" id="add-deck">Add deck</button>
        </div>
      </div>
      </section>

      <section class="settings-tab" data-tab="scheduling">
      <div class="section-title">Spaced repetition</div>
      <div class="panel">
        <div class="muted" style="margin-bottom:8px">The scheduling algorithm applies to every deck. <b>SM-2</b> is the classic SuperMemo scheme; <b>FSRS</b> is a modern memory model that adapts intervals from a stability/difficulty estimate per card.</div>
        <div class="form-grid">
          <label>Algorithm</label>${sel("set-algo", SR_ALGORITHMS, algorithm)}
        </div>
        <div id="sm2-knobs" class="form-grid" style="margin-top:8px">
          <label>Ease floor</label><input type="number" id="sm2-ease-floor" step="0.05" min="1.1" max="2.5" value="${esc(sm2p.easeFloor)}" />
          <label>Interval modifier</label><input type="number" id="sm2-interval-mod" step="0.05" min="0.5" max="2" value="${esc(sm2p.intervalModifier)}" />
          <label>Hard multiplier</label><input type="number" id="sm2-hard-mult" step="0.05" min="1" max="2" value="${esc(sm2p.hardMultiplier)}" />
        </div>
        <div id="fsrs-knobs" class="form-grid" style="margin-top:8px">
          <label>Request retention</label><input type="number" id="fsrs-retention" step="0.01" min="0.7" max="0.97" value="${esc(fsrsp.requestRetention)}" />
          <label>Weights (17, comma-separated)</label><textarea id="fsrs-weights" style="min-height:54px" spellcheck="false">${esc((fsrsp.weights || FSRS_DEFAULTS.weights).join(", "))}</textarea>
        </div>
        <div class="row" style="margin-top:10px">
          <button class="btn btn-primary" id="save-sr">Save spaced-repetition settings</button>
          <button class="btn btn-tool" id="reset-sr">Reset to defaults</button>
        </div>
      </div>
      </section>

      <section class="settings-tab" data-tab="templates">
      <div class="section-title">Card templates</div>
      <div class="panel">
        <div class="muted" style="margin-bottom:8px">Reusable field presets for fast authoring. Pick one from the <b>Template…</b> menu in the editor or quick-capture. Built-in templates can't be edited.</div>
        <div id="template-list"></div>
        <hr style="border:none;border-top:1px solid var(--border);margin:12px 0" />
        <button class="btn btn-primary" id="add-template">Add template…</button>
      </div>
      </section>

      <section class="settings-tab" data-tab="study">
      <div class="section-title">Study session defaults</div>
      <div class="panel" style="margin-bottom:8px;display:flex;flex-direction:column;gap:8px">
        <div class="muted">Saves the session limits and filters set below as your defaults. The daily quick-start (Ctrl+D) then launches straight into a session using these settings — studying your daily-default deck (set above) — without asking you to configure it each time. The Study screen shows a trimmed version of these controls; the full set (daily caps, language &amp; tag filters, queue preview) lives here.</div>
        <div><button class="btn btn-primary" id="save-study">Save study defaults</button></div>
      </div>
      <div id="study-slot"></div>
      </section>

      <section class="settings-tab" data-tab="data">
      <div class="section-title" style="margin-top:6px">Data</div>
      <div class="panel">
        <div class="muted" style="margin-bottom:8px"><b>Export</b> writes every card, deck, and your full review history to a single JSON file (your backup — attachments are embedded, so the file can get large). <b>Import</b> loads cards and decks from such a file; review history is only restored into an empty log, so re-importing won't double-count your stats.</div>
        <div class="vlist">
          <button class="btn btn-tool" id="export">Export all to JSON</button>
          <button class="btn btn-tool" id="import">Import from JSON</button>
        </div>
        <hr style="border:none;border-top:1px solid var(--border);margin:14px 0" />
        <div class="muted-2" style="margin-bottom:8px">Danger zone — these cannot be undone.</div>
        <div class="muted" style="margin-bottom:6px">Wipe all stats clears your heatmap, streaks, and activity totals. Card scheduling and the projected-retention chart are unaffected.</div>
        <button class="btn btn-danger" id="wipe-stats" style="margin-bottom:12px">Wipe all stats…</button>
        <div class="muted" style="margin-bottom:6px">Delete all cards permanently removes every card (across all decks).</div>
        <button class="btn btn-danger" id="delete-all">Delete all cards…</button>
      </div>
      </section>
    </div>
  `);

  root.querySelector("#study-slot").appendChild(form.node);

  renderIntegrity(root, ctx);
  renderDecks(root, ctx, dailyDeck, hideNative);

  // Dedicated daily-deck picker: lists every deck (incl. the built-in Default),
  // independent of the "Hide built-in decks" toggle — so Default is always selectable
  // as the Ctrl+D quick-start deck. The auto Debt deck is excluded.
  const dailyDeckSelect = root.querySelector("#daily-deck-select");
  dailyDeckSelect.innerHTML =
    `<option value="">None</option>` +
    ctx
      .decks()
      .filter((d) => d.id !== DEBT_DECK_ID)
      .map((d) => `<option value="${esc(d.id)}" ${d.id === dailyDeck ? "selected" : ""}>${esc(d.name) || "(unnamed)"}</option>`)
      .join("");
  dailyDeckSelect.addEventListener("change", async () => {
    await ctx.api.setSetting("daily_deck", dailyDeckSelect.value);
    ctx.toast(dailyDeckSelect.value ? "Daily deck set" : "Daily deck cleared");
    ctx.navigate("settings");
  });

  root.querySelector("#toggle-native").addEventListener("click", async (e) => {
    const on = e.currentTarget.classList.toggle("on");
    await ctx.api.setSetting("hide_native_decks", on ? "true" : "false");
    renderDecks(root, ctx, dailyDeck, on);
  });
  root.querySelector("#add-deck").addEventListener("click", async () => {
    const nameEl = root.querySelector("#new-deck-name");
    const name = nameEl.value.trim();
    if (!name) {
      alert("Deck name is required.");
      return;
    }
    await ctx.api.saveDeck({ name, preset: root.querySelector("#new-deck-preset").value });
    ctx.toast("Deck added");
    ctx.navigate("settings");
  });

  // Appearance handlers (apply + persist immediately).
  root.querySelectorAll("#set-theme .theme-swatch").forEach((b) =>
    b.addEventListener("click", () => {
      root.querySelectorAll("#set-theme .theme-swatch").forEach((x) => x.classList.toggle("on", x === b));
      setAppearance("theme", b.dataset.theme);
    })
  );
  root.querySelector("#set-font").addEventListener("change", (e) => setAppearance("font", e.target.value));
  root.querySelector("#set-scale").addEventListener("change", (e) => setAppearance("scale", e.target.value));
  root.querySelector("#set-vim").addEventListener("click", (e) => {
    const on = e.currentTarget.classList.toggle("on");
    ctx.api.setSetting("editor_vim", on ? "true" : "false");
    ctx.toast("Editor setting saved");
  });

  root.querySelector("#save-study").addEventListener("click", async () => {
    await saveConfig(ctx, form.collect());
    ctx.toast("Study defaults saved");
  });

  // ---- Spaced-repetition settings ----
  const algoSel = root.querySelector("#set-algo");
  const sm2Knobs = root.querySelector("#sm2-knobs");
  const fsrsKnobs = root.querySelector("#fsrs-knobs");
  const syncAlgoKnobs = () => {
    const fsrs = algoSel.value === "fsrs";
    sm2Knobs.style.display = fsrs ? "none" : "";
    fsrsKnobs.style.display = fsrs ? "" : "none";
  };
  algoSel.addEventListener("change", syncAlgoKnobs);
  syncAlgoKnobs();

  root.querySelector("#save-sr").addEventListener("click", async () => {
    const num = (id, dflt) => {
      const v = parseFloat(root.querySelector(id).value);
      return Number.isFinite(v) ? v : dflt;
    };
    const weights = root
      .querySelector("#fsrs-weights")
      .value.split(",")
      .map((x) => parseFloat(x.trim()))
      .filter((x) => Number.isFinite(x));
    if (weights.length !== FSRS_DEFAULTS.weights.length) {
      alert(`FSRS needs exactly ${FSRS_DEFAULTS.weights.length} weights (got ${weights.length}).`);
      return;
    }
    await ctx.api.setSetting("sr_algorithm", algoSel.value);
    await ctx.api.setSetting(
      "sm2_params",
      JSON.stringify({
        easeFloor: num("#sm2-ease-floor", SM2_DEFAULTS.easeFloor),
        intervalModifier: num("#sm2-interval-mod", SM2_DEFAULTS.intervalModifier),
        hardMultiplier: num("#sm2-hard-mult", SM2_DEFAULTS.hardMultiplier),
      })
    );
    await ctx.api.setSetting(
      "fsrs_params",
      JSON.stringify({ requestRetention: num("#fsrs-retention", FSRS_DEFAULTS.requestRetention), weights })
    );
    ctx.toast("Spaced-repetition settings saved");
  });
  root.querySelector("#reset-sr").addEventListener("click", async () => {
    if (!confirm("Reset spaced-repetition settings to defaults?")) return;
    await ctx.api.setSetting("sr_algorithm", DEFAULT_ALGORITHM);
    await ctx.api.setSetting("sm2_params", JSON.stringify(SM2_DEFAULTS));
    await ctx.api.setSetting("fsrs_params", JSON.stringify(FSRS_DEFAULTS));
    ctx.toast("Settings reset to defaults");
    ctx.navigate("settings");
  });

  // ---- Card templates ----
  await renderTemplates(root, ctx);
  root.querySelector("#add-template").addEventListener("click", () => {
    templateModal(ctx, null, () => renderTemplates(root, ctx));
  });

  root.querySelector("#export").addEventListener("click", () => exportVault(ctx));
  root.querySelector("#import").addEventListener("click", async () => {
    await importVault(ctx);
    ctx.navigate("settings");
  });

  root.querySelector("#wipe-stats").addEventListener("click", () => confirmWipeStats(ctx));
  root.querySelector("#delete-all").addEventListener("click", () => confirmDeleteAll(ctx));

  // Tab switching: only one group is visible at a time. Every control stays in the
  // DOM (just inside a hidden section), so the querySelector-wired handlers above
  // keep working regardless of which tab is active.
  const tabBtns = [...root.querySelectorAll(".settings-tab-btn")];
  const tabSecs = [...root.querySelectorAll(".settings-tab")];
  function showTab(name) {
    tabBtns.forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
    tabSecs.forEach((s) => s.classList.toggle("active", s.dataset.tab === name));
    ctx.api.setSetting("settings_tab", name).catch(() => {});
  }
  tabBtns.forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
  showTab(tabBtns.some((b) => b.dataset.tab === savedTab) ? savedTab : "appearance");

  container.innerHTML = "";
  container.appendChild(root);
}

// Scan all cards for organization gaps (item 2). HARD issues — no real deck or no
// difficulty — are listed as errors with a Fix button. Missing a free-form *topic*
// tag is a SOFT suggestion (item 1, notes-03): grouped separately and de-emphasized,
// since difficulty is auto-stamped and a descriptive tag is optional.
function renderIntegrity(root, ctx) {
  const list = root.querySelector("#integrity-list");
  list.innerHTML = "";

  const hard = []; // { s, issues } — no deck / no difficulty
  const topicless = []; // cards that are otherwise fine but carry no topic tag
  ctx.state.allShards.forEach((s) => {
    const tags = s.tags || [];
    const issues = [];
    // A card needs a *real* organizing deck — the auto Debt deck doesn't count.
    if (!(s.deckIds || []).some((id) => id !== DEBT_DECK_ID)) issues.push("no deck");
    if (!getDifficulty(tags)) issues.push("no difficulty");
    if (issues.length) hard.push({ s, issues });
    // Topic tag = any tag that isn't a reserved keyword tag.
    if (!tags.some((t) => !SPECIAL_TAGS.has(t))) topicless.push(s);
  });

  // ---- Hard issues ----
  if (!hard.length) {
    list.appendChild(el('<div class="muted">✓ Every card has a deck and a difficulty.</div>'));
  } else {
    hard.forEach(({ s, issues }) => {
      const row = el(`
        <div class="list-row">
          <span class="title">${esc(s.title) || "(untitled)"}</span>
          <span class="cat">${esc(issues.join(", "))}</span>
          <button class="btn btn-accent mini">Fix</button>
        </div>
      `);
      row.querySelector("button").addEventListener("click", () => ctx.openShard(s.id));
      list.appendChild(row);
    });
  }

  // ---- Soft suggestion: cards with no topic tag ----
  if (topicless.length) {
    list.appendChild(
      el(
        `<div class="muted-2" style="margin-top:12px;margin-bottom:6px">Suggestion — ${topicless.length} card${
          topicless.length === 1 ? "" : "s"
        } ha${topicless.length === 1 ? "s" : "ve"} no topic tag. Adding one (e.g. <code>networking</code>) makes them easier to find and filter, but it's optional.</div>`
      )
    );
    topicless.forEach((s) => {
      const row = el(`
        <div class="list-row">
          <span class="title muted">${esc(s.title) || "(untitled)"}</span>
          <button class="btn btn-tool mini">Add tag</button>
        </div>
      `);
      row.querySelector("button").addEventListener("click", () => ctx.openShard(s.id));
      list.appendChild(row);
    });
  }
}

// Render the editable list of decks (rename, change preset, delete, set daily).
// `hideNative` drops the built-in Default/Debt decks from the list (item 2).
function renderDecks(root, ctx, dailyDeck = "", hideNative = false) {
  const list = root.querySelector("#deck-list");
  let decks = ctx.decks();
  if (hideNative) decks = decks.filter((d) => !isNativeDeck(d.id));
  list.innerHTML = "";

  if (!decks.length) {
    list.appendChild(el('<div class="muted">No user-created decks yet. Add one below.</div>'));
    return;
  }

  decks.forEach((d) => {
    const isDebt = d.id === DEBT_DECK_ID;
    // Native decks (Default/Debt) ship with Bonfire: greyed, no rename, no delete.
    const isProtected = isNativeDeck(d.id);
    const isDaily = d.id === dailyDeck;
    const count = ctx.state.allShards.filter((s) => (s.deckIds || []).includes(d.id)).length;
    const row = el(`
      <div class="list-row ${isProtected ? "native-deck" : ""}">
        <span class="title">${esc(d.name) || "(unnamed)"}</span>
        ${isProtected ? `<span class="badge" title="Built-in deck — required by Hearth, can't be renamed or deleted">${isDebt ? "auto" : "built-in"}</span>` : ""}
        <span class="cat">${count} card${count === 1 ? "" : "s"}</span>
        ${
          isDaily
            ? '<span class="badge daily-badge" title="Ctrl+D quick-start studies this deck">★ daily</span>'
            : '<button class="btn btn-secondary mini deck-daily" title="Make this the Ctrl+D quick-start deck">Set daily</button>'
        }
        <select class="deck-preset">${presetOptionsHtml(d.preset)}</select>
        ${isProtected ? "" : '<button class="btn btn-accent mini deck-rename">Rename</button>'}
        ${isProtected ? "" : '<button class="btn btn-danger mini deck-del">Delete</button>'}
      </div>
    `);

    row.querySelector(".deck-preset").addEventListener("change", async (e) => {
      await ctx.api.saveDeck({ ...d, preset: e.target.value });
      ctx.toast("Deck updated");
      ctx.navigate("settings");
    });
    const dailyBtn = row.querySelector(".deck-daily");
    if (dailyBtn) {
      dailyBtn.addEventListener("click", async () => {
        await ctx.api.setSetting("daily_deck", d.id);
        ctx.toast("Daily deck set");
        ctx.navigate("settings");
      });
    }
    const rename = row.querySelector(".deck-rename");
    if (rename) {
      rename.addEventListener("click", async () => {
        const name = prompt("Rename deck:", d.name);
        if (name && name.trim() && name.trim() !== d.name) {
          await ctx.api.saveDeck({ ...d, name: name.trim() });
          ctx.toast("Deck renamed");
          ctx.navigate("settings");
        }
      });
    }
    const del = row.querySelector(".deck-del");
    if (del) {
      del.addEventListener("click", async () => {
        const msg = count
          ? `Delete "${d.name}"? Its ${count} card(s) will move to the default deck.`
          : `Delete "${d.name}"?`;
        if (confirm(msg)) {
          await ctx.api.deleteDeck(d.id);
          ctx.toast("Deck deleted");
          ctx.navigate("settings");
        }
      });
    }
    list.appendChild(row);
  });
}

// Render the list of card templates (built-ins are read-only).
async function renderTemplates(root, ctx) {
  const list = root.querySelector("#template-list");
  const templates = await loadTemplates(ctx);
  list.innerHTML = "";
  templates.forEach((t) => {
    const builtin = isBuiltin(t);
    const meta = [t.cardType, t.language].filter(Boolean).join(" · ");
    const row = el(`
      <div class="list-row">
        <span class="title">${esc(t.name) || "(unnamed)"}</span>
        <span class="cat">${esc(meta)}</span>
        ${
          builtin
            ? '<span class="muted">built-in</span>'
            : '<button class="btn btn-accent mini template-edit">Edit</button><button class="btn btn-danger mini template-del">Delete</button>'
        }
      </div>
    `);
    const edit = row.querySelector(".template-edit");
    if (edit) {
      edit.addEventListener("click", () => templateModal(ctx, t, () => renderTemplates(root, ctx)));
      row.querySelector(".template-del").addEventListener("click", async () => {
        if (!confirm(`Delete template "${t.name}"?`)) return;
        const remaining = (await loadTemplates(ctx)).filter((x) => x.id !== t.id);
        await saveTemplates(ctx, remaining);
        ctx.toast("Template deleted");
        renderTemplates(root, ctx);
      });
    }
    list.appendChild(row);
  });
}

// Create/edit a custom template in a modal. `existing` is null for a new one.
function templateModal(ctx, existing, onDone) {
  const root = document.querySelector("#modal-root");
  if (root.querySelector(".modal-backdrop")) return;
  const t = existing || { id: "", name: "", cardType: "basic", language: "", tags: "", prompt: "", code: "", description: "" };

  const backdrop = el(`
    <div class="modal-backdrop">
      <div class="modal">
        <h2>${existing ? "Edit" : "New"} template</h2>
        <div class="field"><label>Name *</label><input type="text" id="t-name" value="${esc(t.name)}" placeholder="e.g. Python function" /></div>
        <div class="field"><label>Card type</label><select id="t-cardtype">${cardTypeOptions(t.cardType)}</select></div>
        <div class="field"><label>Language</label><input type="text" id="t-lang" value="${esc(t.language)}" placeholder="(optional)" /></div>
        <div class="field"><label>Tags</label><input type="text" id="t-tags" value="${esc(t.tags)}" placeholder="comma-separated" /></div>
        <div class="field"><label>Prompt</label><textarea id="t-prompt" style="min-height:48px">${esc(t.prompt)}</textarea></div>
        <div class="field"><label>Answer / code</label><textarea id="t-code" class="code-editor" style="min-height:90px" spellcheck="false">${esc(t.code)}</textarea></div>
        <div class="field"><label>Description</label><textarea id="t-desc" style="min-height:48px">${esc(t.description)}</textarea></div>
        <div class="actions">
          <button class="btn btn-tool" id="t-cancel">Cancel</button>
          <button class="btn btn-primary" id="t-save">Save template</button>
        </div>
      </div>
    </div>
  `);
  enableTab(backdrop.querySelector("#t-code"));

  function close() {
    root.innerHTML = "";
    document.removeEventListener("keydown", onKey);
  }
  function onKey(e) {
    if (e.key === "Escape") close();
  }
  backdrop.querySelector("#t-cancel").addEventListener("click", close);
  backdrop.addEventListener("mousedown", (e) => {
    if (e.target === backdrop) close();
  });
  backdrop.querySelector("#t-save").addEventListener("click", async () => {
    const name = backdrop.querySelector("#t-name").value.trim();
    if (!name) {
      alert("Template name is required.");
      return;
    }
    const updated = {
      id: t.id || `tpl-${Date.now().toString(36)}`,
      name,
      cardType: backdrop.querySelector("#t-cardtype").value,
      language: backdrop.querySelector("#t-lang").value.trim(),
      tags: backdrop.querySelector("#t-tags").value.trim(),
      prompt: backdrop.querySelector("#t-prompt").value,
      code: backdrop.querySelector("#t-code").value,
      description: backdrop.querySelector("#t-desc").value,
    };
    const all = await loadTemplates(ctx);
    const custom = all.filter((x) => !isBuiltin(x) && x.id !== updated.id);
    custom.push(updated);
    await saveTemplates(ctx, custom);
    ctx.toast("Template saved");
    close();
    if (onDone) onDone();
  });

  root.appendChild(backdrop);
  document.addEventListener("keydown", onKey);
  backdrop.querySelector("#t-name").focus();
}

// Single-confirm gate for wiping the study stats (review_log). Lighter than the
// delete-all card gate — stats are recoverable by studying again, cards aren't.
function confirmWipeStats(ctx) {
  const root = document.querySelector("#modal-root");
  if (root.querySelector(".modal-backdrop")) return;

  const backdrop = el(`
    <div class="modal-backdrop">
      <div class="modal">
        <h2>Wipe all stats?</h2>
        <div class="desc" style="margin-bottom:12px">This clears your <b>heatmap</b>, <b>streaks</b>, and <b>activity totals</b> (your entire review history). Your cards and their scheduling, plus the projected-retention chart, are <b>not</b> affected. This cannot be undone.</div>
        <div class="actions">
          <button class="btn btn-secondary" id="wipe-cancel">Cancel</button>
          <button class="btn btn-danger" id="wipe-confirm">Wipe stats</button>
        </div>
      </div>
    </div>
  `);

  function close() {
    root.innerHTML = "";
    document.removeEventListener("keydown", onKey);
  }
  function onKey(e) {
    if (e.key === "Escape") close();
  }
  async function doWipe() {
    await ctx.api.clearReviewLog();
    close();
    ctx.toast("Study stats wiped");
  }
  backdrop.querySelector("#wipe-confirm").addEventListener("click", doWipe);
  backdrop.querySelector("#wipe-cancel").addEventListener("click", close);
  backdrop.addEventListener("mousedown", (e) => {
    if (e.target === backdrop) close();
  });

  root.appendChild(backdrop);
  document.addEventListener("keydown", onKey);
}

// Typed-phrase confirmation gate for deleting every card.
function confirmDeleteAll(ctx) {
  const root = document.querySelector("#modal-root");
  if (root.querySelector(".modal-backdrop")) return;

  const backdrop = el(`
    <div class="modal-backdrop">
      <div class="modal">
        <h2>Delete ALL cards?</h2>
        <div class="desc" style="margin-bottom:10px">This permanently deletes every card. It cannot be undone. To confirm, type the phrase below exactly and press Enter:</div>
        <div class="code-block" style="min-height:0;margin-bottom:10px;color:var(--text)">${esc(DELETE_PHRASE)}</div>
        <input type="text" id="del-phrase" placeholder="Type the phrase…" autocomplete="off" />
        <div class="actions">
          <button class="btn btn-tool" id="del-cancel">Cancel</button>
          <button class="btn btn-danger" id="del-confirm" disabled>Delete everything</button>
        </div>
      </div>
    </div>
  `);

  const input = backdrop.querySelector("#del-phrase");
  const confirmBtn = backdrop.querySelector("#del-confirm");

  const matches = () => input.value.trim().toLowerCase() === DELETE_PHRASE;

  function close() {
    root.innerHTML = "";
    document.removeEventListener("keydown", onKey);
  }
  function onKey(e) {
    if (e.key === "Escape") close();
  }
  async function doDelete() {
    if (!matches()) return;
    const n = await ctx.api.deleteAllShards();
    close();
    ctx.toast(`Deleted ${n} card${n === 1 ? "" : "s"}`);
    ctx.navigate("dashboard");
  }

  input.addEventListener("input", () => {
    confirmBtn.disabled = !matches();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      doDelete();
    }
  });
  backdrop.querySelector("#del-confirm").addEventListener("click", doDelete);
  backdrop.querySelector("#del-cancel").addEventListener("click", close);
  backdrop.addEventListener("mousedown", (e) => {
    if (e.target === backdrop) close();
  });

  root.appendChild(backdrop);
  document.addEventListener("keydown", onKey);
  input.focus();
}
