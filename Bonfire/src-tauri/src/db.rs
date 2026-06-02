use crate::models::{Shard, VaultExport};
use rusqlite::{params, Connection, Result};
use uuid::Uuid;

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
            review_next       TEXT    NOT NULL DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS custom_languages (
            name TEXT PRIMARY KEY
        );
        CREATE TABLE IF NOT EXISTS settings (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL DEFAULT ''
        );",
    )?;
    migrate(conn)
}

/// Lightweight migrations for databases created before a column existed.
fn migrate(conn: &Connection) -> Result<()> {
    let has_prompt: i64 = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('shards') WHERE name = 'prompt'",
        [],
        |r| r.get(0),
    )?;
    if has_prompt == 0 {
        conn.execute("ALTER TABLE shards ADD COLUMN prompt TEXT NOT NULL DEFAULT ''", [])?;
    }
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
    Ok(Shard {
        id: row.get("id")?,
        title: row.get("title")?,
        language: row.get("language")?,
        prompt: row.get("prompt")?,
        code: row.get("code")?,
        description: row.get("description")?,
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
    conn.execute(
        "INSERT INTO shards (id, title, language, prompt, code, description, tags, category,
            familiarity, source, related_ids, created_at, modified_at, last_reviewed,
            review_enabled, review_interval, review_reps, review_ease, review_next)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19)
         ON CONFLICT(id) DO UPDATE SET
            title=?2, language=?3, prompt=?4, code=?5, description=?6, tags=?7, category=?8,
            familiarity=?9, source=?10, related_ids=?11, created_at=?12, modified_at=?13,
            last_reviewed=?14, review_enabled=?15, review_interval=?16, review_reps=?17,
            review_ease=?18, review_next=?19",
        params![
            s.id, s.title, s.language, s.prompt, s.code, s.description, tags, s.category,
            s.familiarity, s.source, related, s.created_at, s.modified_at, s.last_reviewed,
            s.review_enabled as i64, s.review_interval, s.review_repetitions, s.review_ease,
            s.review_next,
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

/// Serialize the whole vault to a pretty JSON string.
pub fn export_json(conn: &Connection) -> Result<String> {
    let export = VaultExport {
        shards: all_shards(conn)?,
        custom_languages: custom_languages(conn)?,
    };
    Ok(serde_json::to_string_pretty(&export).unwrap_or_else(|_| "{}".into()))
}

/// Import shards + custom languages from a parsed export.
/// Existing shard ids are skipped. Returns the number of shards imported.
pub fn import_export(conn: &Connection, export: &VaultExport) -> Result<usize> {
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
    Ok(imported)
}
