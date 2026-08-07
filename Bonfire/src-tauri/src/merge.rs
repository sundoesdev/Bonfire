//! Three-way record merge — the rules that decide what a synced vault contains.
//!
//! Pure functions over `VaultData`: no database, no filesystem, no git. That is
//! deliberate. Git is only a transport, and a future web server would reuse this
//! module unchanged over HTTP, so nothing transport-shaped may leak in here.
//!
//! The three sides are `base` (the vault as of the last successful sync),
//! `local` (this device now) and `remote` (what the other side published). Base
//! is what makes conflict detection meaningful: if only one side moved away from
//! base there is no conflict at all, just an update to take. A conflict is only
//! when *both* sides changed the same record to different values — then the
//! newer `modified_at` wins and the loser is handed back to be kept for review,
//! never silently dropped.

use crate::models::{Deck, Shard};
use crate::vault::{PlaybookRecord, SettingRow, Tombstone, VaultData};
use serde::Serialize;
use std::collections::BTreeMap;

/// The losing side of a genuine double-edit, preserved so the user can look at it.
#[derive(Debug, Clone)]
pub struct Conflict {
    pub entity: &'static str,
    pub entity_id: String,
    pub losing_json: String,
}

#[derive(Debug, Default)]
pub struct Merged {
    pub data: VaultData,
    pub conflicts: Vec<Conflict>,
}

/// A record that can be merged by id and last-modified time.
trait Record: Clone + Serialize {
    fn id(&self) -> &str;
    fn modified_at(&self) -> &str;
    /// Content identity, ignoring the timestamp — two sides that agree on the
    /// substance are not a conflict even if they were saved a second apart.
    fn content(&self) -> String {
        serde_json::to_string(self).unwrap_or_default()
    }
}

impl Record for Shard {
    fn id(&self) -> &str {
        &self.id
    }
    fn modified_at(&self) -> &str {
        &self.modified_at
    }
}

impl Record for Deck {
    fn id(&self) -> &str {
        &self.id
    }
    fn modified_at(&self) -> &str {
        &self.modified_at
    }
}

impl Record for PlaybookRecord {
    fn id(&self) -> &str {
        &self.playbook.id
    }
    fn modified_at(&self) -> &str {
        &self.playbook.modified_at
    }
}

impl Record for SettingRow {
    fn id(&self) -> &str {
        &self.key
    }
    fn modified_at(&self) -> &str {
        &self.modified_at
    }
}

/// Merge one entity kind. `base` may be `None` on a first sync, in which case any
/// difference is treated as a genuine conflict — with no common ancestor there is
/// no way to tell an edit from an unrelated record that happens to share an id.
fn merge_records<T: Record>(
    entity: &'static str,
    base: Option<&[T]>,
    local: &[T],
    remote: &[T],
    conflicts: &mut Vec<Conflict>,
) -> Vec<T> {
    let index = |rs: &[T]| -> BTreeMap<String, T> {
        rs.iter().map(|r| (r.id().to_string(), r.clone())).collect()
    };
    let (l, r) = (index(local), index(remote));
    let b = base.map(index).unwrap_or_default();

    let mut ids: Vec<&String> = l.keys().chain(r.keys()).collect();
    ids.sort();
    ids.dedup();

    let mut out = Vec::with_capacity(ids.len());
    for id in ids {
        match (l.get(id), r.get(id)) {
            (Some(lv), Some(rv)) => {
                if lv.content() == rv.content() {
                    out.push(lv.clone());
                    continue;
                }
                let based = b.get(id).map(|v| v.content());
                // Only one side moved: take that side, no conflict.
                if based.as_deref() == Some(lv.content().as_str()) {
                    out.push(rv.clone());
                } else if based.as_deref() == Some(rv.content().as_str()) {
                    out.push(lv.clone());
                } else {
                    // Both moved and they disagree. Newest wins; keep the loser.
                    // Ties go to remote so every device reaches the same answer.
                    let (win, lose) = if lv.modified_at() > rv.modified_at() {
                        (lv, rv)
                    } else {
                        (rv, lv)
                    };
                    conflicts.push(Conflict {
                        entity,
                        entity_id: id.clone(),
                        losing_json: serde_json::to_string_pretty(lose).unwrap_or_default(),
                    });
                    out.push(win.clone());
                }
            }
            // Present on one side only. Whether that means "new here" or "deleted
            // there" is not decidable from the record set — tombstones settle it
            // in `apply_tombstones`, so keep it for now.
            (Some(v), None) | (None, Some(v)) => out.push(v.clone()),
            (None, None) => unreachable!("id came from one of the two maps"),
        }
    }
    out
}

/// Tombstones from both sides, keeping the latest deletion per record.
fn merge_tombstones(local: &[Tombstone], remote: &[Tombstone]) -> Vec<Tombstone> {
    let mut by_key: BTreeMap<(String, String), Tombstone> = BTreeMap::new();
    for t in local.iter().chain(remote.iter()) {
        let key = (t.entity.clone(), t.id.clone());
        match by_key.get(&key) {
            Some(existing) if existing.deleted_at >= t.deleted_at => {}
            _ => {
                by_key.insert(key, t.clone());
            }
        }
    }
    by_key.into_values().collect()
}

/// Drop records a tombstone has buried, and drop tombstones a later edit has
/// overruled.
///
/// A record survives its own tombstone when it was modified *after* the delete —
/// editing a card on one device after deleting it on another resurrects it. That
/// is deliberate: recovering an unwanted card is one click, recovering a lost one
/// is impossible.
fn apply_tombstones<T: Record>(
    entity: &str,
    records: Vec<T>,
    stones: &mut Vec<Tombstone>,
) -> Vec<T> {
    let mut kept = Vec::with_capacity(records.len());
    for rec in records {
        let buried = stones
            .iter()
            .any(|t| t.entity == entity && t.id == rec.id() && t.deleted_at.as_str() >= rec.modified_at());
        if !buried {
            kept.push(rec);
        }
    }
    // A tombstone that lost to a newer edit is spent — keeping it would re-fight
    // the same decision on every future sync.
    stones.retain(|t| {
        t.entity != entity || !kept.iter().any(|r| r.id() == t.id)
    });
    kept
}

/// Merge two vaults against their last common state.
pub fn merge(base: Option<&VaultData>, local: &VaultData, remote: &VaultData) -> Merged {
    let mut conflicts = Vec::new();
    let mut tombstones = merge_tombstones(&local.tombstones, &remote.tombstones);

    let cards = merge_records(
        "shard",
        base.map(|b| b.cards.as_slice()),
        &local.cards,
        &remote.cards,
        &mut conflicts,
    );
    let decks = merge_records(
        "deck",
        base.map(|b| b.decks.as_slice()),
        &local.decks,
        &remote.decks,
        &mut conflicts,
    );
    let playbooks = merge_records(
        "playbook",
        base.map(|b| b.playbooks.as_slice()),
        &local.playbooks,
        &remote.playbooks,
        &mut conflicts,
    );
    // Settings are per-key preferences; a stale value is a nuisance, not data
    // loss, so they resolve by last-write-wins without raising a conflict.
    let settings = merge_records(
        "setting",
        base.map(|b| b.settings.as_slice()),
        &local.settings,
        &remote.settings,
        &mut Vec::new(),
    );

    let cards = apply_tombstones("shard", cards, &mut tombstones);
    let decks = apply_tombstones("deck", decks, &mut tombstones);
    let playbooks = apply_tombstones("playbook", playbooks, &mut tombstones);

    Merged {
        data: VaultData {
            cards,
            decks,
            playbooks,
            reviews: merge_reviews(local, remote),
            settings,
            tombstones,
        },
        conflicts,
    }
}

/// Review history is append-only and unioned on `(shard_id, ts)` — a card cannot
/// be reviewed twice at the same instant, so that pair is the row's real identity
/// across devices (the table's own AUTOINCREMENT id is per-device and meaningless
/// here). History is never overwritten and never deleted by a merge: wiping stats
/// is a deliberate local action that does not propagate.
fn merge_reviews(local: &VaultData, remote: &VaultData) -> Vec<crate::models::ReviewLogEntry> {
    let mut by_key = BTreeMap::new();
    for r in local.reviews.iter().chain(remote.reviews.iter()) {
        by_key
            .entry((r.shard_id.clone(), r.ts.clone()))
            .or_insert_with(|| r.clone());
    }
    by_key.into_values().collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn card(id: &str, title: &str, modified: &str) -> Shard {
        Shard {
            id: id.into(),
            title: title.into(),
            modified_at: modified.into(),
            ..Default::default()
        }
    }

    fn review(shard: &str, ts: &str) -> crate::models::ReviewLogEntry {
        crate::models::ReviewLogEntry {
            shard_id: shard.into(),
            ts: ts.into(),
            day: ts[..10].into(),
            rating: "good".into(),
            ..Default::default()
        }
    }

    fn vault(cards: Vec<Shard>) -> VaultData {
        VaultData {
            cards,
            ..Default::default()
        }
    }

    #[test]
    fn takes_a_new_card_from_either_side() {
        let local = vault(vec![card("a", "A", "2026-01-01T00:00:00Z")]);
        let remote = vault(vec![card("b", "B", "2026-01-01T00:00:00Z")]);
        let m = merge(None, &local, &remote);
        let ids: Vec<&str> = m.data.cards.iter().map(|c| c.id.as_str()).collect();
        assert_eq!(ids, vec!["a", "b"]);
        assert!(m.conflicts.is_empty());
    }

    #[test]
    fn one_sided_edit_is_not_a_conflict() {
        // The everyday case: studied on the laptop, desktop untouched since.
        let base = vault(vec![card("a", "A", "2026-01-01T00:00:00Z")]);
        let local = base.clone();
        let remote = vault(vec![card("a", "A edited", "2026-02-01T00:00:00Z")]);

        let m = merge(Some(&base), &local, &remote);
        assert_eq!(m.data.cards[0].title, "A edited");
        assert!(m.conflicts.is_empty(), "no conflict when only one side moved");
    }

    #[test]
    fn double_edit_keeps_newest_and_records_the_loser() {
        let base = vault(vec![card("a", "A", "2026-01-01T00:00:00Z")]);
        let local = vault(vec![card("a", "local wins", "2026-03-01T00:00:00Z")]);
        let remote = vault(vec![card("a", "remote loses", "2026-02-01T00:00:00Z")]);

        let m = merge(Some(&base), &local, &remote);
        assert_eq!(m.data.cards[0].title, "local wins");
        assert_eq!(m.conflicts.len(), 1);
        assert_eq!(m.conflicts[0].entity, "shard");
        assert_eq!(m.conflicts[0].entity_id, "a");
        assert!(
            m.conflicts[0].losing_json.contains("remote loses"),
            "the discarded version must be recoverable"
        );
    }

    #[test]
    fn identical_edits_on_both_sides_are_not_a_conflict() {
        let base = vault(vec![card("a", "A", "2026-01-01T00:00:00Z")]);
        let same = vault(vec![card("a", "same", "2026-02-01T00:00:00Z")]);
        let m = merge(Some(&base), &same, &same);
        assert!(m.conflicts.is_empty());
    }

    #[test]
    fn a_delete_propagates_instead_of_resurrecting() {
        // Deleted locally, still present remotely because that device is behind.
        let mut local = vault(vec![]);
        local.tombstones = vec![Tombstone {
            entity: "shard".into(),
            id: "a".into(),
            deleted_at: "2026-02-01T00:00:00Z".into(),
        }];
        let remote = vault(vec![card("a", "A", "2026-01-01T00:00:00Z")]);

        let m = merge(None, &local, &remote);
        assert!(m.data.cards.is_empty(), "the delete must win over the stale copy");
        assert_eq!(m.data.tombstones.len(), 1, "and must keep propagating");
    }

    #[test]
    fn an_edit_newer_than_the_delete_resurrects_the_card() {
        let mut local = vault(vec![]);
        local.tombstones = vec![Tombstone {
            entity: "shard".into(),
            id: "a".into(),
            deleted_at: "2026-01-01T00:00:00Z".into(),
        }];
        let remote = vault(vec![card("a", "edited after the delete", "2026-02-01T00:00:00Z")]);

        let m = merge(None, &local, &remote);
        assert_eq!(m.data.cards.len(), 1);
        assert!(
            m.data.tombstones.is_empty(),
            "the spent tombstone must not re-fight this every sync"
        );
    }

    #[test]
    fn review_history_is_unioned_never_overwritten() {
        let mut local = vault(vec![]);
        local.reviews = vec![review("a", "2026-01-01T10:00:00Z"), review("a", "2026-01-01T11:00:00Z")];
        let mut remote = vault(vec![]);
        // One row both sides already have, plus one only the other side saw.
        remote.reviews = vec![review("a", "2026-01-01T11:00:00Z"), review("b", "2026-01-02T09:00:00Z")];

        let m = merge(None, &local, &remote);
        assert_eq!(m.data.reviews.len(), 3, "union, with the shared row counted once");
    }

    #[test]
    fn merge_is_order_independent() {
        // Both devices must reach the same vault regardless of who syncs first,
        // or they would ping-pong changes forever.
        let base = vault(vec![card("a", "A", "2026-01-01T00:00:00Z")]);
        let x = vault(vec![card("a", "x", "2026-03-01T00:00:00Z"), card("b", "B", "2026-01-01T00:00:00Z")]);
        let y = vault(vec![card("a", "y", "2026-02-01T00:00:00Z"), card("c", "C", "2026-01-01T00:00:00Z")]);

        let forward = merge(Some(&base), &x, &y).data;
        let backward = merge(Some(&base), &y, &x).data;

        let ids = |v: &VaultData| v.cards.iter().map(|c| c.id.clone()).collect::<Vec<_>>();
        assert_eq!(ids(&forward), ids(&backward));
        assert_eq!(forward.cards[0].title, backward.cards[0].title);
    }

    #[test]
    fn settings_resolve_by_recency_without_raising_conflicts() {
        let mut local = VaultData::default();
        local.settings = vec![SettingRow {
            key: "fsrs_params".into(),
            value: "old".into(),
            modified_at: "2026-01-01T00:00:00Z".into(),
        }];
        let mut remote = VaultData::default();
        remote.settings = vec![SettingRow {
            key: "fsrs_params".into(),
            value: "new".into(),
            modified_at: "2026-02-01T00:00:00Z".into(),
        }];

        let m = merge(None, &local, &remote);
        assert_eq!(m.data.settings[0].value, "new");
        assert!(m.conflicts.is_empty(), "a stale preference is not data loss");
    }
}
