//! The sync vault: a projection of the SQLite database as one file per record.
//!
//! Why files at all — the sync transport is git (see `git.rs`), and git only
//! deltas well when a change touches a small file. Rating one card rewrites one
//! ~1.5 KB `cards/<id>.json`, not a whole-vault snapshot. Card media, which is
//! held in the database as base64 data-URLs, becomes a real binary file written
//! once and never rewritten — that is the single biggest saving in repo size.
//!
//! This module owns *shape* only: database <-> `VaultData` <-> file tree.
//! Deciding which side of a divergence wins lives in `merge.rs`, and talking to
//! a remote lives in `git.rs`. Keeping those three apart is what lets a future
//! web server reuse the merge rules over a different transport.

use crate::db;
use crate::models::{Deck, Playbook, PlaybookNode, ReviewLogEntry, Shard};
use base64::Engine;
use rusqlite::{params, Connection, Result};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::Path;

/// Bumped only when the on-disk layout changes incompatibly.
pub const FORMAT_VERSION: u32 = 1;

const MANIFEST: &str = "hearth-vault.json";

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    format_version: u32,
}

/// A playbook travels with its nodes: nodes carry no timestamp of their own and
/// are already rewritten wholesale, so the tree is part of the playbook record.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PlaybookRecord {
    pub playbook: Playbook,
    pub nodes: Vec<PlaybookNode>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SettingRow {
    pub key: String,
    pub value: String,
    pub modified_at: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Tombstone {
    pub entity: String,
    pub id: String,
    pub deleted_at: String,
}

/// A whole vault in memory — the unit both the serializer and the merge work on.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct VaultData {
    pub cards: Vec<Shard>,
    pub decks: Vec<Deck>,
    pub playbooks: Vec<PlaybookRecord>,
    pub reviews: Vec<ReviewLogEntry>,
    pub settings: Vec<SettingRow>,
    pub tombstones: Vec<Tombstone>,
}

// ---------------------------------------------------------------- database

/// Snapshot the database into a `VaultData`.
pub fn read_db(conn: &Connection) -> Result<VaultData> {
    let mut playbooks = Vec::new();
    for p in db::all_playbooks(conn)? {
        let nodes = db::playbook_nodes(conn, &p.id)?;
        playbooks.push(PlaybookRecord {
            playbook: p,
            nodes,
        });
    }
    Ok(VaultData {
        cards: db::all_shards(conn)?,
        decks: db::all_decks(conn)?,
        playbooks,
        reviews: db::all_review_log(conn)?,
        settings: db::synced_settings(conn)?
            .into_iter()
            .map(|(key, value, modified_at)| SettingRow {
                key,
                value,
                modified_at,
            })
            .collect(),
        tombstones: db::all_tombstones(conn)?
            .into_iter()
            .map(|(entity, id, deleted_at)| Tombstone {
                entity,
                id,
                deleted_at,
            })
            .collect(),
    })
}

/// Apply a merged `VaultData` back onto the database.
///
/// Everything the vault owns is replaced wholesale inside one transaction, so a
/// failed merge can never leave a half-applied vault. Device-local settings are
/// not in `data` and are therefore never touched.
pub fn write_db(conn: &Connection, data: &VaultData) -> Result<()> {
    let tx = conn.unchecked_transaction()?;

    let keep: Vec<&str> = data.cards.iter().map(|c| c.id.as_str()).collect();
    delete_missing(conn, "shards", &keep)?;
    for card in &data.cards {
        db::save_shard_merged(conn, card)?;
    }

    // Never delete a deck that is still holding cards or that Hearth requires.
    let deck_ids: Vec<&str> = data.decks.iter().map(|d| d.id.as_str()).collect();
    for deck in &data.decks {
        db::save_deck(conn, deck)?;
    }
    for id in existing_ids(conn, "decks")? {
        if !deck_ids.contains(&id.as_str()) && id != db::DEFAULT_DECK_ID && id != db::DEBT_DECK_ID {
            db::delete_deck_in_tx(conn, &id)?;
        }
    }

    let pb_ids: Vec<&str> = data.playbooks.iter().map(|p| p.playbook.id.as_str()).collect();
    for id in existing_ids(conn, "playbooks")? {
        if !pb_ids.contains(&id.as_str()) {
            db::delete_playbook_in_tx(conn, &id)?;
        }
    }
    for rec in &data.playbooks {
        db::save_playbook(conn, &rec.playbook)?;
        db::save_playbook_nodes_in_tx(conn, &rec.playbook.id, &rec.nodes)?;
    }

    for r in &data.reviews {
        conn.execute(
            "INSERT OR IGNORE INTO review_log
                (shard_id, deck_id, day, ts, rating, algorithm, duration_ms, session_id)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
            params![
                r.shard_id,
                r.deck_id,
                r.day,
                r.ts,
                r.rating,
                r.algorithm,
                r.duration_ms,
                r.session_id
            ],
        )?;
    }

    for s in &data.settings {
        if db::is_synced_setting(&s.key) {
            conn.execute(
                "INSERT INTO settings (key, value, modified_at) VALUES (?1,?2,?3)
                 ON CONFLICT(key) DO UPDATE SET value = ?2, modified_at = ?3",
                params![s.key, s.value, s.modified_at],
            )?;
        }
    }

    conn.execute("DELETE FROM tombstones", [])?;
    for t in &data.tombstones {
        conn.execute(
            "INSERT OR REPLACE INTO tombstones (entity, id, deleted_at) VALUES (?1,?2,?3)",
            params![t.entity, t.id, t.deleted_at],
        )?;
    }

    tx.commit()
}

fn existing_ids(conn: &Connection, table: &str) -> Result<Vec<String>> {
    let mut stmt = conn.prepare(&format!("SELECT id FROM {table}"))?;
    let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
    rows.collect()
}

/// Remove rows of `table` whose id is not in `keep`. Used to make the database
/// match the merged card set — a card deleted on another device has to actually
/// go away here, not just stop being written.
fn delete_missing(conn: &Connection, table: &str, keep: &[&str]) -> Result<()> {
    for id in existing_ids(conn, table)? {
        if !keep.contains(&id.as_str()) {
            conn.execute(&format!("DELETE FROM {table} WHERE id = ?1"), params![id])?;
            conn.execute("DELETE FROM card_decks WHERE card_id = ?1", params![id])?;
        }
    }
    Ok(())
}

// ---------------------------------------------------------------- file tree

/// Write `data` over the vault directory as one file per record.
///
/// Stale files are cleared first so a record deleted on another device leaves no
/// orphan behind; `media/` is preserved across the sweep because attachments are
/// content-addressed by id and rewriting them every sync would defeat the point.
pub fn write_tree(dir: &Path, data: &VaultData) -> std::io::Result<()> {
    for sub in ["cards", "decks", "playbooks", "reviews"] {
        let p = dir.join(sub);
        if p.exists() {
            std::fs::remove_dir_all(&p)?;
        }
        std::fs::create_dir_all(&p)?;
    }
    std::fs::create_dir_all(dir.join("media"))?;

    write_json(&dir.join(MANIFEST), &Manifest { format_version: FORMAT_VERSION })?;

    for card in &data.cards {
        let mut card = card.clone();
        // The Debt deck is derived locally from due dates by `sync_debt_deck`.
        // Syncing it would churn every card's file whenever a due date passed on
        // one machine, so membership is dropped here and recomputed on read.
        card.deck_ids.retain(|d| d != db::DEBT_DECK_ID);
        if card.deck_id == db::DEBT_DECK_ID {
            card.deck_id = card.deck_ids.first().cloned().unwrap_or_default();
        }
        for m in card.media.iter_mut() {
            if let Some((bytes, ext)) = decode_data_url(&m.data_url) {
                let name = format!("{}.{}", safe_name(&m.id), ext);
                std::fs::write(dir.join("media").join(&name), bytes)?;
                m.file = name;
                m.data_url = String::new();
            }
        }
        write_json(&dir.join("cards").join(format!("{}.json", safe_name(&card.id))), &card)?;
    }

    for deck in &data.decks {
        write_json(&dir.join("decks").join(format!("{}.json", safe_name(&deck.id))), deck)?;
    }
    for rec in &data.playbooks {
        let name = format!("{}.json", safe_name(&rec.playbook.id));
        write_json(&dir.join("playbooks").join(name), rec)?;
    }

    // Reviews are append-only and grouped by day: a study session rewrites only
    // today's file, so history stops being re-touched on every sync.
    let mut by_day: BTreeMap<&str, Vec<&ReviewLogEntry>> = BTreeMap::new();
    for r in &data.reviews {
        by_day.entry(if r.day.is_empty() { "undated" } else { &r.day }).or_default().push(r);
    }
    for (day, mut rows) in by_day {
        rows.sort_by(|a, b| (&a.ts, &a.shard_id).cmp(&(&b.ts, &b.shard_id)));
        let mut body = String::new();
        for r in rows {
            body.push_str(&serde_json::to_string(r).unwrap_or_default());
            body.push('\n');
        }
        std::fs::write(dir.join("reviews").join(format!("{}.jsonl", safe_name(day))), body)?;
    }

    let mut settings = data.settings.clone();
    settings.sort_by(|a, b| a.key.cmp(&b.key));
    write_json(&dir.join("settings.json"), &settings)?;

    let mut stones = data.tombstones.clone();
    stones.sort_by(|a, b| (&a.entity, &a.id).cmp(&(&b.entity, &b.id)));
    write_json(&dir.join("tombstones.json"), &stones)?;

    prune_media(dir, data)
}

/// Delete media files no card references any more.
fn prune_media(dir: &Path, data: &VaultData) -> std::io::Result<()> {
    let used: Vec<String> = data
        .cards
        .iter()
        .flat_map(|c| c.media.iter())
        .map(|m| {
            if m.file.is_empty() {
                decode_data_url(&m.data_url)
                    .map(|(_, ext)| format!("{}.{}", safe_name(&m.id), ext))
                    .unwrap_or_default()
            } else {
                m.file.clone()
            }
        })
        .collect();
    let media = dir.join("media");
    if !media.exists() {
        return Ok(());
    }
    for entry in std::fs::read_dir(&media)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().to_string();
        if !used.contains(&name) {
            std::fs::remove_file(entry.path())?;
        }
    }
    Ok(())
}

/// Parse a vault directory back into memory. A missing or empty directory reads
/// as an empty vault rather than an error — that is the first-sync case.
pub fn read_tree(dir: &Path) -> std::io::Result<VaultData> {
    let mut data = VaultData::default();
    if !dir.exists() {
        return Ok(data);
    }

    for path in json_files(&dir.join("cards")) {
        if let Some(mut card) = read_json::<Shard>(&path) {
            for m in card.media.iter_mut() {
                if !m.file.is_empty() {
                    let bytes = std::fs::read(dir.join("media").join(&m.file)).unwrap_or_default();
                    m.data_url = encode_data_url(&m.file, &bytes);
                    m.file = String::new();
                }
            }
            data.cards.push(card);
        }
    }
    for path in json_files(&dir.join("decks")) {
        if let Some(d) = read_json::<Deck>(&path) {
            data.decks.push(d);
        }
    }
    for path in json_files(&dir.join("playbooks")) {
        if let Some(p) = read_json::<PlaybookRecord>(&path) {
            data.playbooks.push(p);
        }
    }
    for path in json_files(&dir.join("reviews")) {
        let body = std::fs::read_to_string(&path).unwrap_or_default();
        for line in body.lines().filter(|l| !l.trim().is_empty()) {
            if let Ok(r) = serde_json::from_str::<ReviewLogEntry>(line) {
                data.reviews.push(r);
            }
        }
    }
    data.settings = read_json(&dir.join("settings.json")).unwrap_or_default();
    data.tombstones = read_json(&dir.join("tombstones.json")).unwrap_or_default();
    Ok(data)
}

fn json_files(dir: &Path) -> Vec<std::path::PathBuf> {
    let mut out: Vec<_> = std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_file())
        .collect();
    out.sort();
    out
}

fn read_json<T: for<'de> Deserialize<'de>>(path: &Path) -> Option<T> {
    serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()
}

fn write_json<T: Serialize>(path: &Path, value: &T) -> std::io::Result<()> {
    let mut body = serde_json::to_string_pretty(value).unwrap_or_else(|_| "{}".into());
    body.push('\n');
    std::fs::write(path, body)
}

/// Keep generated ids from escaping their directory. Hearth's own ids are
/// base36+hex, but a hand-edited or imported vault must not be able to write
/// outside the tree.
fn safe_name(id: &str) -> String {
    id.chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect()
}

// ---------------------------------------------------------------- data-URLs

/// `data:image/png;base64,AAAA` -> (bytes, "png").
fn decode_data_url(url: &str) -> Option<(Vec<u8>, String)> {
    let rest = url.strip_prefix("data:")?;
    let (meta, payload) = rest.split_once(',')?;
    if !meta.contains("base64") {
        return None;
    }
    let mime = meta.split(';').next().unwrap_or("");
    let bytes = base64::engine::general_purpose::STANDARD.decode(payload).ok()?;
    Some((bytes, ext_for_mime(mime)))
}

fn encode_data_url(file: &str, bytes: &[u8]) -> String {
    let ext = Path::new(file).extension().and_then(|e| e.to_str()).unwrap_or("bin");
    format!(
        "data:{};base64,{}",
        mime_for_ext(ext),
        base64::engine::general_purpose::STANDARD.encode(bytes)
    )
}

fn ext_for_mime(mime: &str) -> String {
    match mime {
        "image/png" => "png",
        "image/jpeg" | "image/jpg" => "jpg",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/svg+xml" => "svg",
        "audio/mpeg" | "audio/mp3" => "mp3",
        "audio/wav" | "audio/x-wav" => "wav",
        "audio/ogg" => "ogg",
        "audio/webm" => "weba",
        "audio/mp4" | "audio/x-m4a" => "m4a",
        _ => "bin",
    }
    .to_string()
}

fn mime_for_ext(ext: &str) -> &'static str {
    match ext {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "ogg" => "audio/ogg",
        "weba" => "audio/webm",
        "m4a" => "audio/mp4",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::MediaItem;

    /// A scratch directory that cleans itself up (avoids a `tempfile` dependency).
    struct TmpDir(std::path::PathBuf);
    impl TmpDir {
        fn new(tag: &str) -> Self {
            let p = std::env::temp_dir().join(format!(
                "hearth-vault-test-{tag}-{}",
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            std::fs::create_dir_all(&p).unwrap();
            TmpDir(p)
        }
    }
    impl Drop for TmpDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn vault_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        db::init(&conn).unwrap();
        conn
    }

    fn card(id: &str) -> Shard {
        Shard {
            id: id.into(),
            title: format!("card {id}"),
            code: "printf(\"hi\");".into(),
            modified_at: "2026-01-01T00:00:00-05:00".into(),
            deck_ids: vec![db::DEFAULT_DECK_ID.into()],
            ..Default::default()
        }
    }

    // A 1x1 transparent PNG.
    const PNG_B64: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

    #[test]
    fn db_to_tree_to_db_round_trips() {
        let src = vault_db();
        db::save_shard(&src, &card("a")).unwrap();
        db::save_shard(&src, &card("b")).unwrap();
        db::set_setting(&src, "fsrs_params", "{\"requestRetention\":0.9}").unwrap();
        db::log_review(&src, "a", "default", "good", "sm2", 1234, "sess-1").unwrap();

        let dir = TmpDir::new("roundtrip");
        let out = read_db(&src).unwrap();
        write_tree(&dir.0, &out).unwrap();

        // Land it in a completely separate database, as a second device would.
        let dst = vault_db();
        write_db(&dst, &read_tree(&dir.0).unwrap()).unwrap();

        let cards = db::all_shards(&dst).unwrap();
        assert_eq!(cards.len(), 2);
        assert_eq!(cards[0].code, "printf(\"hi\");");
        assert_eq!(db::all_review_log(&dst).unwrap().len(), 1);
        assert_eq!(
            db::get_setting(&dst, "fsrs_params").unwrap().unwrap(),
            "{\"requestRetention\":0.9}"
        );
    }

    #[test]
    fn media_becomes_a_real_file_and_comes_back_intact() {
        let src = vault_db();
        let mut c = card("a");
        c.media = vec![MediaItem {
            id: "m1".into(),
            kind: "image".into(),
            data_url: format!("data:image/png;base64,{PNG_B64}"),
            ..Default::default()
        }];
        db::save_shard(&src, &c).unwrap();

        let dir = TmpDir::new("media");
        write_tree(&dir.0, &read_db(&src).unwrap()).unwrap();

        // The blob must be a real binary file, not base64 inside the card JSON.
        let png = dir.0.join("media").join("m1.png");
        assert!(png.exists(), "media must be extracted to its own file");
        assert_eq!(&std::fs::read(&png).unwrap()[..4], b"\x89PNG");
        let card_json = std::fs::read_to_string(dir.0.join("cards").join("a.json")).unwrap();
        assert!(!card_json.contains("base64"), "card JSON must not carry the blob");
        assert!(card_json.contains("m1.png"));

        // And it must rebuild into a working data-URL on the far side.
        let back = read_tree(&dir.0).unwrap();
        assert_eq!(back.cards[0].media[0].data_url, format!("data:image/png;base64,{PNG_B64}"));
        assert!(back.cards[0].media[0].file.is_empty());
    }

    #[test]
    fn device_local_settings_never_reach_the_vault() {
        let src = vault_db();
        db::set_setting(&src, "ui_theme", "dark").unwrap();
        db::set_setting(&src, "sr_algorithm", "fsrs").unwrap();

        let dir = TmpDir::new("settings");
        write_tree(&dir.0, &read_db(&src).unwrap()).unwrap();
        let body = std::fs::read_to_string(dir.0.join("settings.json")).unwrap();
        assert!(body.contains("sr_algorithm"));
        assert!(!body.contains("ui_theme"), "theme is per-device, not per-user");
    }

    #[test]
    fn debt_membership_is_not_synced() {
        // Debt is recomputed locally from due dates; syncing it would rewrite
        // every card's file whenever a due date passed on one machine.
        let src = vault_db();
        let mut c = card("a");
        c.deck_ids = vec![db::DEFAULT_DECK_ID.into(), db::DEBT_DECK_ID.into()];
        db::save_shard(&src, &c).unwrap();

        let dir = TmpDir::new("debt");
        write_tree(&dir.0, &read_db(&src).unwrap()).unwrap();
        let body = std::fs::read_to_string(dir.0.join("cards").join("a.json")).unwrap();
        assert!(!body.contains(db::DEBT_DECK_ID));
    }

    #[test]
    fn a_deleted_card_leaves_no_orphan_file() {
        let src = vault_db();
        db::save_shard(&src, &card("a")).unwrap();
        db::save_shard(&src, &card("b")).unwrap();
        let dir = TmpDir::new("orphan");
        write_tree(&dir.0, &read_db(&src).unwrap()).unwrap();
        assert!(dir.0.join("cards").join("b.json").exists());

        db::delete_shard(&src, "b").unwrap();
        write_tree(&dir.0, &read_db(&src).unwrap()).unwrap();
        assert!(!dir.0.join("cards").join("b.json").exists());
    }

    #[test]
    fn reads_a_missing_vault_as_empty() {
        // First sync against a brand-new remote: nothing on disk yet.
        let data = read_tree(Path::new("/nonexistent/hearth/vault")).unwrap();
        assert!(data.cards.is_empty());
    }

    #[test]
    fn record_ids_cannot_escape_the_vault_directory() {
        assert_eq!(safe_name("../../etc/passwd"), "______etc_passwd");
        assert_eq!(safe_name("mql6j6gfa56314"), "mql6j6gfa56314");
    }
}
