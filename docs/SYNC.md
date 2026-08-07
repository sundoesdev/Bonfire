# Sync design

How Hearth keeps a vault identical across machines, and why it is built this way.

For setup instructions see the [README](../README.md#sync). This document is the
design record.

## The shape of the problem

Hearth's source of truth is a SQLite database at
`~/.local/share/com.bonfire.app/vault.db`. Sync has to move *records* between
machines — a card whose schedule advanced, a review that happened, a deck that
was renamed — and reconcile them when both sides moved.

The pre-existing JSON export could not do this. `db::import_export` is
insert-if-absent: it skips any card whose id already exists and restores review
history only into an empty log. That is a correct *restore into a blank vault*,
and a wrong *merge*, because it can neither carry an edit nor propagate a delete.

## Why git

Without a server to run, the realistic transports were git, a file-sync daemon,
or paid hosting. File sync (Syncthing, Nextcloud, Dropbox) needs both machines
online simultaneously, so a desktop that is off when the laptop opens syncs
nothing — and it has no merge semantics, so concurrent edits produce conflict
copies. Paid hosting costs money and puts study data on someone else's machine.

Git is free, private, already authenticated on any developer's machine, works
store-and-forward so the two machines never need to be on at once, and gives
version history on study data as a side effect.

Hearth shells out to the system `git` binary rather than linking libgit2. The
decisive reason is credentials: the user's existing SSH agent or credential
helper performs the authentication, so **Hearth never stores and never sees a
secret**. It also adds no dependency. The cost is that `git` must be on `PATH`.

## The vault format

The vault is a git repository at `~/.local/share/com.bonfire.app/vault/`, which
Hearth owns and is the only writer of. It is a *projection* of SQLite, not a tree
anyone edits by hand.

```
hearth-vault.json      { formatVersion }
cards/<id>.json        one card
decks/<id>.json
playbooks/<id>.json    playbook + its nodes
media/<id>.png         decoded binary attachments
reviews/<YYYY-MM-DD>.jsonl
settings.json          allowlisted keys only
tombstones.json
```

**One file per record** is the whole point. Git deltas well only when a change
touches a small file; a whole-vault snapshot would be rewritten in full on every
rating, which at a few thousand cards is megabytes per commit. Rating a card now
rewrites one ~1.5 KB file.

**Media becomes real files.** Attachments live in the database as base64
data-URLs. Inline, every snapshot re-encodes every image; extracted, each blob is
written once, is 33% smaller than its base64 form, and is never touched again.

**Reviews are grouped by day**, so a study session rewrites only today's file
instead of re-touching all history.

Two things are deliberately *not* in the vault:

- **Debt-deck membership.** It is derived locally from due dates by
  `sync_debt_deck`, so syncing it would rewrite every card's file whenever a due
  date passed on one machine. It is recomputed after each merge.
- **Device-local settings.** Theme, font, UI scale, vim mode, the active settings
  tab, and the current deck filter stay on their machine. Only the
  `SYNCED_SETTINGS` allowlist travels: scheduler choice and parameters, study
  config, card templates, add-defaults, daily deck, and daily progress. The
  `sync_*` keys and `device_id` describe the connection itself and never
  replicate.

## The sync loop

```
1. git fetch origin
2. read the remote tree, and the last-synced base, out of git's object store
3. merge as records into SQLite            (merge.rs)
4. re-serialize the merged result over the working tree
5. commit — with two parents when both sides had moved
6. git push
```

**Git is never asked to merge file contents.** Step 2 reads blobs; step 3 is our
own record merge; step 5 uses `git commit-tree` to record a commit whose tree is
*already* the merged answer, with both histories as parents. Git only records
ancestry. A textual conflict is therefore structurally impossible, the push is
always a fast-forward, and both machines' histories survive.

A rejected push means someone published between our fetch and our push. That is
detected specifically and re-runs the whole loop (up to three times), so their
work is merged rather than clobbered. Any other git error surfaces unchanged.

### First run

Two cases exist before `origin/main` does:

- **Empty remote.** A freshly created private repo has no branches. Detected via
  `git ls-remote --heads`, and handled by publishing rather than merging. This is
  the state every new user's vault starts in.
- **No git identity.** `git commit` hard-fails without `user.name`/`user.email`.
  Hearth sets a repo-local fallback on the vault clone so a vault commit can
  never fail for this reason.

## Merge rules

`merge.rs` is pure functions over records: no database, no filesystem, no git.
That separation is deliberate — see [WEBAPP.md](WEBAPP.md).

Three sides: **base** (the vault at the last successful sync, tracked by the
`refs/hearth/base` ref), **local**, and **remote**.

**Records** (cards, decks, playbooks):

1. If both sides agree on content, done — even if the timestamps differ.
2. If only one side moved away from base, take that side. **No conflict.** This
   is the common case by far: studied on the laptop, desktop untouched.
3. If both moved and they disagree, the newer `modifiedAt` wins. Ties go to
   remote so every device reaches the same answer. The losing version is written
   to the `sync_conflicts` table and shown in Settings → Sync.

**Tombstones.** Deleting a record writes a `(entity, id, deleted_at)` row.
Without this, "absent here, present there" is indistinguishable from "new there",
and a deleted card would flow straight back in. A tombstone buries a record only
when the delete is **newer** than the record's last edit — so editing a card on
one machine after deleting it on another *resurrects* it. That is intentional:
recovering an unwanted card is one click, recovering a lost one is impossible. A
tombstone that loses to a newer edit is spent and gets dropped, so it cannot
re-fight the same decision on every future sync.

**Review history** is unioned on `(shard_id, ts)` and never overwritten or
deleted by a merge. The table's own `id` is `AUTOINCREMENT` and meaningless
across devices — both machines number their rows 1..n — whereas a card cannot be
reviewed twice at the same instant, so that pair is the row's real identity.

**Settings** resolve by recency without raising a conflict; a stale preference is
a nuisance, not data loss.

The merge is **order-independent**: both devices reach the same vault regardless
of who syncs first. Without that they would ping-pong changes forever. There is a
test for exactly this.

## Known edge cases

- **Clock skew.** Last-write-wins compares wall clocks across machines. For a
  single user with roughly correct clocks this is fine, and the loser is always
  preserved. A badly wrong clock on one machine would make it win or lose
  everything.
- **`clear_review_log` is local-only.** Wiping stats does not propagate; the next
  sync pulls history back from the other machine. Wiping stats is a deliberate
  local action, and a destructive operation that silently propagated would be
  worse than one that does not.
- **`--force` on uninstall** deletes unsynced data with no recovery. It exists
  because refusing forever is its own trap, but it is not a normal path.

## Where the code lives

| File | Role |
|---|---|
| `Bonfire/src-tauri/src/vault.rs` | database ⇄ `VaultData` ⇄ file tree. Shape only. |
| `Bonfire/src-tauri/src/merge.rs` | the rules above. Pure; no I/O, no git. |
| `Bonfire/src-tauri/src/git.rs` | shell-out git primitives and the two-parent commit. |
| `Bonfire/src-tauri/src/sync.rs` | the loop, retry, and conflict recording. |
| `Bonfire/src/sync.js` | frontend helper: cadence, badge, one-at-a-time guard. |
| `Bonfire/src/views/settings.js` | the Sync tab. |

Run the tests with `cd Bonfire/src-tauri && cargo test`. They drive two
independent devices — separate databases, separate app-data directories —
through real bare git remotes.
