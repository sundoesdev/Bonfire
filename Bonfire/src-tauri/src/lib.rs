mod db;
mod fsrs;
mod git;
mod merge;
mod models;
mod sm2;
mod sync;
mod update;
mod vault;

use models::{DayCount, DayDetail, Deck, Playbook, PlaybookDetail, PlaybookNode, Shard, VaultExport};
use rusqlite::Connection;
use std::sync::Mutex;
use tauri::{Manager, State};

/// App-wide state: the SQLite connection behind a mutex, plus the app-data
/// directory (sync needs it to locate the vault repo alongside vault.db).
struct AppState {
    conn: Mutex<Connection>,
    dir: std::path::PathBuf,
}

/// Helper: lock the connection or return a stringified error.
fn with_conn<T, F>(state: &State<AppState>, f: F) -> Result<T, String>
where
    F: FnOnce(&Connection) -> rusqlite::Result<T>,
{
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    f(&conn).map_err(|e| e.to_string())
}

fn now_iso() -> String {
    chrono::Local::now().to_rfc3339()
}

#[tauri::command]
fn list_shards(state: State<AppState>) -> Result<Vec<Shard>, String> {
    with_conn(&state, |c| db::all_shards(c))
}

/// Insert or update a shard. A new shard (empty id) gets an id + created_at.
/// modified_at is always refreshed. Returns the persisted shard.
#[tauri::command]
fn save_shard(state: State<AppState>, mut shard: Shard) -> Result<Shard, String> {
    let now = now_iso();
    if shard.id.trim().is_empty() {
        shard.id = db::generate_id();
        shard.created_at = now.clone();
    } else if shard.created_at.is_empty() {
        shard.created_at = now.clone();
    }
    // Normalize deck membership: deck_ids is the source of truth. Fall back to the
    // legacy single deck_id, then the default deck, so a card always has a home.
    if shard.deck_ids.is_empty() {
        if !shard.deck_id.trim().is_empty() {
            shard.deck_ids = vec![shard.deck_id.clone()];
        } else {
            shard.deck_ids = vec![db::DEFAULT_DECK_ID.to_string()];
        }
    }
    shard.deck_id = shard.deck_ids[0].clone();
    if shard.card_type.trim().is_empty() {
        shard.card_type = "basic".to_string();
    }
    shard.modified_at = now;
    with_conn(&state, |c| db::save_shard(c, &shard))?;
    Ok(shard)
}

#[tauri::command]
fn list_decks(state: State<AppState>) -> Result<Vec<Deck>, String> {
    with_conn(&state, |c| db::all_decks(c))
}

/// Insert or update a deck. A new deck (empty id) gets an id + created_at.
#[tauri::command]
fn save_deck(state: State<AppState>, mut deck: Deck) -> Result<Deck, String> {
    let now = now_iso();
    if deck.id.trim().is_empty() {
        deck.id = db::generate_id();
        deck.created_at = now.clone();
    } else if deck.created_at.is_empty() {
        deck.created_at = now.clone();
    }
    deck.modified_at = now;
    with_conn(&state, |c| db::save_deck(c, &deck))?;
    Ok(deck)
}

/// Delete a deck; its cards are reassigned to the default deck. The default
/// deck itself cannot be deleted.
#[tauri::command]
fn delete_deck(state: State<AppState>, id: String) -> Result<(), String> {
    if id == db::DEFAULT_DECK_ID {
        return Err("The default deck cannot be deleted.".into());
    }
    if id == db::DEBT_DECK_ID {
        return Err("The Debt deck cannot be deleted.".into());
    }
    with_conn(&state, |c| db::delete_deck(c, &id))
}

// ---------- Playbooks ----------

#[tauri::command]
fn list_playbooks(state: State<AppState>) -> Result<Vec<Playbook>, String> {
    with_conn(&state, |c| db::all_playbooks(c))
}

/// A playbook plus its full node list (for the editor/runner), or None if missing.
#[tauri::command]
fn get_playbook(state: State<AppState>, id: String) -> Result<Option<PlaybookDetail>, String> {
    with_conn(&state, |c| match db::get_playbook(c, &id)? {
        Some(playbook) => {
            let nodes = db::playbook_nodes(c, &id)?;
            Ok(Some(PlaybookDetail { playbook, nodes }))
        }
        None => Ok(None),
    })
}

/// Insert or update a playbook's metadata. A new playbook (empty id) gets an id +
/// created_at; modified_at is always refreshed. Returns the persisted playbook.
#[tauri::command]
fn save_playbook(state: State<AppState>, mut playbook: Playbook) -> Result<Playbook, String> {
    let now = now_iso();
    if playbook.id.trim().is_empty() {
        playbook.id = db::generate_id();
        playbook.created_at = now.clone();
    } else if playbook.created_at.is_empty() {
        playbook.created_at = now.clone();
    }
    playbook.modified_at = now;
    with_conn(&state, |c| db::save_playbook(c, &playbook))?;
    Ok(playbook)
}

/// Delete a playbook + its nodes. Referenced cards are untouched (never owned).
#[tauri::command]
fn delete_playbook(state: State<AppState>, id: String) -> Result<(), String> {
    with_conn(&state, |c| db::delete_playbook(c, &id))
}

/// Replace all of a playbook's nodes with the given tree (add/move/reorder/remove).
#[tauri::command]
fn save_playbook_nodes(
    state: State<AppState>,
    playbook_id: String,
    nodes: Vec<PlaybookNode>,
) -> Result<(), String> {
    with_conn(&state, |c| db::save_playbook_nodes(c, &playbook_id, &nodes))
}

/// Every card id referenced by any playbook (for the exclude-from-study toggle).
#[tauri::command]
fn playbook_card_ids(state: State<AppState>) -> Result<Vec<String>, String> {
    with_conn(&state, |c| db::playbook_card_ids(c))
}

/// Reconcile the Debt deck with the current overdue cards (item 5). Called by the
/// frontend on refresh; cheap, set-based SQL.
#[tauri::command]
fn sync_debt_deck(state: State<AppState>) -> Result<(), String> {
    with_conn(&state, |c| db::sync_debt_deck(c))
}

/// Save just the study hint. Narrow on purpose — see `db::set_shard_hint`.
#[tauri::command]
fn set_shard_hint(state: State<AppState>, id: String, hint: String) -> Result<(), String> {
    with_conn(&state, |c| db::set_shard_hint(c, &id, &hint))
}

#[tauri::command]
fn delete_shard(state: State<AppState>, id: String) -> Result<(), String> {
    with_conn(&state, |c| db::delete_shard(c, &id))
}

#[tauri::command]
fn delete_all_shards(state: State<AppState>) -> Result<usize, String> {
    with_conn(&state, |c| db::delete_all_shards(c))
}

/// Bulk-delete the given cards. Returns the number removed.
#[tauri::command]
fn delete_shards(state: State<AppState>, ids: Vec<String>) -> Result<usize, String> {
    with_conn(&state, |c| db::delete_shards(c, &ids))
}

/// Add a deck membership to each card (many-to-many). Returns memberships added.
#[tauri::command]
fn add_cards_to_deck(state: State<AppState>, ids: Vec<String>, deck_id: String) -> Result<usize, String> {
    with_conn(&state, |c| db::add_cards_to_deck(c, &ids, &deck_id))
}

/// Remove a deck membership from each card (a card left deckless is re-homed to
/// the default deck). Returns memberships removed.
#[tauri::command]
fn remove_cards_from_deck(
    state: State<AppState>,
    ids: Vec<String>,
    deck_id: String,
) -> Result<usize, String> {
    with_conn(&state, |c| db::remove_cards_from_deck(c, &ids, &deck_id))
}

/// Replace the tag list on each given card. Returns the number changed.
#[tauri::command]
fn retag_shards(state: State<AppState>, ids: Vec<String>, tags: Vec<String>) -> Result<usize, String> {
    let tags: Vec<String> = tags
        .into_iter()
        .map(|t| t.trim().to_lowercase())
        .filter(|t| !t.is_empty())
        .collect();
    with_conn(&state, |c| db::retag_shards(c, &ids, &tags))
}

/// Manually re-set a card's spaced-repetition schedule to a chosen maturity level
/// (item 5, Card Debt). Bonfire never does this on its own — the user picks how
/// well they remember an overdue card. Levels: new / semiNew / half / good / full.
#[tauri::command]
fn reset_card_schedule(state: State<AppState>, id: String, level: String) -> Result<Shard, String> {
    let mut shard = with_conn(&state, |c| db::get_shard(c, &id))?
        .ok_or_else(|| format!("Shard not found: {}", id))?;

    // (interval days, repetitions, ease, familiarity) ladder, anchored to SM-2.
    let (interval, reps, ease, fam) = match level.as_str() {
        "new" => (0_i64, 0_i64, 2.5_f64, "fresh"),
        "semiNew" => (1, 1, 2.5, "shaky"),
        "half" => (3, 2, 2.5, "shaky"),
        "good" => (7, 3, 2.5, "solid"),
        "full" => (21, 4, 2.6, "mastered"),
        _ => return Err(format!("Unknown reset level: {}", level)),
    };
    let next = (chrono::Local::now().date_naive() + chrono::Duration::days(interval))
        .format("%Y-%m-%d")
        .to_string();

    shard.review_enabled = true;
    shard.review_interval = interval;
    shard.review_repetitions = reps;
    shard.review_ease = ease;
    shard.review_next = next;
    shard.familiarity = fam.to_string();
    // FSRS equivalents, used when that algorithm is active.
    shard.fsrs_stability = interval.max(0) as f64;
    shard.fsrs_difficulty = 5.0;
    shard.fsrs_state = if level == "new" { "new".to_string() } else { "review".to_string() };
    // Treat the reset moment as the last review so elapsed-time math stays sane.
    shard.last_reviewed = now_iso();
    shard.modified_at = now_iso();

    with_conn(&state, |c| db::save_shard(c, &shard))?;
    Ok(shard)
}

#[tauri::command]
fn clear_review_log(state: State<AppState>) -> Result<usize, String> {
    with_conn(&state, |c| db::clear_review_log(c))
}

/// Read a settings value, swallowing lock/lookup errors to `None`.
fn read_setting(state: &State<AppState>, key: &str) -> Option<String> {
    with_conn(state, |c| db::get_setting(c, key)).ok().flatten()
}

/// Build an SM-2 config from the `sm2_params` settings JSON (defaults if unset).
fn sm2_config_from(json: Option<String>) -> sm2::Sm2Config {
    let mut cfg = sm2::Sm2Config::default();
    if let Some(v) = json.and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok()) {
        if let Some(x) = v.get("easeFloor").and_then(|x| x.as_f64()) {
            cfg.ease_floor = x;
        }
        if let Some(x) = v.get("intervalModifier").and_then(|x| x.as_f64()) {
            cfg.interval_modifier = x;
        }
        if let Some(x) = v.get("hardMultiplier").and_then(|x| x.as_f64()) {
            cfg.hard_multiplier = x;
        }
    }
    cfg
}

/// Build an FSRS config from the `fsrs_params` settings JSON (defaults if unset).
fn fsrs_config_from(json: Option<String>) -> fsrs::FsrsConfig {
    let mut cfg = fsrs::FsrsConfig::default();
    if let Some(v) = json.and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok()) {
        if let Some(x) = v.get("requestRetention").and_then(|x| x.as_f64()) {
            if (0.7..=0.97).contains(&x) {
                cfg.request_retention = x;
            }
        }
        if let Some(arr) = v.get("weights").and_then(|x| x.as_array()) {
            if arr.len() == fsrs::W_LEN {
                for (i, item) in arr.iter().enumerate() {
                    if let Some(f) = item.as_f64() {
                        cfg.weights[i] = f;
                    }
                }
            }
        }
    }
    cfg
}

/// Days elapsed since an RFC-3339 timestamp (0 if empty/unparseable).
fn elapsed_days(last_reviewed: &str) -> i64 {
    if last_reviewed.is_empty() {
        return 0;
    }
    match chrono::DateTime::parse_from_rfc3339(last_reviewed) {
        Ok(dt) => {
            let then = dt.with_timezone(&chrono::Local).date_naive();
            (chrono::Local::now().date_naive() - then).num_days().max(0)
        }
        Err(_) => 0,
    }
}

/// Apply a scheduling update for a review, persist, log it, and return the
/// updated shard. Branches on the global `sr_algorithm` setting (SM-2 vs FSRS).
/// Used by both the review session and "Mark Reviewed".
fn apply_review(
    state: &State<AppState>,
    id: &str,
    rating: &str,
    duration_ms: i64,
    session_id: &str,
    cram: bool,
) -> Result<Shard, String> {
    let mut shard = with_conn(state, |c| db::get_shard(c, id))?
        .ok_or_else(|| format!("Shard not found: {}", id))?;

    let algorithm = if read_setting(state, "sr_algorithm").as_deref() == Some("fsrs") {
        "fsrs"
    } else {
        "sm2"
    };

    // Cram mode is pure practice: it must NOT touch the scheduler. Skip all
    // SM-2/FSRS math and the per-card scheduling/last_reviewed updates, but still
    // log the review so the heatmap / streak / retention counters reflect it.
    if cram {
        with_conn(state, |c| {
            db::log_review(c, id, &shard.deck_id, rating, "cram", duration_ms, session_id)
        })?;
        return Ok(shard);
    }

    if algorithm == "fsrs" {
        let cfg = fsrs_config_from(read_setting(state, "fsrs_params"));
        let grade = fsrs::grade_from_rating(rating);
        let elapsed = elapsed_days(&shard.last_reviewed);
        let r = fsrs::fsrs(
            grade,
            shard.fsrs_stability,
            shard.fsrs_difficulty,
            &shard.fsrs_state,
            elapsed,
            &cfg,
        );
        let r = fsrs::adjust_for_rating(rating, r);
        shard.fsrs_stability = r.stability;
        shard.fsrs_difficulty = r.difficulty;
        shard.fsrs_state = r.state;
        shard.review_interval = r.interval;
        shard.review_next = r.next;
        shard.review_repetitions += 1;
        // "Bombed it" maps to grade 1, so this counts both failure buttons.
        if grade == 1 {
            shard.lapses += 1;
        }
    } else {
        let cfg = sm2_config_from(read_setting(state, "sm2_params"));
        let quality = sm2::quality_from_rating(rating);
        let r = sm2::sm2(
            quality,
            shard.review_interval,
            shard.review_repetitions,
            shard.review_ease,
            &cfg,
        );
        let r = sm2::adjust_for_rating(rating, r);
        shard.review_interval = r.interval;
        shard.review_repetitions = r.repetitions;
        shard.review_ease = r.ease;
        shard.review_next = r.next;
    }

    shard.last_reviewed = now_iso();
    shard.modified_at = now_iso();
    with_conn(state, |c| db::save_shard(c, &shard))?;
    let deck = shard.deck_id.clone();
    with_conn(state, |c| {
        db::log_review(c, id, &deck, rating, algorithm, duration_ms, session_id)
    })?;
    Ok(shard)
}

#[tauri::command]
fn submit_review(
    state: State<AppState>,
    id: String,
    rating: String,
    duration_ms: Option<i64>,
    session_id: Option<String>,
    cram: Option<bool>,
) -> Result<Shard, String> {
    apply_review(
        &state,
        &id,
        &rating,
        duration_ms.unwrap_or(0).max(0),
        session_id.as_deref().unwrap_or(""),
        cram.unwrap_or(false),
    )
}

/// Per-day review counts for the study heatmap / streak analytics.
#[tauri::command]
fn review_history(state: State<AppState>) -> Result<Vec<DayCount>, String> {
    with_conn(&state, |c| db::review_history(c))
}

/// Rich per-day study detail (count, time, sessions, per-deck) for the heatmap tooltip.
#[tauri::command]
fn study_days(state: State<AppState>) -> Result<Vec<DayDetail>, String> {
    with_conn(&state, |c| db::study_days(c))
}

/// Rename a tag across all cards (renaming onto an existing tag merges them).
#[tauri::command]
fn rename_tag(state: State<AppState>, old: String, new: String) -> Result<usize, String> {
    let new = new.trim().to_lowercase();
    if new.is_empty() {
        return Err("New tag name is required.".into());
    }
    with_conn(&state, |c| db::rename_tag(c, old.trim(), &new))
}

/// Remove a tag from all cards.
#[tauri::command]
fn delete_tag(state: State<AppState>, tag: String) -> Result<usize, String> {
    with_conn(&state, |c| db::delete_tag(c, tag.trim()))
}

#[tauri::command]
fn get_setting(state: State<AppState>, key: String) -> Result<Option<String>, String> {
    with_conn(&state, |c| db::get_setting(c, &key))
}

#[tauri::command]
fn set_setting(state: State<AppState>, key: String, value: String) -> Result<(), String> {
    with_conn(&state, |c| db::set_setting(c, &key, &value))
}

#[tauri::command]
fn list_custom_languages(state: State<AppState>) -> Result<Vec<String>, String> {
    with_conn(&state, |c| db::custom_languages(c))
}

#[tauri::command]
fn add_custom_language(state: State<AppState>, name: String) -> Result<(), String> {
    with_conn(&state, |c| db::add_custom_language(c, name.trim()))
}

#[tauri::command]
fn remove_custom_language(state: State<AppState>, name: String) -> Result<(), String> {
    with_conn(&state, |c| db::remove_custom_language(c, &name))
}

/// Write the whole vault as JSON to `path` (chosen via the dialog plugin in JS).
#[tauri::command]
fn export_to_json(state: State<AppState>, path: String) -> Result<(), String> {
    let json = with_conn(&state, |c| db::export_json(c))?;
    std::fs::write(&path, json).map_err(|e| e.to_string())
}

/// Read a JSON export from `path` and merge it in. Returns shards imported.
#[tauri::command]
fn import_from_json(state: State<AppState>, path: String) -> Result<usize, String> {
    let json = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let export: VaultExport = serde_json::from_str(&json).map_err(|e| e.to_string())?;
    with_conn(&state, |c| db::import_export(c, &export))
}

// ------------------------------------------------------------------- sync
//
// Sync is opt-in: with no remote configured Hearth never invokes git and works
// exactly as it did before. See `sync.rs` for the loop and docs/SYNC.md for the
// merge rules.

/// Point this device at a vault remote (empty string disconnects it).
#[tauri::command]
fn sync_configure(state: State<AppState>, remote: String) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    sync::configure(&conn, &state.dir, &remote)
}

/// Run one sync. Returns a short summary for the toast.
#[tauri::command]
fn sync_now(state: State<AppState>) -> Result<String, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    sync::sync_now(&conn, &state.dir)
}

/// Fast-forward the source checkout from GitHub `main` and rebuild (see update.rs).
///
/// Deliberately does NOT take the connection lock: a rebuild takes minutes, and
/// holding the mutex for that long would freeze every other command.
#[tauri::command]
fn check_and_update(state: State<AppState>) -> update::UpdateResult {
    update::check_and_update(&state.dir)
}

#[tauri::command]
fn sync_status(state: State<AppState>) -> Result<sync::SyncStatus, String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    Ok(sync::status(&conn))
}

/// Versions discarded by a last-write-wins resolution, newest first.
#[tauri::command]
fn list_sync_conflicts(state: State<AppState>) -> Result<Vec<models::SyncConflict>, String> {
    with_conn(&state, db::list_conflicts)
}

/// Dismiss a conflict, optionally restoring the version that lost.
#[tauri::command]
fn resolve_sync_conflict(
    state: State<AppState>,
    id: i64,
    restore: Option<bool>,
) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| e.to_string())?;
    if restore.unwrap_or(false) {
        let entry = db::list_conflicts(&conn)
            .map_err(|e| e.to_string())?
            .into_iter()
            .find(|c| c.id == id)
            .ok_or("That conflict no longer exists")?;
        if entry.entity == "shard" {
            let mut shard: Shard =
                serde_json::from_str(&entry.losing_json).map_err(|e| e.to_string())?;
            // Stamp it as the newest edit, or the next merge would discard it
            // again for exactly the reason it lost the first time.
            shard.modified_at = now_iso();
            db::save_shard(&conn, &shard).map_err(|e| e.to_string())?;
        }
    }
    db::delete_conflict(&conn, id).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // vault.db lives in the platform app-data directory.
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let conn = Connection::open(dir.join("vault.db"))?;
            db::init(&conn)?;
            app.manage(AppState {
                conn: Mutex::new(conn),
                dir,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_shards,
            save_shard,
            delete_shard,
            delete_all_shards,
            delete_shards,
            add_cards_to_deck,
            remove_cards_from_deck,
            retag_shards,
            reset_card_schedule,
            clear_review_log,
            list_decks,
            save_deck,
            delete_deck,
            list_playbooks,
            get_playbook,
            save_playbook,
            delete_playbook,
            save_playbook_nodes,
            playbook_card_ids,
            sync_debt_deck,
            set_shard_hint,
            submit_review,
            review_history,
            study_days,
            rename_tag,
            delete_tag,
            get_setting,
            set_setting,
            list_custom_languages,
            add_custom_language,
            remove_custom_language,
            export_to_json,
            import_from_json,
            sync_configure,
            sync_now,
            sync_status,
            list_sync_conflicts,
            resolve_sync_conflict,
            check_and_update,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
