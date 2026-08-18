use crate::models::{
    DayCount, DayDetail, DeckCount, Deck, Playbook, PlaybookNode, ReviewLogEntry, Shard,
    SyncConflict, VaultExport,
};
use rusqlite::{params, Connection, Result};
use uuid::Uuid;

/// Fixed id of the always-present default deck that ungrouped cards fall back to.
pub const DEFAULT_DECK_ID: &str = "default";

/// Fixed id of the always-present, non-deletable "Debt" deck. Overdue cards are
/// auto-added here (and removed once caught up) by `sync_debt_deck`, so the user
/// can browse / mass-select / study their debt like any other deck.
pub const DEBT_DECK_ID: &str = "card-debt";

/// Create the schema if it does not already exist.
pub fn init(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS shards (
            id            TEXT PRIMARY KEY,
            title         TEXT NOT NULL DEFAULT '',
            language      TEXT NOT NULL DEFAULT '',
            prompt        TEXT NOT NULL DEFAULT '',
            code          TEXT NOT NULL DEFAULT '',
            description   TEXT NOT NULL DEFAULT '',
            hint          TEXT NOT NULL DEFAULT '',
            tags          TEXT NOT NULL DEFAULT '[]',
            category      TEXT NOT NULL DEFAULT 'snippet',
            familiarity   TEXT NOT NULL DEFAULT 'fresh',
            source        TEXT NOT NULL DEFAULT '',
            related_ids   TEXT NOT NULL DEFAULT '[]',
            created_at    TEXT NOT NULL DEFAULT '',
            modified_at   TEXT NOT NULL DEFAULT '',
            last_reviewed TEXT NOT NULL DEFAULT '',
            review_enabled    INTEGER NOT NULL DEFAULT 0,
            review_interval   INTEGER NOT NULL DEFAULT 0,
            review_reps       INTEGER NOT NULL DEFAULT 0,
            review_ease       REAL    NOT NULL DEFAULT 2.5,
            review_next       TEXT    NOT NULL DEFAULT '',
            fsrs_stability    REAL    NOT NULL DEFAULT 0,
            fsrs_difficulty   REAL    NOT NULL DEFAULT 0,
            fsrs_state        TEXT    NOT NULL DEFAULT 'new',
            lapses            INTEGER NOT NULL DEFAULT 0,
            media             TEXT    NOT NULL DEFAULT '[]'
        );
        CREATE TABLE IF NOT EXISTS custom_languages (
            name TEXT PRIMARY KEY
        );
        CREATE TABLE IF NOT EXISTS review_log (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            shard_id    TEXT NOT NULL DEFAULT '',
            deck_id     TEXT NOT NULL DEFAULT '',
            day         TEXT NOT NULL DEFAULT '',
            ts          TEXT NOT NULL DEFAULT '',
            rating      TEXT NOT NULL DEFAULT '',
            algorithm   TEXT NOT NULL DEFAULT '',
            duration_ms INTEGER NOT NULL DEFAULT 0,
            session_id  TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS settings (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS decks (
            id          TEXT PRIMARY KEY,
            name        TEXT NOT NULL DEFAULT '',
            preset      TEXT NOT NULL DEFAULT 'code',
            position    INTEGER NOT NULL DEFAULT 0,
            created_at  TEXT NOT NULL DEFAULT '',
            modified_at TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS card_decks (
            card_id TEXT NOT NULL,
            deck_id TEXT NOT NULL,
            PRIMARY KEY (card_id, deck_id)
        );
        CREATE TABLE IF NOT EXISTS playbooks (
            id          TEXT PRIMARY KEY,
            name        TEXT NOT NULL DEFAULT '',
            description TEXT NOT NULL DEFAULT '',
            position    INTEGER NOT NULL DEFAULT 0,
            created_at  TEXT NOT NULL DEFAULT '',
            modified_at TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS playbook_nodes (
            id          TEXT PRIMARY KEY,
            playbook_id TEXT NOT NULL DEFAULT '',
            card_id     TEXT NOT NULL DEFAULT '',
            parent_id   TEXT NOT NULL DEFAULT '',
            position    INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS tombstones (
            entity     TEXT NOT NULL,
            id         TEXT NOT NULL,
            deleted_at TEXT NOT NULL DEFAULT '',
            PRIMARY KEY (entity, id)
        );
        CREATE TABLE IF NOT EXISTS sync_conflicts (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            entity      TEXT NOT NULL DEFAULT '',
            entity_id   TEXT NOT NULL DEFAULT '',
            detected_at TEXT NOT NULL DEFAULT '',
            device_id   TEXT NOT NULL DEFAULT '',
            losing_json TEXT NOT NULL DEFAULT ''
        );",
    )?;
    migrate(conn)
}

/// Add a column to `table` if it does not yet exist (older vaults).
fn add_column(conn: &Connection, table: &str, name: &str, ddl: &str) -> Result<()> {
    let present: i64 = conn.query_row(
        &format!("SELECT COUNT(*) FROM pragma_table_info('{}') WHERE name = ?1", table),
        params![name],
        |r| r.get(0),
    )?;
    if present == 0 {
        conn.execute(&format!("ALTER TABLE {} ADD COLUMN {}", table, ddl), [])?;
    }
    Ok(())
}

/// Add a column to `shards` if it does not yet exist (older vaults).
fn add_shard_column(conn: &Connection, name: &str, ddl: &str) -> Result<()> {
    add_column(conn, "shards", name, ddl)
}

/// Lightweight migrations for databases created before a column existed.
fn migrate(conn: &Connection) -> Result<()> {
    add_shard_column(conn, "prompt", "prompt TEXT NOT NULL DEFAULT ''")?;

    // Decks: add the shards.deck_id column, ensure a default deck exists, and
    // adopt any orphaned cards into it.
    add_shard_column(conn, "deck_id", "deck_id TEXT NOT NULL DEFAULT ''")?;

    // Card type (basic / cloze / reverse).
    add_shard_column(conn, "card_type", "card_type TEXT NOT NULL DEFAULT 'basic'")?;

    // FSRS scheduling fields, lapse counter, and inline media attachments.
    add_shard_column(conn, "fsrs_stability", "fsrs_stability REAL NOT NULL DEFAULT 0")?;
    add_shard_column(conn, "fsrs_difficulty", "fsrs_difficulty REAL NOT NULL DEFAULT 0")?;
    add_shard_column(conn, "fsrs_state", "fsrs_state TEXT NOT NULL DEFAULT 'new'")?;
    add_shard_column(conn, "lapses", "lapses INTEGER NOT NULL DEFAULT 0")?;
    add_shard_column(conn, "media", "media TEXT NOT NULL DEFAULT '[]'")?;

    // Per-card study hint (the "why did I miss this last time" note).
    add_shard_column(conn, "hint", "hint TEXT NOT NULL DEFAULT ''")?;

    // review_log timing columns (added after the table first shipped).
    add_column(conn, "review_log", "duration_ms", "duration_ms INTEGER NOT NULL DEFAULT 0")?;
    add_column(conn, "review_log", "session_id", "session_id TEXT NOT NULL DEFAULT ''")?;

    let now = chrono::Local::now().to_rfc3339();
    conn.execute(
        "INSERT OR IGNORE INTO decks (id, name, preset, position, created_at, modified_at)
         VALUES (?1, 'Default', 'code', 0, ?2, ?2)",
        params![DEFAULT_DECK_ID, now],
    )?;
    // Rename the original auto-named default deck ("Code") to "Default" for vaults
    // created before the rename — but leave it alone if the user renamed it themselves.
    conn.execute(
        "UPDATE decks SET name = 'Default' WHERE id = ?1 AND name = 'Code'",
        params![DEFAULT_DECK_ID],
    )?;
    // The always-present, non-deletable "Debt" deck (sorted last in the switcher).
    conn.execute(
        "INSERT OR IGNORE INTO decks (id, name, preset, position, created_at, modified_at)
         VALUES (?1, 'Debt', 'code', 999, ?2, ?2)",
        params![DEBT_DECK_ID, now],
    )?;
    conn.execute(
        "UPDATE shards SET deck_id = ?1
         WHERE deck_id = '' OR deck_id IS NULL OR deck_id NOT IN (SELECT id FROM decks)",
        params![DEFAULT_DECK_ID],
    )?;

    // Many-to-many decks: backfill the card_decks join table from the legacy
    // single deck_id column (idempotent — INSERT OR IGNORE on the composite key).
    conn.execute(
        "INSERT OR IGNORE INTO card_decks (card_id, deck_id)
         SELECT id, deck_id FROM shards WHERE deck_id <> ''",
        [],
    )?;

    // Sync support (see docs/SYNC.md).
    //
    // `settings.modified_at` gives settings rows a last-write-wins timestamp.
    add_column(conn, "settings", "modified_at", "modified_at TEXT NOT NULL DEFAULT ''")?;

    // review_log.id is AUTOINCREMENT and therefore meaningless across devices —
    // two hosts independently number their rows 1..n. (shard_id, ts) is the real
    // natural key: a card cannot be reviewed twice at the same instant. Collapse
    // any pre-existing duplicates first, since the unique index would fail on them.
    conn.execute(
        "DELETE FROM review_log WHERE id NOT IN (
             SELECT MIN(id) FROM review_log GROUP BY shard_id, ts)",
        [],
    )?;
    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS review_log_nat ON review_log (shard_id, ts)",
        [],
    )?;

    // Indexes for the paths the merge and the stats views read in bulk. These
    // were never declared; on a small vault they cost nothing, and a sync pass
    // reads all three on every run.
    conn.execute_batch(
        "CREATE INDEX IF NOT EXISTS review_log_day  ON review_log (day);
         CREATE INDEX IF NOT EXISTS card_decks_deck ON card_decks (deck_id);
         CREATE INDEX IF NOT EXISTS shards_next     ON shards (review_next);",
    )?;
    Ok(())
}

/// Read a settings value by key (None if unset).
pub fn get_setting(conn: &Connection, key: &str) -> Result<Option<String>> {
    let mut stmt = conn.prepare("SELECT value FROM settings WHERE key = ?1")?;
    let mut rows = stmt.query_map(params![key], |r| r.get::<_, String>(0))?;
    match rows.next() {
        Some(v) => Ok(Some(v?)),
        None => Ok(None),
    }
}

/// Upsert a settings value, stamping `modified_at` so sync can resolve it.
pub fn set_setting(conn: &Connection, key: &str, value: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO settings (key, value, modified_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(key) DO UPDATE SET value = ?2, modified_at = ?3",
        params![key, value, now_iso()],
    )?;
    Ok(())
}

/// Settings that belong to the *user* and travel between their devices.
/// Everything not listed here is device-local — syncing a theme or a window
/// scale across machines would be wrong, and `sync_*` keys describe the
/// connection itself and must never be replicated.
pub const SYNCED_SETTINGS: &[&str] = &[
    "sr_algorithm",
    "sm2_params",
    "fsrs_params",
    "daily_study",
    "card_templates",
    "card_add_defaults",
    "daily_deck",
    "study_progress",
];

pub fn is_synced_setting(key: &str) -> bool {
    SYNCED_SETTINGS.contains(&key)
}

/// Every syncable setting with its timestamp, for the vault serializer.
pub fn synced_settings(conn: &Connection) -> Result<Vec<(String, String, String)>> {
    let mut stmt = conn.prepare("SELECT key, value, modified_at FROM settings ORDER BY key")?;
    let rows = stmt.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
        ))
    })?;
    let mut out = Vec::new();
    for row in rows {
        let row = row?;
        if is_synced_setting(&row.0) {
            out.push(row);
        }
    }
    Ok(out)
}

/// Record that `id` was deleted, so the deletion propagates instead of the row
/// simply reappearing from another device on the next merge.
pub fn add_tombstone(conn: &Connection, entity: &str, id: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO tombstones (entity, id, deleted_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(entity, id) DO UPDATE SET deleted_at = ?3",
        params![entity, id, now_iso()],
    )?;
    Ok(())
}

/// Clear a tombstone — used when a record legitimately comes back (a newer edit
/// on another device beats an older delete, see docs/SYNC.md).
pub fn drop_tombstone(conn: &Connection, entity: &str, id: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM tombstones WHERE entity = ?1 AND id = ?2",
        params![entity, id],
    )?;
    Ok(())
}

/// Record the losing side of a conflict the merge resolved by recency.
pub fn record_conflict(
    conn: &Connection,
    entity: &str,
    entity_id: &str,
    device_id: &str,
    losing_json: &str,
) -> Result<()> {
    conn.execute(
        "INSERT INTO sync_conflicts (entity, entity_id, detected_at, device_id, losing_json)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![entity, entity_id, now_iso(), device_id, losing_json],
    )?;
    Ok(())
}

/// Unresolved conflicts, newest first.
pub fn list_conflicts(conn: &Connection) -> Result<Vec<SyncConflict>> {
    let mut stmt = conn.prepare(
        "SELECT id, entity, entity_id, detected_at, device_id, losing_json
         FROM sync_conflicts ORDER BY id DESC",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(SyncConflict {
            id: r.get(0)?,
            entity: r.get(1)?,
            entity_id: r.get(2)?,
            detected_at: r.get(3)?,
            device_id: r.get(4)?,
            losing_json: r.get(5)?,
        })
    })?;
    rows.collect()
}

/// Dismiss a conflict once the user has dealt with it.
pub fn delete_conflict(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM sync_conflicts WHERE id = ?1", params![id])?;
    Ok(())
}

/// All tombstones as `(entity, id, deleted_at)`.
pub fn all_tombstones(conn: &Connection) -> Result<Vec<(String, String, String)>> {
    let mut stmt =
        conn.prepare("SELECT entity, id, deleted_at FROM tombstones ORDER BY entity, id")?;
    let rows = stmt.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
        ))
    })?;
    rows.collect()
}

/// Current local timestamp, RFC-3339 — matches `created_at`/`modified_at` everywhere else.
fn now_iso() -> String {
    chrono::Local::now().to_rfc3339()
}

/// Generate a unique id: base36(epoch-ms) + 6 hex chars of a UUID.
/// Mirrors the original Qt id scheme.
pub fn generate_id() -> String {
    let ms = chrono::Utc::now().timestamp_millis().max(0) as u64;
    let base36 = to_base36(ms);
    let suffix: String = Uuid::new_v4().simple().to_string().chars().take(6).collect();
    format!("{}{}", base36, suffix)
}

fn to_base36(mut n: u64) -> String {
    const DIGITS: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    if n == 0 {
        return "0".to_string();
    }
    let mut out = Vec::new();
    while n > 0 {
        out.push(DIGITS[(n % 36) as usize]);
        n /= 36;
    }
    out.reverse();
    String::from_utf8(out).unwrap()
}

fn row_to_shard(row: &rusqlite::Row) -> Result<Shard> {
    let tags_json: String = row.get("tags")?;
    let related_json: String = row.get("related_ids")?;
    let media_json: String = row.get("media")?;
    Ok(Shard {
        id: row.get("id")?,
        title: row.get("title")?,
        language: row.get("language")?,
        prompt: row.get("prompt")?,
        code: row.get("code")?,
        description: row.get("description")?,
        hint: row.get("hint")?,
        deck_id: row.get("deck_id")?,
        deck_ids: Vec::new(), // populated separately from card_decks
        card_type: row.get("card_type")?,
        tags: serde_json::from_str(&tags_json).unwrap_or_default(),
        category: row.get("category")?,
        familiarity: row.get("familiarity")?,
        source: row.get("source")?,
        related_ids: serde_json::from_str(&related_json).unwrap_or_default(),
        created_at: row.get("created_at")?,
        modified_at: row.get("modified_at")?,
        last_reviewed: row.get("last_reviewed")?,
        review_enabled: row.get::<_, i64>("review_enabled")? != 0,
        review_interval: row.get("review_interval")?,
        review_repetitions: row.get("review_reps")?,
        review_ease: row.get("review_ease")?,
        review_next: row.get("review_next")?,
        fsrs_stability: row.get("fsrs_stability")?,
        fsrs_difficulty: row.get("fsrs_difficulty")?,
        fsrs_state: row.get("fsrs_state")?,
        lapses: row.get("lapses")?,
        media: serde_json::from_str(&media_json).unwrap_or_default(),
    })
}

/// Deck memberships for one card (from the card_decks join table).
fn deck_ids_for(conn: &Connection, card_id: &str) -> Result<Vec<String>> {
    let mut stmt = conn.prepare("SELECT deck_id FROM card_decks WHERE card_id = ?1 ORDER BY deck_id")?;
    let rows = stmt.query_map(params![card_id], |r| r.get::<_, String>(0))?;
    rows.collect()
}

/// Set a card's legacy `deck_id` mirror to its first *real* membership (the Debt
/// deck is deprioritized so review-log/heatmap attribution stays on a real deck),
/// or '' if none. Cosmetic only — no logic depends on the mirror.
fn sync_legacy_deck(conn: &Connection, card_id: &str) -> Result<()> {
    let first: Option<String> = conn
        .query_row(
            "SELECT deck_id FROM card_decks WHERE card_id = ?1
             ORDER BY (deck_id = ?2), deck_id LIMIT 1",
            params![card_id, DEBT_DECK_ID],
            |r| r.get(0),
        )
        .ok();
    conn.execute(
        "UPDATE shards SET deck_id = ?2 WHERE id = ?1",
        params![card_id, first.unwrap_or_default()],
    )?;
    Ok(())
}

/// Reconcile the Debt deck with reality: add every review-enabled, overdue card
/// (reviewNext strictly before today) and remove any current member that's caught
/// up (review disabled, no due date, or due today/later). Cards keep their real
/// decks — Debt membership is additive. Cheap: two set-based statements.
pub fn sync_debt_deck(conn: &Connection) -> Result<()> {
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    conn.execute(
        "INSERT OR IGNORE INTO card_decks (card_id, deck_id)
         SELECT id, ?1 FROM shards
         WHERE review_enabled = 1 AND review_next <> '' AND review_next < ?2",
        params![DEBT_DECK_ID, today],
    )?;
    conn.execute(
        "DELETE FROM card_decks
         WHERE deck_id = ?1 AND card_id IN (
            SELECT id FROM shards
            WHERE review_enabled = 0 OR review_next = '' OR review_next >= ?2
         )",
        params![DEBT_DECK_ID, today],
    )?;
    Ok(())
}

/// All shards, most-recently-modified first, with deck memberships populated.
pub fn all_shards(conn: &Connection) -> Result<Vec<Shard>> {
    let mut stmt = conn.prepare("SELECT * FROM shards ORDER BY modified_at DESC")?;
    let rows = stmt.query_map([], row_to_shard)?;
    let mut shards: Vec<Shard> = rows.collect::<Result<_>>()?;

    // One pass over the join table → map of card_id -> deck_ids.
    let mut map: std::collections::HashMap<String, Vec<String>> = std::collections::HashMap::new();
    let mut jstmt = conn.prepare("SELECT card_id, deck_id FROM card_decks ORDER BY deck_id")?;
    let jrows = jstmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
    for row in jrows {
        let (cid, did) = row?;
        map.entry(cid).or_default().push(did);
    }
    for s in &mut shards {
        s.deck_ids = map.remove(&s.id).unwrap_or_default();
    }
    Ok(shards)
}

/// Fetch a single shard by id, with deck memberships populated.
pub fn get_shard(conn: &Connection, id: &str) -> Result<Option<Shard>> {
    let mut stmt = conn.prepare("SELECT * FROM shards WHERE id = ?1")?;
    let mut rows = stmt.query_map(params![id], row_to_shard)?;
    match rows.next() {
        Some(r) => {
            let mut s = r?;
            s.deck_ids = deck_ids_for(conn, id)?;
            Ok(Some(s))
        }
        None => Ok(None),
    }
}

/// Insert or update a shard (upsert on primary key).
///
/// The row write, the `card_decks` rewrite, and the legacy-mirror sync are one
/// transaction: they are three statements describing a single logical save, and
/// a crash between them used to leave a card with no deck memberships.
pub fn save_shard(conn: &Connection, s: &Shard) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    save_shard_in_tx(conn, s)?;
    tx.commit()
}

/// Write a shard exactly as the merge decided, without opening a transaction.
///
/// Unlike `save_shard` this does **not** clear the card's tombstone: the merge
/// has already settled delete-vs-edit, and re-deriving it here would undo that.
pub fn save_shard_merged(conn: &Connection, s: &Shard) -> Result<()> {
    save_shard_row(conn, s)
}

/// The body of `save_shard`, without opening a transaction of its own.
///
/// SQLite has no nested `BEGIN`, so any caller that already holds a transaction
/// (`import_export`, and the sync merge) must use this rather than `save_shard`.
fn save_shard_in_tx(conn: &Connection, s: &Shard) -> Result<()> {
    save_shard_row(conn, s)?;
    // Saving a card that was previously deleted here revives it deliberately —
    // drop the tombstone so the next merge doesn't re-delete it.
    drop_tombstone(conn, "shard", &s.id)
}

/// The raw row + membership write shared by every save path.
fn save_shard_row(conn: &Connection, s: &Shard) -> Result<()> {
    let tags = serde_json::to_string(&s.tags).unwrap_or_else(|_| "[]".into());
    let related = serde_json::to_string(&s.related_ids).unwrap_or_else(|_| "[]".into());
    let media = serde_json::to_string(&s.media).unwrap_or_else(|_| "[]".into());
    conn.execute(
        "INSERT INTO shards (id, title, language, prompt, code, description, deck_id, card_type, tags, category,
            familiarity, source, related_ids, created_at, modified_at, last_reviewed,
            review_enabled, review_interval, review_reps, review_ease, review_next,
            fsrs_stability, fsrs_difficulty, fsrs_state, lapses, media, hint)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?24,?25,?26,?27)
         ON CONFLICT(id) DO UPDATE SET
            title=?2, language=?3, prompt=?4, code=?5, description=?6, deck_id=?7, card_type=?8, tags=?9, category=?10,
            familiarity=?11, source=?12, related_ids=?13, created_at=?14, modified_at=?15,
            last_reviewed=?16, review_enabled=?17, review_interval=?18, review_reps=?19,
            review_ease=?20, review_next=?21,
            fsrs_stability=?22, fsrs_difficulty=?23, fsrs_state=?24, lapses=?25, media=?26, hint=?27",
        params![
            s.id, s.title, s.language, s.prompt, s.code, s.description, s.deck_id, s.card_type, tags, s.category,
            s.familiarity, s.source, related, s.created_at, s.modified_at, s.last_reviewed,
            s.review_enabled as i64, s.review_interval, s.review_repetitions, s.review_ease,
            s.review_next,
            s.fsrs_stability, s.fsrs_difficulty, s.fsrs_state, s.lapses, media, s.hint,
        ],
    )?;

    // Rewrite the card's deck memberships from `deck_ids` (the source of truth).
    // Fall back to the legacy single deck_id, then the default deck, so a card is
    // never silently orphaned on a plain save.
    let mut decks: Vec<String> = s.deck_ids.clone();
    if decks.is_empty() && !s.deck_id.is_empty() {
        decks.push(s.deck_id.clone());
    }
    if decks.is_empty() {
        decks.push(DEFAULT_DECK_ID.to_string());
    }
    conn.execute("DELETE FROM card_decks WHERE card_id = ?1", params![s.id])?;
    for d in &decks {
        if !d.is_empty() {
            conn.execute(
                "INSERT OR IGNORE INTO card_decks (card_id, deck_id) VALUES (?1, ?2)",
                params![s.id, d],
            )?;
        }
    }
    sync_legacy_deck(conn, &s.id)
}

/// Update only a card's hint.
///
/// Deliberately narrow rather than a whole-shard save: the study view writes the
/// hint while a review for the same card may be in flight, and saving the frontend's
/// copy of the shard would overwrite the schedule `submit_review` had just written.
pub fn set_shard_hint(conn: &Connection, id: &str, hint: &str) -> Result<()> {
    conn.execute(
        "UPDATE shards SET hint = ?2, modified_at = ?3 WHERE id = ?1",
        params![id, hint, now_iso()],
    )?;
    Ok(())
}

pub fn delete_shard(conn: &Connection, id: &str) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    conn.execute("DELETE FROM card_decks WHERE card_id = ?1", params![id])?;
    conn.execute("DELETE FROM shards WHERE id = ?1", params![id])?;
    add_tombstone(conn, "shard", id)?;
    tx.commit()
}

/// Delete the given shards. Returns the number removed.
pub fn delete_shards(conn: &Connection, ids: &[String]) -> Result<usize> {
    let tx = conn.unchecked_transaction()?;
    let mut n = 0;
    for id in ids {
        conn.execute("DELETE FROM card_decks WHERE card_id = ?1", params![id])?;
        n += conn.execute("DELETE FROM shards WHERE id = ?1", params![id])?;
        add_tombstone(conn, "shard", id)?;
    }
    tx.commit()?;
    Ok(n)
}

/// Delete every shard. Returns the number removed.
pub fn delete_all_shards(conn: &Connection) -> Result<usize> {
    // Collect ids before the delete — each one still needs a tombstone, or the
    // whole library would flow straight back in from the next sync.
    let ids: Vec<String> = {
        let mut stmt = conn.prepare("SELECT id FROM shards")?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
        rows.collect::<Result<Vec<_>>>()?
    };
    let tx = conn.unchecked_transaction()?;
    conn.execute("DELETE FROM card_decks", [])?;
    let n = conn.execute("DELETE FROM shards", [])?;
    for id in &ids {
        add_tombstone(conn, "shard", id)?;
    }
    tx.commit()?;
    Ok(n)
}

/// Add a deck membership to each card (no-op for already-members). Returns rows added.
pub fn add_cards_to_deck(conn: &Connection, ids: &[String], deck_id: &str) -> Result<usize> {
    let mut n = 0;
    for id in ids {
        n += conn.execute(
            "INSERT OR IGNORE INTO card_decks (card_id, deck_id) VALUES (?1, ?2)",
            params![id, deck_id],
        )?;
        sync_legacy_deck(conn, id)?;
    }
    Ok(n)
}

/// Remove a deck membership from each card. Decks are wrappers, not containers —
/// a card may end up in no deck at all (it still exists, browsable via "All decks"
/// and flagged by the integrity scanner). Returns the number of memberships removed.
pub fn remove_cards_from_deck(conn: &Connection, ids: &[String], deck_id: &str) -> Result<usize> {
    let mut n = 0;
    for id in ids {
        n += conn.execute(
            "DELETE FROM card_decks WHERE card_id = ?1 AND deck_id = ?2",
            params![id, deck_id],
        )?;
        sync_legacy_deck(conn, id)?;
    }
    Ok(n)
}

/// Replace the tag list on each given card. Returns the number changed.
pub fn retag_shards(conn: &Connection, ids: &[String], tags: &[String]) -> Result<usize> {
    let tx = conn.unchecked_transaction()?;
    let mut changed = 0;
    for id in ids {
        if let Some(mut s) = get_shard(conn, id)? {
            s.tags = tags.to_vec();
            save_shard_in_tx(conn, &s)?;
            changed += 1;
        }
    }
    tx.commit()?;
    Ok(changed)
}

/// Delete every review-log entry (wipes heatmap / streak / activity stats).
/// Per-card scheduling fields are untouched, so the retention forecast survives.
/// Returns the number removed.
pub fn clear_review_log(conn: &Connection) -> Result<usize> {
    let n = conn.execute("DELETE FROM review_log", [])?;
    Ok(n)
}

fn row_to_deck(row: &rusqlite::Row) -> Result<Deck> {
    Ok(Deck {
        id: row.get("id")?,
        name: row.get("name")?,
        preset: row.get("preset")?,
        position: row.get("position")?,
        created_at: row.get("created_at")?,
        modified_at: row.get("modified_at")?,
    })
}

/// All decks, ordered for the switcher (by position, then name).
pub fn all_decks(conn: &Connection) -> Result<Vec<Deck>> {
    let mut stmt = conn.prepare("SELECT * FROM decks ORDER BY position, name")?;
    let rows = stmt.query_map([], row_to_deck)?;
    rows.collect()
}

pub fn get_deck(conn: &Connection, id: &str) -> Result<Option<Deck>> {
    let mut stmt = conn.prepare("SELECT * FROM decks WHERE id = ?1")?;
    let mut rows = stmt.query_map(params![id], row_to_deck)?;
    match rows.next() {
        Some(r) => Ok(Some(r?)),
        None => Ok(None),
    }
}

/// Insert or update a deck (upsert on primary key).
pub fn save_deck(conn: &Connection, d: &Deck) -> Result<()> {
    conn.execute(
        "INSERT INTO decks (id, name, preset, position, created_at, modified_at)
         VALUES (?1,?2,?3,?4,?5,?6)
         ON CONFLICT(id) DO UPDATE SET name=?2, preset=?3, position=?4, created_at=?5, modified_at=?6",
        params![d.id, d.name, d.preset, d.position, d.created_at, d.modified_at],
    )?;
    drop_tombstone(conn, "deck", &d.id)?;
    Ok(())
}

/// Delete a deck (a wrapper). Its membership rows are removed; cards stay in any
/// other decks they belong to, and a card left in none simply becomes deckless —
/// it still exists (browsable via "All decks", flagged by the integrity scanner).
pub fn delete_deck(conn: &Connection, id: &str) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    delete_deck_in_tx(conn, id)?;
    add_tombstone(conn, "deck", id)?;
    tx.commit()
}

/// `delete_deck` without a transaction and without writing a tombstone — for the
/// merge, which already holds a transaction and has itself decided what is
/// deleted (re-deriving a tombstone here would undo that decision).
pub fn delete_deck_in_tx(conn: &Connection, id: &str) -> Result<()> {
    conn.execute("DELETE FROM card_decks WHERE deck_id = ?1", params![id])?;
    // Re-sync the legacy mirror for any card whose mirror pointed at this deck
    // (to its first remaining real membership, or '' if none).
    conn.execute(
        "UPDATE shards SET deck_id = COALESCE((
             SELECT deck_id FROM card_decks WHERE card_id = shards.id
             ORDER BY (deck_id = ?2), deck_id LIMIT 1
         ), '') WHERE deck_id = ?1",
        params![id, DEBT_DECK_ID],
    )?;
    conn.execute("DELETE FROM decks WHERE id = ?1", params![id])?;
    Ok(())
}

/// Rename a tag across every shard. Renaming onto an existing tag merges them
/// (duplicates are removed). Returns the number of shards changed.
pub fn rename_tag(conn: &Connection, old: &str, new: &str) -> Result<usize> {
    let tx = conn.unchecked_transaction()?;
    let mut changed = 0;
    for mut s in all_shards(conn)? {
        if !s.tags.iter().any(|t| t == old) {
            continue;
        }
        let mut seen = std::collections::HashSet::new();
        s.tags = s
            .tags
            .into_iter()
            .map(|t| if t == old { new.to_string() } else { t })
            .filter(|t| !t.is_empty() && seen.insert(t.clone()))
            .collect();
        save_shard_in_tx(conn, &s)?;
        changed += 1;
    }
    tx.commit()?;
    Ok(changed)
}

/// Remove a tag from every shard. Returns the number of shards changed.
pub fn delete_tag(conn: &Connection, tag: &str) -> Result<usize> {
    let tx = conn.unchecked_transaction()?;
    let mut changed = 0;
    for mut s in all_shards(conn)? {
        if s.tags.iter().any(|t| t == tag) {
            s.tags.retain(|t| t != tag);
            save_shard_in_tx(conn, &s)?;
            changed += 1;
        }
    }
    tx.commit()?;
    Ok(changed)
}

pub fn custom_languages(conn: &Connection) -> Result<Vec<String>> {
    let mut stmt = conn.prepare("SELECT name FROM custom_languages ORDER BY name")?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
    rows.collect()
}

pub fn add_custom_language(conn: &Connection, name: &str) -> Result<()> {
    conn.execute(
        "INSERT OR IGNORE INTO custom_languages (name) VALUES (?1)",
        params![name],
    )?;
    Ok(())
}

pub fn remove_custom_language(conn: &Connection, name: &str) -> Result<()> {
    conn.execute("DELETE FROM custom_languages WHERE name = ?1", params![name])?;
    Ok(())
}

/// Record a single review event for the study heatmap / streak analytics.
#[allow(clippy::too_many_arguments)]
pub fn log_review(
    conn: &Connection,
    shard_id: &str,
    deck_id: &str,
    rating: &str,
    algorithm: &str,
    duration_ms: i64,
    session_id: &str,
) -> Result<()> {
    let now = chrono::Local::now();
    let day = now.format("%Y-%m-%d").to_string();
    let ts = now.to_rfc3339();
    // OR IGNORE against the (shard_id, ts) unique index: a second row at the same
    // nanosecond for the same card is a duplicate by definition, and a grade must
    // never fail just because of a logging collision.
    conn.execute(
        "INSERT OR IGNORE INTO review_log (shard_id, deck_id, day, ts, rating, algorithm, duration_ms, session_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![shard_id, deck_id, day, ts, rating, algorithm, duration_ms, session_id],
    )?;
    Ok(())
}

/// Rich per-day study detail for the heatmap tooltip: card count, total time,
/// distinct session count, and a per-deck breakdown.
pub fn study_days(conn: &Connection) -> Result<Vec<DayDetail>> {
    let mut stmt = conn.prepare(
        "SELECT day,
                COUNT(*) AS n,
                COALESCE(SUM(duration_ms), 0) AS dur,
                COUNT(DISTINCT NULLIF(session_id, '')) AS sess
         FROM review_log WHERE day <> '' GROUP BY day ORDER BY day",
    )?;
    let mut days: Vec<DayDetail> = stmt
        .query_map([], |r| {
            Ok(DayDetail {
                day: r.get("day")?,
                count: r.get("n")?,
                duration_ms: r.get("dur")?,
                sessions: r.get("sess")?,
                deck_counts: Vec::new(),
            })
        })?
        .collect::<Result<_>>()?;

    // Per-day, per-deck counts.
    let mut dstmt = conn.prepare(
        "SELECT day, deck_id, COUNT(*) AS n FROM review_log WHERE day <> ''
         GROUP BY day, deck_id ORDER BY day, n DESC",
    )?;
    let rows = dstmt.query_map([], |r| {
        Ok((
            r.get::<_, String>("day")?,
            DeckCount {
                deck_id: r.get("deck_id")?,
                count: r.get("n")?,
            },
        ))
    })?;
    for row in rows {
        let (day, dc) = row?;
        if let Some(d) = days.iter_mut().find(|d| d.day == day) {
            d.deck_counts.push(dc);
        }
    }
    Ok(days)
}

/// Per-day review counts (every recorded day), oldest first, for the heatmap.
pub fn review_history(conn: &Connection) -> Result<Vec<DayCount>> {
    let mut stmt = conn.prepare(
        "SELECT day, COUNT(*) AS n FROM review_log WHERE day <> '' GROUP BY day ORDER BY day",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(DayCount {
            day: r.get("day")?,
            count: r.get("n")?,
        })
    })?;
    rows.collect()
}

/// Full review log (for inclusion in the JSON export).
pub fn all_review_log(conn: &Connection) -> Result<Vec<ReviewLogEntry>> {
    let mut stmt = conn.prepare(
        "SELECT shard_id, deck_id, day, ts, rating, algorithm, duration_ms, session_id
         FROM review_log ORDER BY id",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(ReviewLogEntry {
            shard_id: r.get("shard_id")?,
            deck_id: r.get("deck_id")?,
            day: r.get("day")?,
            ts: r.get("ts")?,
            rating: r.get("rating")?,
            algorithm: r.get("algorithm")?,
            duration_ms: r.get("duration_ms")?,
            session_id: r.get("session_id")?,
        })
    })?;
    rows.collect()
}

// ---------- Playbooks (ordered, self-authored tutorials over existing cards) ----------

fn row_to_playbook(row: &rusqlite::Row) -> Result<Playbook> {
    Ok(Playbook {
        id: row.get("id")?,
        name: row.get("name")?,
        description: row.get("description")?,
        position: row.get("position")?,
        created_at: row.get("created_at")?,
        modified_at: row.get("modified_at")?,
    })
}

fn row_to_playbook_node(row: &rusqlite::Row) -> Result<PlaybookNode> {
    Ok(PlaybookNode {
        id: row.get("id")?,
        playbook_id: row.get("playbook_id")?,
        card_id: row.get("card_id")?,
        parent_id: row.get("parent_id")?,
        position: row.get("position")?,
    })
}

/// All playbooks, ordered for the list (by position, then name).
pub fn all_playbooks(conn: &Connection) -> Result<Vec<Playbook>> {
    let mut stmt = conn.prepare("SELECT * FROM playbooks ORDER BY position, name")?;
    let rows = stmt.query_map([], row_to_playbook)?;
    rows.collect()
}

pub fn get_playbook(conn: &Connection, id: &str) -> Result<Option<Playbook>> {
    let mut stmt = conn.prepare("SELECT * FROM playbooks WHERE id = ?1")?;
    let mut rows = stmt.query_map(params![id], row_to_playbook)?;
    match rows.next() {
        Some(r) => Ok(Some(r?)),
        None => Ok(None),
    }
}

/// One playbook's nodes, ordered by sibling position (the tree shape is derived on
/// the frontend from `parent_id`).
pub fn playbook_nodes(conn: &Connection, playbook_id: &str) -> Result<Vec<PlaybookNode>> {
    let mut stmt =
        conn.prepare("SELECT * FROM playbook_nodes WHERE playbook_id = ?1 ORDER BY position, id")?;
    let rows = stmt.query_map(params![playbook_id], row_to_playbook_node)?;
    rows.collect()
}

/// Every playbook node (for export).
pub fn all_playbook_nodes(conn: &Connection) -> Result<Vec<PlaybookNode>> {
    let mut stmt =
        conn.prepare("SELECT * FROM playbook_nodes ORDER BY playbook_id, position, id")?;
    let rows = stmt.query_map([], row_to_playbook_node)?;
    rows.collect()
}

/// Insert or update a playbook's metadata (upsert on primary key). Node structure is
/// persisted separately via `save_playbook_nodes`.
pub fn save_playbook(conn: &Connection, p: &Playbook) -> Result<()> {
    conn.execute(
        "INSERT INTO playbooks (id, name, description, position, created_at, modified_at)
         VALUES (?1,?2,?3,?4,?5,?6)
         ON CONFLICT(id) DO UPDATE SET name=?2, description=?3, position=?4, created_at=?5, modified_at=?6",
        params![p.id, p.name, p.description, p.position, p.created_at, p.modified_at],
    )?;
    drop_tombstone(conn, "playbook", &p.id)?;
    Ok(())
}

/// Delete a playbook and its nodes. The referenced cards are untouched — they stay in
/// the library and every deck they belong to.
pub fn delete_playbook(conn: &Connection, id: &str) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    delete_playbook_in_tx(conn, id)?;
    // Nodes carry no timestamps of their own and travel inside the playbook
    // record, so one tombstone for the playbook covers the whole tree.
    add_tombstone(conn, "playbook", id)?;
    tx.commit()
}

/// `delete_playbook` without a transaction or a tombstone — see `delete_deck_in_tx`.
pub fn delete_playbook_in_tx(conn: &Connection, id: &str) -> Result<()> {
    conn.execute("DELETE FROM playbook_nodes WHERE playbook_id = ?1", params![id])?;
    conn.execute("DELETE FROM playbooks WHERE id = ?1", params![id])?;
    Ok(())
}

/// Replace ALL nodes of a playbook with the given list. The frontend owns the tree in
/// memory and persists it wholesale (atomic, and trivial for a playbook's small tree).
/// Only card *references* are written — cards are never modified.
pub fn save_playbook_nodes(
    conn: &Connection,
    playbook_id: &str,
    nodes: &[PlaybookNode],
) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    save_playbook_nodes_in_tx(conn, playbook_id, nodes)?;
    tx.commit()
}

/// `save_playbook_nodes` without opening a transaction — for callers that
/// already hold one (SQLite has no nested `BEGIN`).
pub fn save_playbook_nodes_in_tx(
    conn: &Connection,
    playbook_id: &str,
    nodes: &[PlaybookNode],
) -> Result<()> {
    conn.execute(
        "DELETE FROM playbook_nodes WHERE playbook_id = ?1",
        params![playbook_id],
    )?;
    for n in nodes {
        conn.execute(
            "INSERT INTO playbook_nodes (id, playbook_id, card_id, parent_id, position)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![n.id, playbook_id, n.card_id, n.parent_id, n.position],
        )?;
    }
    Ok(())
}

/// Distinct card ids referenced by any playbook (drives the "exclude playbook cards
/// from study" toggle).
pub fn playbook_card_ids(conn: &Connection) -> Result<Vec<String>> {
    let mut stmt = conn.prepare("SELECT DISTINCT card_id FROM playbook_nodes")?;
    let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
    rows.collect()
}

/// Serialize the whole vault to a pretty JSON string.
pub fn export_json(conn: &Connection) -> Result<String> {
    let export = VaultExport {
        shards: all_shards(conn)?,
        custom_languages: custom_languages(conn)?,
        decks: all_decks(conn)?,
        review_log: all_review_log(conn)?,
        playbooks: all_playbooks(conn)?,
        playbook_nodes: all_playbook_nodes(conn)?,
    };
    Ok(serde_json::to_string_pretty(&export).unwrap_or_else(|_| "{}".into()))
}

/// Import shards + custom languages from a parsed export.
/// Existing shard ids are skipped. Returns the number of shards imported.
pub fn import_export(conn: &Connection, export: &VaultExport) -> Result<usize> {
    let tx = conn.unchecked_transaction()?;
    // Decks first, so imported cards can resolve their deck_id.
    for deck in &export.decks {
        if get_deck(conn, &deck.id)?.is_none() {
            save_deck(conn, deck)?;
        }
    }
    let mut imported = 0usize;
    for shard in &export.shards {
        if get_shard(conn, &shard.id)?.is_none() {
            // In-tx variant: we already hold the import transaction.
            save_shard_in_tx(conn, shard)?;
            imported += 1;
        }
    }
    for lang in &export.custom_languages {
        add_custom_language(conn, lang)?;
    }
    // Restore review history only into an empty log, so re-importing into an
    // existing vault can't duplicate heatmap counts (the log has no natural key).
    let log_count: i64 = conn.query_row("SELECT COUNT(*) FROM review_log", [], |r| r.get(0))?;
    if log_count == 0 {
        for e in &export.review_log {
            conn.execute(
                "INSERT INTO review_log (shard_id, deck_id, day, ts, rating, algorithm, duration_ms, session_id)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![e.shard_id, e.deck_id, e.day, e.ts, e.rating, e.algorithm, e.duration_ms, e.session_id],
            )?;
        }
    }
    // Drop memberships pointing at decks that don't exist (junk in older/partial
    // exports), then ensure every shard belongs to at least one deck (default).
    conn.execute(
        "DELETE FROM card_decks WHERE deck_id NOT IN (SELECT id FROM decks)",
        [],
    )?;
    conn.execute(
        "INSERT OR IGNORE INTO card_decks (card_id, deck_id)
         SELECT id, ?1 FROM shards WHERE id NOT IN (SELECT card_id FROM card_decks)",
        params![DEFAULT_DECK_ID],
    )?;
    // Re-sync the legacy mirror column for every shard.
    conn.execute(
        "UPDATE shards SET deck_id = COALESCE(
            (SELECT deck_id FROM card_decks WHERE card_id = shards.id ORDER BY deck_id LIMIT 1), '')",
        [],
    )?;
    // Playbooks + their nodes (additive; old exports without them import cleanly).
    for pb in &export.playbooks {
        if get_playbook(conn, &pb.id)?.is_none() {
            save_playbook(conn, pb)?;
        }
    }
    for node in &export.playbook_nodes {
        conn.execute(
            "INSERT OR IGNORE INTO playbook_nodes (id, playbook_id, card_id, parent_id, position)
             VALUES (?1,?2,?3,?4,?5)",
            params![node.id, node.playbook_id, node.card_id, node.parent_id, node.position],
        )?;
    }
    tx.commit()?;
    Ok(imported)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{Deck, VaultExport};

    fn vault() -> Connection {
        let conn = Connection::open_in_memory().expect("open");
        init(&conn).expect("init");
        conn
    }

    fn card(id: &str, modified: &str) -> Shard {
        Shard {
            id: id.into(),
            title: format!("card {id}"),
            modified_at: modified.into(),
            ..Default::default()
        }
    }

    #[test]
    fn init_is_idempotent() {
        let conn = vault();
        // A second run must not fail — every app launch calls init() on the
        // existing vault, and migrate() is the only upgrade path we have.
        init(&conn).expect("second init");
        init(&conn).expect("third init");
    }

    #[test]
    fn import_export_does_not_nest_transactions() {
        // Regression: import_export holds a transaction and used to call
        // save_shard, which opened its own. SQLite has no nested BEGIN, so
        // every JSON import failed with "cannot start a transaction within a
        // transaction".
        let conn = vault();
        let export = VaultExport {
            shards: vec![card("a", "2026-01-01T00:00:00-05:00")],
            custom_languages: vec![],
            decks: vec![Deck {
                id: "d1".into(),
                name: "D".into(),
                ..Default::default()
            }],
            review_log: vec![],
            playbooks: vec![],
            playbook_nodes: vec![],
        };
        assert_eq!(import_export(&conn, &export).expect("import"), 1);
        assert_eq!(all_shards(&conn).unwrap().len(), 1);
    }

    #[test]
    fn bulk_tag_ops_do_not_nest_transactions() {
        let conn = vault();
        let mut s = card("a", "2026-01-01T00:00:00-05:00");
        s.tags = vec!["old".into(), "keep".into()];
        save_shard(&conn, &s).unwrap();

        assert_eq!(rename_tag(&conn, "old", "new").unwrap(), 1);
        assert_eq!(delete_tag(&conn, "keep").unwrap(), 1);
        assert_eq!(
            retag_shards(&conn, &["a".to_string()], &["fresh".to_string()]).unwrap(),
            1
        );
        assert_eq!(get_shard(&conn, "a").unwrap().unwrap().tags, vec!["fresh"]);
    }

    #[test]
    fn deleting_a_card_leaves_a_tombstone() {
        let conn = vault();
        save_shard(&conn, &card("a", "2026-01-01T00:00:00-05:00")).unwrap();
        delete_shard(&conn, "a").unwrap();

        let stones = all_tombstones(&conn).unwrap();
        assert_eq!(stones.len(), 1);
        assert_eq!(stones[0].0, "shard");
        assert_eq!(stones[0].1, "a");
        assert!(!stones[0].2.is_empty(), "deleted_at must be stamped");
    }

    #[test]
    fn delete_all_tombstones_every_card() {
        let conn = vault();
        for id in ["a", "b", "c"] {
            save_shard(&conn, &card(id, "2026-01-01T00:00:00-05:00")).unwrap();
        }
        assert_eq!(delete_all_shards(&conn).unwrap(), 3);
        // Without one tombstone per card the whole library would flow back in
        // from the next merge.
        assert_eq!(all_tombstones(&conn).unwrap().len(), 3);
    }

    #[test]
    fn re_saving_a_deleted_card_clears_its_tombstone() {
        let conn = vault();
        save_shard(&conn, &card("a", "2026-01-01T00:00:00-05:00")).unwrap();
        delete_shard(&conn, "a").unwrap();
        save_shard(&conn, &card("a", "2026-02-01T00:00:00-05:00")).unwrap();
        assert!(all_tombstones(&conn).unwrap().is_empty());
    }

    #[test]
    fn review_log_natural_key_rejects_duplicates() {
        let conn = vault();
        save_shard(&conn, &card("a", "2026-01-01T00:00:00-05:00")).unwrap();
        // Same (shard_id, ts) twice: the second is the same logical review and
        // must collapse rather than double-count the heatmap.
        for _ in 0..2 {
            conn.execute(
                "INSERT OR IGNORE INTO review_log (shard_id, deck_id, day, ts, rating, algorithm)
                 VALUES ('a', 'default', '2026-01-01', '2026-01-01T10:00:00-05:00', 'good', 'sm2')",
                [],
            )
            .unwrap();
        }
        assert_eq!(all_review_log(&conn).unwrap().len(), 1);
    }

    #[test]
    fn settings_are_stamped_and_split_by_allowlist() {
        let conn = vault();
        set_setting(&conn, "fsrs_params", "{}").unwrap();
        set_setting(&conn, "ui_theme", "dark").unwrap();

        let synced = synced_settings(&conn).unwrap();
        let keys: Vec<&str> = synced.iter().map(|(k, _, _)| k.as_str()).collect();
        assert_eq!(keys, vec!["fsrs_params"], "ui_theme is device-local");
        assert!(!synced[0].2.is_empty(), "modified_at must be stamped");
    }
}
