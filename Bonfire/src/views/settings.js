// Settings: study-session defaults, appearance (theme/font/scale), and data tools.
import { el, esc } from "../dom.js";
import { exportVault, importVault } from "../data.js";
import { THEMES, FONTS, SCALES, appearance, setAppearance } from "../theme.js";
import { buildStudyConfigForm, loadConfig, saveConfig } from "./study.js";

const DELETE_PHRASE = "are you absolutely super dupe sure you want to delete every card?";

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

      <div class="section-title">Study session defaults</div>
      <div class="panel" style="margin-bottom:8px;display:flex;flex-direction:column;gap:8px">
        <div class="muted">These are used by daily quick-start (Ctrl+D).</div>
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
