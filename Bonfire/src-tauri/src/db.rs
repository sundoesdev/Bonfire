use crate::models::{DayCount, DayDetail, DeckCount, Deck, ReviewLogEntry, Shard, VaultExport};
use rusqlite::{params, Connection, Result};
use uuid::Uuid;

/// Fixed id of the always-present default deck that ungrouped cards fall back to.
pub const DEFAULT_DECK_ID: &str = "default";

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
    conn.execute(
        "UPDATE shards SET deck_id = ?1
         WHERE deck_id = '' OR deck_id IS NULL OR deck_id NOT IN (SELECT id FROM decks)",
        params![DEFAULT_DECK_ID],
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

/// Upsert a settings value.
pub fn set_setting(conn: &Connection, key: &str, value: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = ?2",
        params![key, value],
    )?;
    Ok(())
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
        deck_id: row.get("deck_id")?,
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

/// All shards, most-recently-modified first.
pub fn all_shards(conn: &Connection) -> Result<Vec<Shard>> {
    let mut stmt = conn.prepare("SELECT * FROM shards ORDER BY modified_at DESC")?;
    let rows = stmt.query_map([], row_to_shard)?;
    rows.collect()
}

/// Fetch a single shard by id.
pub fn get_shard(conn: &Connection, id: &str) -> Result<Option<Shard>> {
    let mut stmt = conn.prepare("SELECT * FROM shards WHERE id = ?1")?;
    let mut rows = stmt.query_map(params![id], row_to_shard)?;
    match rows.next() {
        Some(r) => Ok(Some(r?)),
        None => Ok(None),
    }
}

/// Insert or update a shard (upsert on primary key).
pub fn save_shard(conn: &Connection, s: &Shard) -> Result<()> {
    let tags = serde_json::to_string(&s.tags).unwrap_or_else(|_| "[]".into());
    let related = serde_json::to_string(&s.related_ids).unwrap_or_else(|_| "[]".into());
    let media = serde_json::to_string(&s.media).unwrap_or_else(|_| "[]".into());
    conn.execute(
        "INSERT INTO shards (id, title, language, prompt, code, description, deck_id, card_type, tags, category,
            familiarity, source, related_ids, created_at, modified_at, last_reviewed,
            review_enabled, review_interval, review_reps, review_ease, review_next,
            fsrs_stability, fsrs_difficulty, fsrs_state, lapses, media)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?24,?25,?26)
         ON CONFLICT(id) DO UPDATE SET
            title=?2, language=?3, prompt=?4, code=?5, description=?6, deck_id=?7, card_type=?8, tags=?9, category=?10,
            familiarity=?11, source=?12, related_ids=?13, created_at=?14, modified_at=?15,
            last_reviewed=?16, review_enabled=?17, review_interval=?18, review_reps=?19,
            review_ease=?20, review_next=?21,
            fsrs_stability=?22, fsrs_difficulty=?23, fsrs_state=?24, lapses=?25, media=?26",
        params![
            s.id, s.title, s.language, s.prompt, s.code, s.description, s.deck_id, s.card_type, tags, s.category,
            s.familiarity, s.source, related, s.created_at, s.modified_at, s.last_reviewed,
            s.review_enabled as i64, s.review_interval, s.review_repetitions, s.review_ease,
            s.review_next,
            s.fsrs_stability, s.fsrs_difficulty, s.fsrs_state, s.lapses, media,
        ],
    )?;
    Ok(())
}

pub fn delete_shard(conn: &Connection, id: &str) -> Result<()> {
    conn.execute("DELETE FROM shards WHERE id = ?1", params![id])?;
    Ok(())
}

/// Delete every shard. Returns the number removed.
pub fn delete_all_shards(conn: &Connection) -> Result<usize> {
    let n = conn.execute("DELETE FROM shards", [])?;
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
    Ok(())
}

/// Delete a deck, reassigning its cards to the default deck so none are orphaned.
pub fn delete_deck(conn: &Connection, id: &str) -> Result<()> {
    conn.execute(
        "UPDATE shards SET deck_id = ?1 WHERE deck_id = ?2",
        params![DEFAULT_DECK_ID, id],
    )?;
    conn.execute("DELETE FROM decks WHERE id = ?1", params![id])?;
    Ok(())
}

/// Rename a tag across every shard. Renaming onto an existing tag merges them
/// (duplicates are removed). Returns the number of shards changed.
pub fn rename_tag(conn: &Connection, old: &str, new: &str) -> Result<usize> {
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
        save_shard(conn, &s)?;
        changed += 1;
    }
    Ok(changed)
}

/// Remove a tag from every shard. Returns the number of shards changed.
pub fn delete_tag(conn: &Connection, tag: &str) -> Result<usize> {
    let mut changed = 0;
    for mut s in all_shards(conn)? {
        if s.tags.iter().any(|t| t == tag) {
            s.tags.retain(|t| t != tag);
            save_shard(conn, &s)?;
            changed += 1;
        }
    }
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
    conn.execute(
        "INSERT INTO review_log (shard_id, deck_id, day, ts, rating, algorithm, duration_ms, session_id)
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

/// Serialize the whole vault to a pretty JSON string.
pub fn export_json(conn: &Connection) -> Result<String> {
    let export = VaultExport {
        shards: all_shards(conn)?,
        custom_languages: custom_languages(conn)?,
        decks: all_decks(conn)?,
        review_log: all_review_log(conn)?,
    };
    Ok(serde_json::to_string_pretty(&export).unwrap_or_else(|_| "{}".into()))
}

/// Import shards + custom languages from a parsed export.
/// Existing shard ids are skipped. Returns the number of shards imported.
pub fn import_export(conn: &Connection, export: &VaultExport) -> Result<usize> {
    // Decks first, so imported cards can resolve their deck_id.
    for deck in &export.decks {
        if get_deck(conn, &deck.id)?.is_none() {
            save_deck(conn, deck)?;
        }
    }
    let mut imported = 0usize;
    for shard in &export.shards {
        if get_shard(conn, &shard.id)?.is_none() {
            save_shard(conn, shard)?;
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
    // Adopt any card whose deck no longer exists (e.g. older exports) into the default deck.
    conn.execute(
        "UPDATE shards SET deck_id = ?1
         WHERE deck_id = '' OR deck_id IS NULL OR deck_id NOT IN (SELECT id FROM decks)",
        params![DEFAULT_DECK_ID],
    )?;
    Ok(imported)
}
