//! Git transport for the sync vault.
//!
//! Hearth shells out to the system `git` rather than linking a git library. That
//! is a deliberate trade: it means the user's existing SSH agent, credential
//! helper or keychain performs the authentication, so **Hearth never stores, and
//! never sees, a credential**. It also adds no dependency — the cost is that
//! `git` must be on PATH, which the install script guarantees.
//!
//! The important property of the sync loop below is that **git is never asked to
//! merge file contents**. Remote records are read out of the object store, merged
//! as records by `merge.rs`, and the result is written over the tree. When both
//! sides have committed, the resulting commit is recorded with two parents via
//! `commit-tree`, so git records ancestry for a tree whose contents are already
//! merged. A textual conflict is therefore structurally impossible, and both
//! machines' histories are preserved.

use std::path::{Path, PathBuf};
use std::process::Command;

/// Run a git command in `dir`, returning stdout on success and stderr on failure.
fn git(dir: &Path, args: &[&str]) -> Result<String, String> {
    let out = Command::new("git")
        .current_dir(dir)
        .args(args)
        .output()
        .map_err(|e| match e.kind() {
            std::io::ErrorKind::NotFound => {
                "git is not installed or not on PATH — Hearth needs it to sync".to_string()
            }
            _ => format!("could not run git: {e}"),
        })?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).trim_end().to_string())
    } else {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        Err(if err.is_empty() {
            format!("git {} failed", args.join(" "))
        } else {
            err
        })
    }
}

/// Run a git command where a non-zero exit is a legitimate answer, not a failure.
fn git_ok(dir: &Path, args: &[&str]) -> bool {
    Command::new("git")
        .current_dir(dir)
        .args(args)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

pub fn is_available() -> bool {
    Command::new("git").arg("--version").output().is_ok()
}

/// Prepare `dir` as a git repository tracking `remote`.
///
/// Rather than cloning, this initialises in place and sets the remote, because
/// the vault directory may already hold a serialized vault from before sync was
/// configured — cloning over it would throw that away.
pub fn ensure_repo(dir: &Path, remote: &str) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    if !dir.join(".git").exists() {
        git(dir, &["init", "-q", "-b", "main"])?;
    }
    // `git commit` hard-fails when user.name/user.email are unset, which is
    // plausible on a fresh machine and would surface as a baffling error on the
    // first session. A repo-local identity is only used if nothing global is
    // configured, so it never overrides the user's own settings.
    if git(dir, &["config", "user.email"]).is_err() {
        git(dir, &["config", "user.email", "hearth@localhost"])?;
    }
    if git(dir, &["config", "user.name"]).is_err() {
        git(dir, &["config", "user.name", "Hearth"])?;
    }
    match git(dir, &["remote", "get-url", "origin"]) {
        Ok(current) if current == remote => {}
        Ok(_) => {
            git(dir, &["remote", "set-url", "origin", remote])?;
        }
        Err(_) => {
            git(dir, &["remote", "add", "origin", remote])?;
        }
    }
    Ok(())
}

/// True when the remote has no branches yet — a freshly created empty repo.
/// This is the state a new user's vault remote starts in, and it has no
/// `origin/main` to fetch, so the first sync has to publish rather than merge.
pub fn remote_is_empty(dir: &Path) -> Result<bool, String> {
    Ok(git(dir, &["ls-remote", "--heads", "origin"])?.trim().is_empty())
}

pub fn fetch(dir: &Path) -> Result<(), String> {
    git(dir, &["fetch", "--quiet", "origin"]).map(|_| ())
}

/// The remote branch tip, or `None` when the remote has nothing yet.
pub fn remote_head(dir: &Path) -> Option<String> {
    git(dir, &["rev-parse", "origin/main"]).ok()
}

pub fn local_head(dir: &Path) -> Option<String> {
    git(dir, &["rev-parse", "HEAD"]).ok()
}

/// Check out `rev`'s tree into a scratch directory so it can be read as files.
///
/// `git worktree` would be tidier, but it writes into the repo's administrative
/// area; a plain archive-to-temp keeps the vault repo untouched and lets the
/// caller read the remote side with the same `vault::read_tree` used for local.
pub fn export_tree(dir: &Path, rev: &str, dest: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dest).map_err(|e| e.to_string())?;
    let tar = Command::new("git")
        .current_dir(dir)
        .args(["archive", "--format=tar", rev])
        .output()
        .map_err(|e| format!("could not run git archive: {e}"))?;
    if !tar.status.success() {
        return Err(String::from_utf8_lossy(&tar.stderr).trim().to_string());
    }
    untar(&tar.stdout, dest)
}

/// Minimal POSIX-tar reader — enough for `git archive` output (regular files and
/// directories). Avoids a tar dependency for what is a fixed, well-formed input.
fn untar(data: &[u8], dest: &Path) -> Result<(), String> {
    let mut pos = 0usize;
    while pos + 512 <= data.len() {
        let header = &data[pos..pos + 512];
        if header.iter().all(|b| *b == 0) {
            break; // end-of-archive marker
        }
        let name = cstr(&header[0..100]);
        let size = usize::from_str_radix(cstr(&header[124..136]).trim(), 8).unwrap_or(0);
        let kind = header[156];
        pos += 512;

        if !name.is_empty() && !name.contains("..") {
            let path = dest.join(&name);
            if kind == b'5' || name.ends_with('/') {
                std::fs::create_dir_all(&path).map_err(|e| e.to_string())?;
            } else if kind == b'0' || kind == 0 {
                if let Some(parent) = path.parent() {
                    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
                }
                let end = (pos + size).min(data.len());
                std::fs::write(&path, &data[pos..end]).map_err(|e| e.to_string())?;
            }
        }
        pos += size.div_ceil(512) * 512;
    }
    Ok(())
}

fn cstr(bytes: &[u8]) -> String {
    let end = bytes.iter().position(|b| *b == 0).unwrap_or(bytes.len());
    String::from_utf8_lossy(&bytes[..end]).to_string()
}

/// Stage everything and commit, returning the new commit id.
///
/// When `merge_with` is set the commit is written with two parents through
/// `commit-tree`: the tree is already the merged result, so git records the
/// ancestry of both histories without ever running its own content merge.
/// Returns `None` when there is nothing to commit.
pub fn commit_all(
    dir: &Path,
    message: &str,
    merge_with: Option<&str>,
) -> Result<Option<String>, String> {
    git(dir, &["add", "-A"])?;
    let head = local_head(dir);
    // Nothing staged and no second parent to record => nothing to do.
    if merge_with.is_none() && git_ok(dir, &["diff", "--cached", "--quiet"]) {
        return Ok(None);
    }
    let tree = git(dir, &["write-tree"])?;
    let mut args: Vec<String> = vec!["commit-tree".into(), tree, "-m".into(), message.into()];
    if let Some(h) = &head {
        args.push("-p".into());
        args.push(h.clone());
    }
    if let Some(other) = merge_with {
        if Some(other.to_string()) != head {
            args.push("-p".into());
            args.push(other.to_string());
        }
    }
    let refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let commit = git(dir, &refs)?;
    git(dir, &["reset", "--soft", &commit])?;
    Ok(Some(commit))
}

pub fn push(dir: &Path) -> Result<(), String> {
    git(dir, &["push", "--quiet", "-u", "origin", "main"]).map(|_| ())
}

/// Record the commit a successful sync settled on, so the next merge has a base.
pub fn set_base(dir: &Path, commit: &str) -> Result<(), String> {
    git(dir, &["update-ref", "refs/hearth/base", commit]).map(|_| ())
}

pub fn base_commit(dir: &Path) -> Option<String> {
    git(dir, &["rev-parse", "refs/hearth/base"]).ok()
}

/// A scratch directory that removes itself.
pub struct Scratch(pub PathBuf);

impl Scratch {
    pub fn new(tag: &str) -> std::io::Result<Self> {
        let p = std::env::temp_dir().join(format!(
            "hearth-sync-{tag}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        std::fs::create_dir_all(&p)?;
        Ok(Scratch(p))
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Tmp(PathBuf);
    impl Tmp {
        fn new(tag: &str) -> Self {
            let p = std::env::temp_dir().join(format!(
                "hearth-git-test-{tag}-{}",
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

    fn bare_remote(at: &Path) -> String {
        std::fs::create_dir_all(at).unwrap();
        Command::new("git")
            .args(["init", "--bare", "-q", "-b", "main"])
            .arg(at)
            .output()
            .unwrap();
        at.to_string_lossy().to_string()
    }

    #[test]
    fn init_is_idempotent_and_sets_a_usable_identity() {
        let t = Tmp::new("init");
        let remote = bare_remote(&t.0.join("remote.git"));
        let work = t.0.join("vault");

        ensure_repo(&work, &remote).unwrap();
        ensure_repo(&work, &remote).unwrap();

        assert!(work.join(".git").exists());
        assert_eq!(git(&work, &["remote", "get-url", "origin"]).unwrap(), remote);
        // Committing must work even with no global git identity configured.
        assert!(git(&work, &["config", "user.email"]).is_ok());
    }

    #[test]
    fn detects_an_empty_remote_then_publishes_to_it() {
        // The state a new user's freshly created private repo starts in.
        let t = Tmp::new("empty");
        let remote = bare_remote(&t.0.join("remote.git"));
        let work = t.0.join("vault");
        ensure_repo(&work, &remote).unwrap();

        assert!(remote_is_empty(&work).unwrap(), "a fresh remote has no branches");
        assert!(remote_head(&work).is_none(), "and therefore no origin/main");

        std::fs::write(work.join("hearth-vault.json"), "{}").unwrap();
        commit_all(&work, "first", None).unwrap().expect("a commit");
        push(&work).unwrap();

        assert!(!remote_is_empty(&work).unwrap(), "publishing seeds the remote");
    }

    #[test]
    fn commit_all_is_a_no_op_when_nothing_changed() {
        let t = Tmp::new("noop");
        let remote = bare_remote(&t.0.join("remote.git"));
        let work = t.0.join("vault");
        ensure_repo(&work, &remote).unwrap();
        std::fs::write(work.join("a.json"), "{}").unwrap();

        assert!(commit_all(&work, "one", None).unwrap().is_some());
        assert!(
            commit_all(&work, "two", None).unwrap().is_none(),
            "an unchanged vault must not litter the history"
        );
    }

    #[test]
    fn a_merge_commit_records_both_parents_without_a_content_merge() {
        let t = Tmp::new("merge");
        let remote = bare_remote(&t.0.join("remote.git"));

        // Device A publishes.
        let a = t.0.join("a");
        ensure_repo(&a, &remote).unwrap();
        std::fs::write(a.join("a.json"), "{\"from\":\"a\"}").unwrap();
        commit_all(&a, "a1", None).unwrap();
        push(&a).unwrap();

        // Device B starts independently and also commits, so the histories differ.
        let b = t.0.join("b");
        ensure_repo(&b, &remote).unwrap();
        std::fs::write(b.join("b.json"), "{\"from\":\"b\"}").unwrap();
        commit_all(&b, "b1", None).unwrap();
        fetch(&b).unwrap();
        let theirs = remote_head(&b).unwrap();

        // B writes the already-merged tree and records both parents. git is never
        // asked to reconcile file contents, so this cannot conflict.
        std::fs::write(b.join("a.json"), "{\"from\":\"a\"}").unwrap();
        let merged = commit_all(&b, "merge", Some(&theirs)).unwrap().unwrap();
        push(&b).expect("must fast-forward the remote");

        let parents = git(&b, &["rev-list", "--parents", "-n", "1", &merged]).unwrap();
        assert_eq!(parents.split_whitespace().count(), 3, "commit + two parents");
        assert!(b.join("a.json").exists() && b.join("b.json").exists());
    }

    #[test]
    fn export_tree_reads_a_revision_back_as_files() {
        let t = Tmp::new("export");
        let remote = bare_remote(&t.0.join("remote.git"));
        let work = t.0.join("vault");
        ensure_repo(&work, &remote).unwrap();
        std::fs::create_dir_all(work.join("cards")).unwrap();
        std::fs::write(work.join("cards/x.json"), "{\"id\":\"x\"}").unwrap();
        let commit = commit_all(&work, "one", None).unwrap().unwrap();

        let out = t.0.join("out");
        export_tree(&work, &commit, &out).unwrap();
        assert_eq!(
            std::fs::read_to_string(out.join("cards/x.json")).unwrap(),
            "{\"id\":\"x\"}"
        );
    }
}
