// App entry: holds shared state, wires the sidebar + global shortcuts, and
// renders the active view into #view. View modules export render(container, ctx, params).
import * as api from "./api.js";
import { DEFAULT_LANGUAGES } from "./constants.js";
import { renderDashboard } from "./views/dashboard.js";
import { renderLibrary } from "./views/library.js";
import { renderEditor } from "./views/editor.js";
import { renderStudy } from "./views/study.js";
import { renderSettings } from "./views/settings.js";
import { openQuickCapture } from "./components/quickCapture.js";
import { loadAppearance } from "./theme.js";

const state = {
  shards: [],
  customLanguages: [],
};

const VIEWS = {
  dashboard: renderDashboard,
  library: renderLibrary,
  editor: renderEditor,
  study: renderStudy,
  settings: renderSettings,
};

let viewEl;

// Reload shards + custom languages from the backend into local state.
async function refreshShards() {
  const [shards, custom] = await Promise.all([
    api.listShards(),
    api.listCustomLanguages(),
  ]);
  state.shards = shards;
  state.customLanguages = custom;
}

// Merged, sorted list of selectable languages (defaults + user custom).
function languages() {
  const set = new Set([...DEFAULT_LANGUAGES, ...state.customLanguages]);
  return [...set].sort((a, b) => a.localeCompare(b));
}

function setActiveNav(view) {
  document.querySelectorAll("#sidebar nav button").forEach((b) => {
    b.classList.toggle("active", b.dataset.view === view);
  });
}

// Central navigation: refresh data then render the requested view.
async function navigate(view, params = {}) {
  await refreshShards();
  setActiveNav(view);
  const render = VIEWS[view] || VIEWS.dashboard;
  viewEl.innerHTML = "";
  render(viewEl, ctx, params);
}

const ctx = {
  api,
  state,
  languages,
  navigate,
  openShard: (id) => navigate("editor", { id }),
  newShard: () => navigate("editor", { id: null }),
  startStudy: () => navigate("study"),
  quickStudy: () => navigate("study", { quick: true }),
  reviewCard: (id) => navigate("study", { single: id }),
  openQuickCapture: () => openQuickCapture(ctx),
};

window.addEventListener("DOMContentLoaded", async () => {
  viewEl = document.querySelector("#view");

  await loadAppearance();

  document.querySelectorAll("#sidebar nav button").forEach((b) => {
    b.addEventListener("click", () => navigate(b.dataset.view));
  });
  document.querySelector("#new-shard").addEventListener("click", () => ctx.newShard());

  // Global shortcuts: Ctrl+N quick capture, Ctrl+K library search.
  window.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.key.toLowerCase() === "n") {
      e.preventDefault();
      ctx.openQuickCapture();
    } else if (e.ctrlKey && e.key.toLowerCase() === "k") {
      e.preventDefault();
      navigate("library", { focusSearch: true });
    } else if (e.ctrlKey && e.key.toLowerCase() === "d") {
      e.preventDefault();
      ctx.quickStudy();
    }
  });

  navigate("dashboard");
});
