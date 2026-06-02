mod db;
mod models;
mod sm2;

use models::{Deck, Shard, VaultExport};
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

/// Apply an SM-2 update for a review with the given rating, persist, and return
/// the updated shard. Used both by the review session and "Mark Reviewed".
fn review_with_quality(
    state: &State<AppState>,
    id: &str,
    quality: i64,
) -> Result<Shard, String> {
    let mut shard = with_conn(state, |c| db::get_shard(c, id))?
        .ok_or_else(|| format!("Shard not found: {}", id))?;
    let result = sm2::sm2(
        quality,
        shard.review_interval,
        shard.review_repetitions,
        shard.review_ease,
    );
    shard.review_interval = result.interval;
    shard.review_repetitions = result.repetitions;
    shard.review_ease = result.ease;
    shard.review_next = result.next;
    shard.last_reviewed = now_iso();
    shard.modified_at = now_iso();
    with_conn(state, |c| db::save_shard(c, &shard))?;
    Ok(shard)
}

#[tauri::command]
fn submit_review(state: State<AppState>, id: String, rating: String) -> Result<Shard, String> {
    let quality = sm2::quality_from_rating(&rating);
    review_with_quality(&state, &id, quality)
}

#[tauri::command]
fn mark_reviewed(state: State<AppState>, id: String) -> Result<Shard, String> {
    // "Good" quality, matching the original's direct mark-reviewed action.
    review_with_quality(&state, &id, 4)
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
