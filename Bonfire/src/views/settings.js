// Settings: decks, study-session defaults, appearance (theme/font/scale), and data tools.
import { el, esc } from "../dom.js";
import { exportVault, importVault } from "../data.js";
import { THEMES, FONTS, SCALES, appearance, setAppearance } from "../theme.js";
import { buildStudyConfigForm, loadConfig, saveConfig } from "./study.js";
import { PRESET_OPTIONS, DEFAULT_DECK_ID } from "../constants.js";

const DELETE_PHRASE = "are you absolutely super dupe sure you want to delete every card?";

const presetOptionsHtml = (current) =>
  PRESET_OPTIONS.map(
    (p) => `<option value="${esc(p.id)}" ${p.id === current ? "selected" : ""}>${esc(p.label)}</option>`
  ).join("");

export async function renderSettings(container, ctx) {
  const cfg = await loadConfig(ctx);
  const form = buildStudyConfigForm(ctx, cfg);

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

  root.querySelector("#save-study").addEventListener("click", async () => {
    await saveConfig(ctx, form.collect());
    alert("Study defaults saved.");
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
