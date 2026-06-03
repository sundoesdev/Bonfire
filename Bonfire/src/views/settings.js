// Settings: decks, study-session defaults, appearance (theme/font/scale), and data tools.
import { el, esc, enableTab } from "../dom.js";
import { exportVault, importVault } from "../data.js";
import { THEMES, FONTS, SCALES, appearance, setAppearance } from "../theme.js";
import { buildStudyConfigForm, loadConfig, saveConfig } from "./study.js";
import {
  PRESET_OPTIONS,
  DEFAULT_DECK_ID,
  SR_ALGORITHMS,
  DEFAULT_ALGORITHM,
  SM2_DEFAULTS,
  FSRS_DEFAULTS,
  cardTypeOptions,
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
  const form = buildStudyConfigForm(ctx, cfg, { showDailyCaps: true });

  // Spaced-repetition settings.
  const algorithm = (await ctx.api.getSetting("sr_algorithm")) || DEFAULT_ALGORITHM;
  const sm2p = await loadJsonSetting(ctx, "sm2_params", SM2_DEFAULTS);
  const fsrsp = await loadJsonSetting(ctx, "fsrs_params", FSRS_DEFAULTS);
  const vimOn = (await ctx.api.getSetting("editor_vim")) === "true";

  const sel = (id, items, current) =>
    `<select id="${id}">${items
      .map((o) => `<option value="${esc(o.id)}" ${o.id === current ? "selected" : ""}>${esc(o.label)}</option>`)
      .join("")}</select>`;

  const root = el(`
    <div>
      <h2 style="margin:0 0 14px;font-size:16px">Settings</h2>

      <div class="section-title">Appearance</div>
      <div class="panel">
        <div class="form-grid">
          <label>Theme</label>${sel("set-theme", THEMES, appearance.theme)}
          <label>UI font</label>${sel("set-font", FONTS, appearance.font)}
          <label>UI scale</label>${sel("set-scale", SCALES, appearance.scale)}
        </div>
        <div class="muted">Changes apply instantly and are remembered.</div>
      </div>

      <div class="section-title">Editor</div>
      <div class="panel">
        <label class="chk"><input type="checkbox" id="set-vim" ${vimOn ? "checked" : ""}/> VIM mode in the answer editor</label>
        <div class="muted" style="margin-top:6px">Adds VIM keybindings to the syntax-highlighted code answer editor during study. You can also toggle it while answering a question.</div>
      </div>

      <div class="section-title">Decks</div>
      <div class="panel">
        <div class="muted" style="margin-bottom:8px">A deck's preset controls its fields — the <b>Code</b> preset shows the Language field and syntax highlighting; other presets hide them so you can study any subject. Cards in a deleted deck move to the default deck.</div>
        <div id="deck-list"></div>
        <hr style="border:none;border-top:1px solid var(--border);margin:12px 0" />
        <div class="row">
          <input type="text" id="new-deck-name" placeholder="New deck name, e.g. World History" style="flex:1" />
          <select id="new-deck-preset">${presetOptionsHtml("prose")}</select>
          <button class="btn btn-primary" id="add-deck">Add deck</button>
        </div>
      </div>

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

      <div class="section-title">Card templates</div>
      <div class="panel">
        <div class="muted" style="margin-bottom:8px">Reusable field presets for fast authoring. Pick one from the <b>Template…</b> menu in the editor or quick-capture. Built-in templates can't be edited.</div>
        <div id="template-list"></div>
        <hr style="border:none;border-top:1px solid var(--border);margin:12px 0" />
        <button class="btn btn-primary" id="add-template">Add template…</button>
      </div>

      <div class="section-title">Study session defaults</div>
      <div class="panel" style="margin-bottom:8px;display:flex;flex-direction:column;gap:8px">
        <div class="muted">Saves the session limits and filters set below as your defaults. The daily quick-start (Ctrl+D) then launches a study session using these settings, without asking you to configure it each time.</div>
        <div><button class="btn btn-primary" id="save-study">Save study defaults</button></div>
      </div>
      <div id="study-slot"></div>

      <div class="section-title" style="margin-top:6px">Data</div>
      <div class="panel">
        <div class="vlist">
          <button class="btn btn-tool" id="export">Export all to JSON</button>
          <button class="btn btn-tool" id="import">Import from JSON</button>
        </div>
        <hr style="border:none;border-top:1px solid var(--border);margin:14px 0" />
        <div class="muted-2" style="margin-bottom:8px">Danger zone</div>
        <button class="btn btn-danger" id="delete-all">Delete all cards…</button>
      </div>
    </div>
  `);

  root.querySelector("#study-slot").appendChild(form.node);

  renderDecks(root, ctx);
  root.querySelector("#add-deck").addEventListener("click", async () => {
    const nameEl = root.querySelector("#new-deck-name");
    const name = nameEl.value.trim();
    if (!name) {
      alert("Deck name is required.");
      return;
    }
    await ctx.api.saveDeck({ name, preset: root.querySelector("#new-deck-preset").value });
    ctx.navigate("settings");
  });

  // Appearance handlers (apply + persist immediately).
  root.querySelector("#set-theme").addEventListener("change", (e) => setAppearance("theme", e.target.value));
  root.querySelector("#set-font").addEventListener("change", (e) => setAppearance("font", e.target.value));
  root.querySelector("#set-scale").addEventListener("change", (e) => setAppearance("scale", e.target.value));
  root
    .querySelector("#set-vim")
    .addEventListener("change", (e) => ctx.api.setSetting("editor_vim", e.target.checked ? "true" : "false"));

  root.querySelector("#save-study").addEventListener("click", async () => {
    await saveConfig(ctx, form.collect());
    alert("Study defaults saved.");
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
    alert("Spaced-repetition settings saved.");
  });
  root.querySelector("#reset-sr").addEventListener("click", async () => {
    if (!confirm("Reset spaced-repetition settings to defaults?")) return;
    await ctx.api.setSetting("sr_algorithm", DEFAULT_ALGORITHM);
    await ctx.api.setSetting("sm2_params", JSON.stringify(SM2_DEFAULTS));
    await ctx.api.setSetting("fsrs_params", JSON.stringify(FSRS_DEFAULTS));
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

  root.querySelector("#delete-all").addEventListener("click", () => confirmDeleteAll(ctx));

  container.innerHTML = "";
  container.appendChild(root);
}

// Render the editable list of decks (rename, change preset, delete).
function renderDecks(root, ctx) {
  const list = root.querySelector("#deck-list");
  const decks = ctx.decks();
  list.innerHTML = "";

  decks.forEach((d) => {
    const isDefault = d.id === DEFAULT_DECK_ID;
    const count = ctx.state.allShards.filter((s) => s.deckId === d.id).length;
    const row = el(`
      <div class="list-row">
        <span class="title">${esc(d.name) || "(unnamed)"}</span>
        <span class="cat">${count} card${count === 1 ? "" : "s"}</span>
        <select class="deck-preset">${presetOptionsHtml(d.preset)}</select>
        <button class="btn mini deck-rename">Rename</button>
        ${isDefault ? '<span class="muted">default</span>' : '<button class="btn mini btn-danger deck-del">Delete</button>'}
      </div>
    `);

    row.querySelector(".deck-preset").addEventListener("change", async (e) => {
      await ctx.api.saveDeck({ ...d, preset: e.target.value });
      ctx.navigate("settings");
    });
    row.querySelector(".deck-rename").addEventListener("click", async () => {
      const name = prompt("Rename deck:", d.name);
      if (name && name.trim() && name.trim() !== d.name) {
        await ctx.api.saveDeck({ ...d, name: name.trim() });
        ctx.navigate("settings");
      }
    });
    const del = row.querySelector(".deck-del");
    if (del) {
      del.addEventListener("click", async () => {
        const msg = count
          ? `Delete "${d.name}"? Its ${count} card(s) will move to the default deck.`
          : `Delete "${d.name}"?`;
        if (confirm(msg)) {
          await ctx.api.deleteDeck(d.id);
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
            : '<button class="btn mini template-edit">Edit</button><button class="btn mini btn-danger template-del">Delete</button>'
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
    close();
    if (onDone) onDone();
  });

  root.appendChild(backdrop);
  document.addEventListener("keydown", onKey);
  backdrop.querySelector("#t-name").focus();
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
    alert(`Deleted ${n} card(s).`);
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
