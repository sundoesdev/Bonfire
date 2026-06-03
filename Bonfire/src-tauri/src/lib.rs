mod db;
mod fsrs;
mod models;
mod sm2;

use models::{DayCount, DayDetail, Deck, Shard, VaultExport};
use rusqlite::Connection;
use std::sync::Mutex;
use tauri::{Manager, State};

/// App-wide state: the SQLite connection behind a mutex.
struct AppState {
    conn: Mutex<Connection>,
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
    if shard.deck_id.trim().is_empty() {
        shard.deck_id = db::DEFAULT_DECK_ID.to_string();
    }
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
    with_conn(&state, |c| db::delete_deck(c, &id))
}

#[tauri::command]
fn delete_shard(state: State<AppState>, id: String) -> Result<(), String> {
    with_conn(&state, |c| db::delete_shard(c, &id))
}

#[tauri::command]
fn delete_all_shards(state: State<AppState>) -> Result<usize, String> {
    with_conn(&state, |c| db::delete_all_shards(c))
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
) -> Result<Shard, String> {
    let mut shard = with_conn(state, |c| db::get_shard(c, id))?
        .ok_or_else(|| format!("Shard not found: {}", id))?;

    let algorithm = if read_setting(state, "sr_algorithm").as_deref() == Some("fsrs") {
        "fsrs"
    } else {
        "sm2"
    };

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
        shard.fsrs_stability = r.stability;
        shard.fsrs_difficulty = r.difficulty;
        shard.fsrs_state = r.state;
        shard.review_interval = r.interval;
        shard.review_next = r.next;
        shard.review_repetitions += 1;
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
) -> Result<Shard, String> {
    apply_review(
        &state,
        &id,
        &rating,
        duration_ms.unwrap_or(0).max(0),
        session_id.as_deref().unwrap_or(""),
    )
}

#[tauri::command]
fn mark_reviewed(state: State<AppState>, id: String) -> Result<Shard, String> {
    // "Good" rating, matching the original's direct mark-reviewed action.
    apply_review(&state, &id, "good", 0, "")
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
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_shards,
            save_shard,
            delete_shard,
            delete_all_shards,
            list_decks,
            save_deck,
            delete_deck,
            submit_review,
            mark_reviewed,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
