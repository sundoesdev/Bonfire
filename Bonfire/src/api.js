// Thin wrappers around the Rust Tauri commands. `withGlobalTauri` exposes
// `invoke` on window.__TAURI__.core; the dialog plugin is reached by invoking
// its plugin commands directly (no JS bindings needed in this no-bundler setup).

const { invoke } = window.__TAURI__.core;

export const listShards = () => invoke("list_shards");
export const saveShard = (shard) => invoke("save_shard", { shard });
export const deleteShard = (id) => invoke("delete_shard", { id });
export const deleteAllShards = () => invoke("delete_all_shards");
export const deleteShards = (ids) => invoke("delete_shards", { ids });
export const addCardsToDeck = (ids, deckId) => invoke("add_cards_to_deck", { ids, deckId });
export const removeCardsFromDeck = (ids, deckId) => invoke("remove_cards_from_deck", { ids, deckId });
export const retagShards = (ids, tags) => invoke("retag_shards", { ids, tags });
export const resetCardSchedule = (id, level) => invoke("reset_card_schedule", { id, level });
export const clearReviewLog = () => invoke("clear_review_log");
export const listDecks = () => invoke("list_decks");
export const saveDeck = (deck) => invoke("save_deck", { deck });
export const deleteDeck = (id) => invoke("delete_deck", { id });
export const syncDebtDeck = () => invoke("sync_debt_deck");
export const submitReview = (id, rating, durationMs, sessionId, cram = false) =>
  invoke("submit_review", { id, rating, durationMs, sessionId, cram });
export const reviewHistory = () => invoke("review_history");
export const studyDays = () => invoke("study_days");
export const renameTag = (oldName, newName) => invoke("rename_tag", { old: oldName, new: newName });
export const deleteTag = (tag) => invoke("delete_tag", { tag });
export const getSetting = (key) => invoke("get_setting", { key });
export const setSetting = (key, value) => invoke("set_setting", { key, value });
export const listCustomLanguages = () => invoke("list_custom_languages");
export const addCustomLanguage = (name) => invoke("add_custom_language", { name });
export const removeCustomLanguage = (name) => invoke("remove_custom_language", { name });
export const exportToJson = (path) => invoke("export_to_json", { path });
export const importFromJson = (path) => invoke("import_from_json", { path });

const JSON_FILTER = [{ name: "JSON", extensions: ["json"] }];

// Native save dialog → returns a path string (or null if cancelled).
export const saveDialog = (defaultPath) =>
  invoke("plugin:dialog|save", {
    options: { defaultPath, filters: JSON_FILTER },
  });

// Native open dialog → returns a path string (or null if cancelled).
export const openDialog = () =>
  invoke("plugin:dialog|open", {
    options: { multiple: false, directory: false, filters: JSON_FILTER },
  });
