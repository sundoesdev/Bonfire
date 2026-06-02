// App entry: holds shared state, wires the sidebar + global shortcuts, and
// renders the active view into #view. View modules export render(container, ctx, params).
import * as api from "./api.js";
import { DEFAULT_LANGUAGES, DEFAULT_DECK_ID, presetConfig } from "./constants.js";
import { renderDashboard } from "./views/dashboard.js";
import { renderLibrary } from "./views/library.js";
import { renderEditor } from "./views/editor.js";
import { renderStudy } from "./views/study.js";
import { renderSettings } from "./views/settings.js";
import { openQuickCapture } from "./components/quickCapture.js";
import { loadAppearance } from "./theme.js";

const DECK_KEY = "current_deck";

const state = {
  allShards: [], // every card, across all decks
  shards: [], // cards in the current deck (what the views read)
  customLanguages: [],
  decks: [],
  currentDeckId: DEFAULT_DECK_ID,
};

const VIEWS = {
  dashboard: renderDashboard,
  library: renderLibrary,
  editor: renderEditor,
  study: renderStudy,
  settings: renderSettings,
};

let viewEl;
let deckSwitcher;

// Reload shards, decks, and custom languages from the backend, then scope the
// view-facing `shards` array to the current deck.
async function refreshShards() {
  const [shards, custom, decks] = await Promise.all([
    api.listShards(),
    api.listCustomLanguages(),
    api.listDecks(),
  ]);
  state.allShards = shards;
  state.customLanguages = custom;
  state.decks = decks;

  // Fall back to the default deck if the remembered one no longer exists.
  if (!decks.some((d) => d.id === state.currentDeckId)) {
    state.currentDeckId = decks.some((d) => d.id === DEFAULT_DECK_ID)
      ? DEFAULT_DECK_ID
      : decks[0]?.id || DEFAULT_DECK_ID;
  }
  state.shards = shards.filter((s) => s.deckId === state.currentDeckId);
  populateDeckSwitcher();
}

// Merged, sorted list of selectable languages (defaults + user custom).
function languages() {
  const set = new Set([...DEFAULT_LANGUAGES, ...state.customLanguages]);
  return [...set].sort((a, b) => a.localeCompare(b));
}

function currentDeck() {
  return state.decks.find((d) => d.id === state.currentDeckId) || null;
}

function currentPreset() {
  return presetConfig(currentDeck()?.preset);
}

function populateDeckSwitcher() {
  if (!deckSwitcher) return;
  deckSwitcher.innerHTML = state.decks
    .map((d) => `<option value="${d.id}">${escapeOpt(d.name) || "(unnamed)"}</option>`)
    .join("");
  deckSwitcher.value = state.currentDeckId;
}

// Minimal escape for option labels (avoid importing dom.js here).
function escapeOpt(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function currentView() {
  return document.querySelector("#sidebar nav button.active")?.dataset.view || "dashboard";
}

// Switch the active deck: remember it, then re-render the current view scoped to it.
async function setDeck(id) {
  if (id === state.currentDeckId) return;
  state.currentDeckId = id;
  try {
    await api.setSetting(DECK_KEY, id);
  } catch (_e) {
    /* ignore persistence failures */
  }
  await navigate(currentView());
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
  decks: () => state.decks,
  currentDeck,
  currentPreset,
  currentDeckId: () => state.currentDeckId,
  setDeck,
  openShard: (id) => navigate("editor", { id }),
  newShard: () => navigate("editor", { id: null }),
  startStudy: () => navigate("study"),
  quickStudy: () => navigate("study", { quick: true }),
  reviewCard: (id) => navigate("study", { single: id }),
  openQuickCapture: () => openQuickCapture(ctx),
};

window.addEventListener("DOMContentLoaded", async () => {
  viewEl = document.querySelector("#view");
  deckSwitcher = document.querySelector("#deck-switcher");

  await loadAppearance();

  // Restore the last-used deck before the first render.
  try {
    const saved = await api.getSetting(DECK_KEY);
    if (saved) state.currentDeckId = saved;
  } catch (_e) {
    /* ignore */
  }

  deckSwitcher.addEventListener("change", () => setDeck(deckSwitcher.value));

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
