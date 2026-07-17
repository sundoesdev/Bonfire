// App entry: holds shared state, wires the sidebar + global shortcuts, and
// renders the active view into #view. View modules export render(container, ctx, params).
import * as api from "./api.js";
import { DEFAULT_LANGUAGES, ALL_DECKS, presetConfig } from "./constants.js";
import { renderDashboard } from "./views/dashboard.js";
import { renderLibrary } from "./views/library.js";
import { renderStudy } from "./views/study.js";
import { renderPlaybooks } from "./views/playbooks.js";
import { renderTags } from "./views/tags.js";
import { renderStats } from "./views/stats.js";
import { renderSettings } from "./views/settings.js";
import { openQuickCapture } from "./components/quickCapture.js";
import { openCardModal } from "./components/cardModal.js";
import { showToast } from "./components/toast.js";
import { openCommandPalette } from "./components/commandPalette.js";
import { confirmDialog } from "./components/confirm.js";
import { loadAppearance } from "./theme.js";
import { checkForUpdate, applyUpdate } from "./update.js";

const DECK_KEY = "current_deck";

const state = {
  allShards: [], // every card, across all decks
  shards: [], // the whole library too — decks are filters now, not scopes (views read this)
  customLanguages: [],
  decks: [],
  // The active *library deck filter* (a filter, never a scope): ALL_DECKS shows the
  // whole library. Persisted in `current_deck`; the Library's own deck filter + the
  // sidebar "Filter" switcher both drive it.
  currentDeckId: ALL_DECKS,
  // Ids of cards referenced by any playbook (for the "exclude playbook cards from
  // study" toggle). Populated on each refresh.
  playbookCardIds: new Set(),
};

const VIEWS = {
  dashboard: renderDashboard,
  library: renderLibrary,
  study: renderStudy,
  playbooks: renderPlaybooks,
  tags: renderTags,
  stats: renderStats,
  settings: renderSettings,
};

let viewEl;
let deckSwitcher;

// Reload shards, decks, and custom languages from the backend, then scope the
// view-facing `shards` array to the current deck.
async function refreshShards() {
  // Reconcile the auto Debt deck (overdue cards in / caught-up cards out) before
  // reading, so it's accurate wherever the user looks. Cheap, set-based SQL.
  try {
    await api.syncDebtDeck();
  } catch (_e) {
    /* non-fatal — fall back to whatever's stored */
  }
  const [shards, custom, decks, pbCardIds] = await Promise.all([
    api.listShards(),
    api.listCustomLanguages(),
    api.listDecks(),
    api.playbookCardIds().catch(() => []),
  ]);
  state.allShards = shards;
  state.customLanguages = custom;
  state.decks = decks;
  state.playbookCardIds = new Set(pbCardIds || []);

  // Decks are filters now, not scopes: the whole library is always visible. If the
  // remembered deck filter points at a deck that no longer exists, fall back to
  // showing everything ("All decks").
  if (state.currentDeckId !== ALL_DECKS && !decks.some((d) => d.id === state.currentDeckId)) {
    state.currentDeckId = ALL_DECKS;
  }
  // The view-facing list is the entire library; each view applies its own deck
  // filter (the Library) or ignores decks (Dashboard/Stats) as appropriate.
  state.shards = shards;
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
  // "All decks" first (the full library), then each deck wrapper.
  deckSwitcher.innerHTML =
    `<option value="${ALL_DECKS}">All decks</option>` +
    state.decks
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
  // Study session nav lock (item 6): runSession sets these; the sidebar / deck
  // switcher / shortcuts check them before letting the user leave.
  studyActive: false,
  endStudySession: null,
  refreshView: () => navigate(currentView()),
  decks: () => state.decks,
  currentDeck,
  currentPreset,
  currentDeckId: () => state.currentDeckId,
  setDeck,
  openShard: (id) => openCardModal(ctx, { id }),
  newShard: () => openQuickCapture(ctx),
  startStudy: () => navigate("study"),
  // Daily quick-start (Ctrl+D) focuses the deck marked as the daily default in
  // Settings → Decks, if one is set; otherwise the active library filter. Passed as
  // a param so it seeds the session's focus deck WITHOUT mutating the global filter.
  quickStudy: async () => {
    let deckId = state.currentDeckId;
    try {
      const daily = await api.getSetting("daily_deck");
      if (daily && state.decks.some((d) => d.id === daily)) deckId = daily;
    } catch (_e) {
      /* fall back to the active filter */
    }
    navigate("study", { quick: true, deckId });
  },
  weakStudy: () => navigate("study", { weak: true }),
  reviewCard: (id) => navigate("study", { single: id }),
  // Study an explicit set of cards in one session (e.g. "Study all" from the
  // Card Debt list) — the queue is exactly these ids, no due/cap filtering.
  studyCards: (ids) => navigate("study", { cards: ids }),
  openQuickCapture: () => openQuickCapture(ctx),
  openCommandPalette: () => openCommandPalette(ctx),
  toast: (msg, type) => showToast(msg, type),
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

  // Item 6: while a study session is running, leaving requires confirmation.
  // Returns true if no session is active (caller may proceed); otherwise it pops
  // the confirm and, on "End session", shows the session summary — the caller
  // should NOT continue with its original action either way.
  async function guardStudy() {
    if (!ctx.studyActive) return true;
    const ok = await confirmDialog({
      title: "End study session?",
      message: "Are you sure you want to end your study session? Unstudied cards will go unaffected.",
      confirmLabel: "End session",
      confirmClass: "btn-danger",
      cancelLabel: "Keep studying",
    });
    if (ok && ctx.endStudySession) ctx.endStudySession();
    return false;
  }

  deckSwitcher.addEventListener("change", async () => {
    if (ctx.studyActive) {
      deckSwitcher.value = state.currentDeckId; // revert the visible selection
      await guardStudy();
      return;
    }
    // The sidebar switcher is a Library filter: set it and land on the Library so
    // the effect is visible. It never hides cards on other views.
    state.currentDeckId = deckSwitcher.value;
    try {
      await api.setSetting(DECK_KEY, deckSwitcher.value);
    } catch (_e) {
      /* ignore persistence failures */
    }
    navigate("library");
  });

  document.querySelectorAll("#sidebar nav button").forEach((b) => {
    b.addEventListener("click", async () => {
      if (!(await guardStudy())) return;
      navigate(b.dataset.view);
    });
  });
  document.querySelector("#new-shard").addEventListener("click", async () => {
    if (!(await guardStudy())) return;
    ctx.newShard();
  });

  // Auto-updater (scaffold): no-op until the updater plugin is configured.
  const updateBadge = document.querySelector("#update-badge");
  if (updateBadge) {
    updateBadge.addEventListener("click", () => applyUpdate());
    checkForUpdate(ctx, updateBadge);
  }

  // Global shortcuts: Ctrl+P palette, Ctrl+N quick capture, Ctrl+K library, Ctrl+D study.
  window.addEventListener("keydown", async (e) => {
    if (!e.ctrlKey) return;
    const k = e.key.toLowerCase();
    if (!["p", "n", "k", "d"].includes(k)) return;
    e.preventDefault();
    // During a study session these shortcuts all "leave" — gate them (item 6).
    if (!(await guardStudy())) return;
    if (k === "p") ctx.openCommandPalette();
    else if (k === "n") ctx.openQuickCapture();
    else if (k === "k") navigate("library", { focusSearch: true });
    else if (k === "d") ctx.quickStudy();
  });

  navigate("dashboard");
});
