//! The sync loop: fetch, merge as records, publish.
//!
//! This is the only module that knows about all three of `vault`, `merge` and
//! `git`. It owns the ordering and the retry, and nothing else.
//!
//! The loop never lets git merge file contents. Remote records are read out of
//! the object store into a scratch directory, merged against the last synced
//! state by `merge.rs`, applied to SQLite, and re-serialized over the tree. Only
//! then is a commit recorded — with two parents when both sides had moved — so
//! git records ancestry for a tree that is already the merged answer.

use crate::db;
use crate::merge;
use crate::vault;
use rusqlite::Connection;
use serde::Serialize;
use std::path::{Path, PathBuf};

/// Settings keys owned by sync. None are in `db::SYNCED_SETTINGS`: they describe
/// this device's connection and must never replicate to another machine.
const REMOTE: &str = "sync_remote";
const LAST: &str = "sync_last";
const LAST_ERROR: &str = "sync_last_error";
const DEVICE: &str = "device_id";

/// How many times to re-run the loop when someone pushed while we were merging.
const MAX_ATTEMPTS: u8 = 3;

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatus {
    pub configured: bool,
    pub available: bool,
    pub remote: String,
    pub last_synced: String,
    pub last_error: String,
    pub device_id: String,
    pub pending_conflicts: usize,
}

pub fn vault_dir(app_dir: &Path) -> PathBuf {
    app_dir.join("vault")
}

fn setting(conn: &Connection, key: &str) -> String {
    db::get_setting(conn, key).ok().flatten().unwrap_or_default()
}

/// This device's stable id, minted once. Used to label conflicts so the UI can
/// say which machine a discarded edit came from.
pub fn device_id(conn: &Connection) -> String {
    let existing = setting(conn, DEVICE);
    if !existing.is_empty() {
        return existing;
    }
    let id = db::generate_id();
    let _ = db::set_setting(conn, DEVICE, &id);
    id
}

pub fn status(conn: &Connection) -> SyncStatus {
    let remote = setting(conn, REMOTE);
    SyncStatus {
        configured: !remote.is_empty(),
        available: crate::git::is_available(),
        remote,
        last_synced: setting(conn, LAST),
        last_error: setting(conn, LAST_ERROR),
        device_id: device_id(conn),
        pending_conflicts: db::list_conflicts(conn).map(|c| c.len()).unwrap_or(0),
    }
}

/// Point this device at a vault remote. An empty string disconnects it, leaving
/// the local vault untouched — Hearth stays fully usable offline.
pub fn configure(conn: &Connection, app_dir: &Path, remote: &str) -> Result<(), String> {
    let remote = remote.trim();
    db::set_setting(conn, REMOTE, remote).map_err(|e| e.to_string())?;
    if remote.is_empty() {
        return Ok(());
    }
    if !crate::git::is_available() {
        return Err("git is not installed or not on PATH — Hearth needs it to sync".into());
    }
    crate::git::ensure_repo(&vault_dir(app_dir), remote)
}

/// Run one sync. Returns a human-readable summary for the toast.
pub fn sync_now(conn: &Connection, app_dir: &Path) -> Result<String, String> {
    let result = run(conn, app_dir);
    match &result {
        Ok(_) => {
            let _ = db::set_setting(conn, LAST, &chrono::Local::now().to_rfc3339());
            let _ = db::set_setting(conn, LAST_ERROR, "");
        }
        Err(e) => {
            let _ = db::set_setting(conn, LAST_ERROR, e);
        }
    }
    result
}

fn run(conn: &Connection, app_dir: &Path) -> Result<String, String> {
    let remote = setting(conn, REMOTE);
    if remote.is_empty() {
        return Err("No vault remote configured (Settings → Sync)".into());
    }
    let dir = vault_dir(app_dir);
    crate::git::ensure_repo(&dir, &remote)?;

    for attempt in 1..=MAX_ATTEMPTS {
        match attempt_sync(conn, &dir) {
            Ok(summary) => return Ok(summary),
            // A push race means someone published between our fetch and our
            // push. Re-running the whole loop picks their work up and merges it.
            Err(e) if e == PUSH_RACE && attempt < MAX_ATTEMPTS => continue,
            Err(e) if e == PUSH_RACE => {
                return Err("The remote kept changing while syncing — try again".into())
            }
            Err(e) => return Err(e),
        }
    }
    unreachable!("loop returns on every path")
}

const PUSH_RACE: &str = "__push_race__";

fn attempt_sync(conn: &Connection, dir: &Path) -> Result<String, String> {
    let local = vault::read_db(conn).map_err(|e| e.to_string())?;

    // A remote with no branches yet is a brand-new private repo — there is
    // nothing to merge, so publish and we are done.
    if crate::git::remote_is_empty(dir)? {
        vault::write_tree(dir, &local).map_err(|e| e.to_string())?;
        let committed = crate::git::commit_all(dir, &commit_message(conn, &local), None)?;
        crate::git::push(dir)?;
        if let Some(id) = committed.or_else(|| crate::git::local_head(dir)) {
            crate::git::set_base(dir, &id)?;
        }
        return Ok(format!("Published {} cards to a new vault", local.cards.len()));
    }

    crate::git::fetch(dir)?;
    let remote_head = crate::git::remote_head(dir);

    // Read the remote and the last-synced state as file trees, using the same
    // reader as the local vault so all three sides are shaped identically.
    let scratch = crate::git::Scratch::new("remote").map_err(|e| e.to_string())?;
    let remote_data = match &remote_head {
        Some(rev) => {
            crate::git::export_tree(dir, rev, &scratch.0)?;
            vault::read_tree(&scratch.0).map_err(|e| e.to_string())?
        }
        None => vault::VaultData::default(),
    };

    let base_scratch = crate::git::Scratch::new("base").map_err(|e| e.to_string())?;
    let base_data = match crate::git::base_commit(dir) {
        Some(rev) => crate::git::export_tree(dir, &rev, &base_scratch.0)
            .ok()
            .and_then(|_| vault::read_tree(&base_scratch.0).ok()),
        None => None,
    };

    let merged = merge::merge(base_data.as_ref(), &local, &remote_data);

    let incoming = merged.data.cards.len() as i64 - local.cards.len() as i64;
    let conflicts = merged.conflicts.len();

    vault::write_db(conn, &merged.data).map_err(|e| e.to_string())?;
    // The Debt deck is derived from due dates and is deliberately not synced, so
    // recompute it now that the merged due dates have landed.
    let _ = db::sync_debt_deck(conn);

    let device = device_id(conn);
    for c in &merged.conflicts {
        let _ = db::record_conflict(conn, c.entity, &c.entity_id, &device, &c.losing_json);
    }

    vault::write_tree(dir, &merged.data).map_err(|e| e.to_string())?;
    let committed = crate::git::commit_all(
        dir,
        &commit_message(conn, &merged.data),
        remote_head.as_deref(),
    )?;

    if committed.is_some() {
        crate::git::push(dir).map_err(|e| {
            // Distinguish "someone beat us to it" (retryable) from a real error.
            if e.contains("non-fast-forward") || e.contains("fetch first") || e.contains("rejected")
            {
                PUSH_RACE.to_string()
            } else {
                e
            }
        })?;
    }
    if let Some(id) = committed.or_else(|| crate::git::local_head(dir)) {
        crate::git::set_base(dir, &id)?;
    }

    Ok(summary(incoming, conflicts))
}

fn summary(incoming: i64, conflicts: usize) -> String {
    let mut parts = Vec::new();
    match incoming {
        n if n > 0 => parts.push(format!("{n} card{} in", plural(n as usize))),
        0 => parts.push("Up to date".into()),
        n => parts.push(format!("{} card{} removed", -n, plural((-n) as usize))),
    }
    if conflicts > 0 {
        parts.push(format!("{conflicts} conflict{} kept", plural(conflicts)));
    }
    parts.join(" · ")
}

fn plural(n: usize) -> &'static str {
    if n == 1 {
        ""
    } else {
        "s"
    }
}

fn commit_message(conn: &Connection, data: &vault::VaultData) -> String {
    format!(
        "hearth: {} cards, {} reviews [{}]",
        data.cards.len(),
        data.reviews.len(),
        device_id(conn)
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::Shard;
    use std::process::Command;

    struct Tmp(PathBuf);
    impl Tmp {
        fn new(tag: &str) -> Self {
            let p = std::env::temp_dir().join(format!(
                "hearth-sync-test-{tag}-{}",
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            std::fs::create_dir_all(&p).unwrap();
            Tmp(p)
        }
    }
    impl Drop for Tmp {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    /// A device: its own database and its own app-data directory.
    struct Device {
        conn: Connection,
        dir: PathBuf,
    }

    impl Device {
        fn new(root: &Path, name: &str, remote: &str) -> Self {
            let dir = root.join(name);
            std::fs::create_dir_all(&dir).unwrap();
            let conn = Connection::open_in_memory().unwrap();
            db::init(&conn).unwrap();
            let d = Device { conn, dir };
            configure(&d.conn, &d.dir, remote).unwrap();
            d
        }
        fn sync(&self) -> Result<String, String> {
            sync_now(&self.conn, &self.dir)
        }
        fn add(&self, id: &str, title: &str, modified: &str) {
            db::save_shard(
                &self.conn,
                &Shard {
                    id: id.into(),
                    title: title.into(),
                    modified_at: modified.into(),
                    deck_ids: vec![db::DEFAULT_DECK_ID.into()],
                    ..Default::default()
                },
            )
            .unwrap();
        }
        fn titles(&self) -> Vec<String> {
            let mut t: Vec<String> = db::all_shards(&self.conn)
                .unwrap()
                .into_iter()
                .map(|s| s.title)
                .collect();
            t.sort();
            t
        }
    }

    fn bare(at: &Path) -> String {
        std::fs::create_dir_all(at).unwrap();
        Command::new("git")
            .args(["init", "--bare", "-q", "-b", "main"])
            .arg(at)
            .output()
            .unwrap();
        at.to_string_lossy().to_string()
    }

    #[test]
    fn two_devices_converge_through_an_empty_remote() {
        let t = Tmp::new("converge");
        let remote = bare(&t.0.join("remote.git"));
        let a = Device::new(&t.0, "a", &remote);
        let b = Device::new(&t.0, "b", &remote);

        a.add("a1", "from A", "2026-01-01T00:00:00-05:00");
        a.sync().expect("A publishes to the empty remote");

        b.add("b1", "from B", "2026-01-02T00:00:00-05:00");
        b.sync().expect("B merges and publishes");
        a.sync().expect("A picks up B's work");

        assert_eq!(a.titles(), vec!["from A", "from B"]);
        assert_eq!(b.titles(), vec!["from A", "from B"]);
    }

    #[test]
    fn a_review_on_one_device_lands_on_the_other() {
        let t = Tmp::new("review");
        let remote = bare(&t.0.join("remote.git"));
        let a = Device::new(&t.0, "a", &remote);
        let b = Device::new(&t.0, "b", &remote);

        a.add("c1", "card", "2026-01-01T00:00:00-05:00");
        a.sync().unwrap();
        b.sync().unwrap();

        // B studies the card: schedule moves and a review row is logged.
        let mut card = db::get_shard(&b.conn, "c1").unwrap().unwrap();
        card.review_interval = 6;
        card.review_next = "2026-03-01".into();
        card.modified_at = "2026-02-01T00:00:00-05:00".into();
        db::save_shard(&b.conn, &card).unwrap();
        db::log_review(&b.conn, "c1", "default", "good", "sm2", 4200, "sess-1").unwrap();
        b.sync().unwrap();
        a.sync().unwrap();

        let landed = db::get_shard(&a.conn, "c1").unwrap().unwrap();
        assert_eq!(landed.review_interval, 6, "the schedule must travel");
        assert_eq!(landed.review_next, "2026-03-01");
        assert_eq!(
            db::all_review_log(&a.conn).unwrap().len(),
            1,
            "and so must the review history"
        );
    }

    #[test]
    fn a_delete_does_not_resurrect() {
        let t = Tmp::new("delete");
        let remote = bare(&t.0.join("remote.git"));
        let a = Device::new(&t.0, "a", &remote);
        let b = Device::new(&t.0, "b", &remote);

        a.add("x", "doomed", "2026-01-01T00:00:00-05:00");
        a.sync().unwrap();
        b.sync().unwrap();
        assert_eq!(b.titles(), vec!["doomed"]);

        db::delete_shard(&a.conn, "x").unwrap();
        a.sync().unwrap();
        b.sync().unwrap();

        assert!(b.titles().is_empty(), "the delete must propagate");
        // And it must stay deleted after another round trip.
        a.sync().unwrap();
        b.sync().unwrap();
        assert!(a.titles().is_empty() && b.titles().is_empty());
    }

    #[test]
    fn a_double_edit_keeps_the_newest_and_records_the_loser() {
        let t = Tmp::new("conflict");
        let remote = bare(&t.0.join("remote.git"));
        let a = Device::new(&t.0, "a", &remote);
        let b = Device::new(&t.0, "b", &remote);

        a.add("c", "original", "2026-01-01T00:00:00-05:00");
        a.sync().unwrap();
        b.sync().unwrap();

        // Both edit the same card before either syncs.
        a.add("c", "edited on A", "2026-03-01T00:00:00-05:00");
        b.add("c", "edited on B", "2026-02-01T00:00:00-05:00");
        b.sync().unwrap();
        a.sync().unwrap();
        b.sync().unwrap();

        assert_eq!(a.titles(), vec!["edited on A"], "newest wins");
        assert_eq!(b.titles(), vec!["edited on A"], "and both devices agree");

        let kept = db::list_conflicts(&a.conn).unwrap();
        assert_eq!(kept.len(), 1);
        assert!(kept[0].losing_json.contains("edited on B"), "loser is recoverable");
        assert!(!kept[0].device_id.is_empty(), "and is attributed to a device");
    }

    #[test]
    fn syncing_with_no_changes_is_idempotent() {
        let t = Tmp::new("idempotent");
        let remote = bare(&t.0.join("remote.git"));
        let a = Device::new(&t.0, "a", &remote);
        a.add("c", "card", "2026-01-01T00:00:00-05:00");

        a.sync().unwrap();
        for _ in 0..3 {
            assert_eq!(a.sync().unwrap(), "Up to date");
        }
        assert_eq!(a.titles(), vec!["card"]);
    }

    #[test]
    fn an_unconfigured_vault_reports_rather_than_failing() {
        let t = Tmp::new("unconfigured");
        let conn = Connection::open_in_memory().unwrap();
        db::init(&conn).unwrap();

        let st = status(&conn);
        assert!(!st.configured, "sync is off until a remote is set");
        assert!(sync_now(&conn, &t.0).is_err());
        // The app must stay fully usable with no remote.
        db::save_shard(
            &conn,
            &Shard {
                id: "c".into(),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(db::all_shards(&conn).unwrap().len(), 1);
    }

    /// End-to-end against a *real* vault, opt-in because it needs one.
    ///
    ///   HEARTH_REAL_VAULT=~/.local/share/com.bonfire.app/vault.db \
    ///     cargo test real_vault -- --ignored --nocapture
    ///
    /// Copies the given database (never touching the original), migrates it,
    /// publishes it to a scratch remote, pulls it into a second empty device,
    /// and checks the whole library — cards, decks, memberships, schedules and
    /// review history — arrived intact.
    #[test]
    #[ignore = "needs HEARTH_REAL_VAULT; run explicitly"]
    fn real_vault_migrates_and_syncs_to_a_second_device() {
        let Ok(src) = std::env::var("HEARTH_REAL_VAULT") else {
            eprintln!("HEARTH_REAL_VAULT unset — skipping");
            return;
        };
        let t = Tmp::new("realvault");
        let remote = bare(&t.0.join("remote.git"));

        // Device A: a copy of the real database, opened (which migrates it).
        let a_dir = t.0.join("a");
        std::fs::create_dir_all(&a_dir).unwrap();
        let a_db = a_dir.join("vault.db");
        std::fs::copy(&src, &a_db).expect("copy the real vault");
        let a = Connection::open(&a_db).unwrap();
        db::init(&a).expect("migrate the real vault");

        let cards_before = db::all_shards(&a).unwrap().len();
        let decks_before = db::all_decks(&a).unwrap().len();
        let reviews_before = db::all_review_log(&a).unwrap().len();
        let memberships_before: i64 = a
            .query_row("SELECT COUNT(*) FROM card_decks", [], |r| r.get(0))
            .unwrap();
        eprintln!(
            "device A after migration: {cards_before} cards, {decks_before} decks, \
             {memberships_before} memberships, {reviews_before} reviews"
        );
        assert!(cards_before > 0, "the real vault should not be empty");

        configure(&a, &a_dir, &remote).unwrap();
        eprintln!("A: {}", sync_now(&a, &a_dir).expect("A publishes"));

        // Device B: entirely empty, same remote.
        let b_dir = t.0.join("b");
        std::fs::create_dir_all(&b_dir).unwrap();
        let b = Connection::open_in_memory().unwrap();
        db::init(&b).unwrap();
        configure(&b, &b_dir, &remote).unwrap();
        eprintln!("B: {}", sync_now(&b, &b_dir).expect("B pulls"));

        assert_eq!(db::all_shards(&b).unwrap().len(), cards_before, "cards");
        assert_eq!(db::all_decks(&b).unwrap().len(), decks_before, "decks");
        assert_eq!(
            db::all_review_log(&b).unwrap().len(),
            reviews_before,
            "review history"
        );

        // Spot-check that content and schedule survived, not just the row count.
        let sample = db::all_shards(&a).unwrap().into_iter().find(|s| !s.code.is_empty());
        if let Some(orig) = sample {
            let got = db::get_shard(&b, &orig.id).unwrap().expect("card present on B");
            assert_eq!(got.title, orig.title);
            assert_eq!(got.code, orig.code);
            assert_eq!(got.review_next, orig.review_next, "schedule must travel");
            assert_eq!(got.review_ease, orig.review_ease);
            assert_eq!(got.tags, orig.tags);
            eprintln!("spot-checked card {} ({})", orig.id, orig.title);
        }

        // Deck membership is the easiest thing to lose, since it lives in a join
        // table rather than on the card row.
        let memberships_after: i64 = b
            .query_row("SELECT COUNT(*) FROM card_decks", [], |r| r.get(0))
            .unwrap();
        eprintln!("device B: {memberships_after} memberships");
        assert!(
            memberships_after >= memberships_before - cards_before as i64,
            "deck memberships were lost: {memberships_before} -> {memberships_after}"
        );
    }

    #[test]
    fn two_users_on_separate_remotes_never_see_each_other() {
        // The shared-with-a-friend case: each person points Hearth at their own
        // private vault. The remote is per-install, so nothing should cross.
        let t = Tmp::new("twousers");
        let mine = bare(&t.0.join("mine.git"));
        let theirs = bare(&t.0.join("theirs.git"));

        let me = Device::new(&t.0, "me", &mine);
        let friend = Device::new(&t.0, "friend", &theirs);

        me.add("m1", "my card", "2026-01-01T00:00:00-05:00");
        friend.add("f1", "their card", "2026-01-01T00:00:00-05:00");
        me.sync().unwrap();
        friend.sync().unwrap();

        // Their second machine pulls from *their* remote only.
        let friend2 = Device::new(&t.0, "friend2", &theirs);
        friend2.sync().unwrap();

        assert_eq!(me.titles(), vec!["my card"]);
        assert_eq!(friend.titles(), vec!["their card"]);
        assert_eq!(friend2.titles(), vec!["their card"], "their vault follows them");

        // Re-syncing everyone must not leak either way.
        me.sync().unwrap();
        friend.sync().unwrap();
        assert_eq!(me.titles(), vec!["my card"], "my vault stayed mine");
        assert_eq!(friend.titles(), vec!["their card"], "and theirs stayed theirs");
    }

    #[test]
    fn a_fresh_install_starts_blank_and_the_remote_repopulates_it() {
        // The documented fresh-install contract: a new machine's vault starts
        // empty and the configured remote is the source of truth.
        let t = Tmp::new("freshinstall");
        let remote = bare(&t.0.join("remote.git"));

        let first = Device::new(&t.0, "first", &remote);
        first.add("a", "studied earlier", "2026-01-01T00:00:00-05:00");
        first.sync().unwrap();

        let reinstalled = Device::new(&t.0, "reinstalled", &remote);
        assert!(reinstalled.titles().is_empty(), "a fresh vault starts blank");
        reinstalled.sync().unwrap();
        assert_eq!(reinstalled.titles(), vec!["studied earlier"], "the remote restores it");
    }

    #[test]
    fn media_survives_a_round_trip_between_devices() {
        let t = Tmp::new("media");
        let remote = bare(&t.0.join("remote.git"));
        let a = Device::new(&t.0, "a", &remote);
        let b = Device::new(&t.0, "b", &remote);

        const PNG: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
        db::save_shard(
            &a.conn,
            &Shard {
                id: "m".into(),
                title: "with image".into(),
                modified_at: "2026-01-01T00:00:00-05:00".into(),
                media: vec![crate::models::MediaItem {
                    id: "img1".into(),
                    kind: "image".into(),
                    data_url: format!("data:image/png;base64,{PNG}"),
                    ..Default::default()
                }],
                ..Default::default()
            },
        )
        .unwrap();
        a.sync().unwrap();
        b.sync().unwrap();

        let got = db::get_shard(&b.conn, "m").unwrap().unwrap();
        assert_eq!(got.media.len(), 1);
        assert_eq!(got.media[0].data_url, format!("data:image/png;base64,{PNG}"));
        // On disk it must be a real binary file, not base64 in the card JSON.
        let png = vault_dir(&b.dir).join("media").join("img1.png");
        assert!(png.exists());
        assert_eq!(&std::fs::read(&png).unwrap()[..4], b"\x89PNG");
    }
}
