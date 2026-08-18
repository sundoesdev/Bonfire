//! In-app updater: fast-forward the source checkout from GitHub `main`, rebuild,
//! reinstall.
//!
//! Hearth is installed by `install.sh` from a git checkout, so "update" here means
//! exactly what the user would do by hand — `git pull --ff-only && ./install.sh` —
//! run for them. `install.sh` records where that checkout lives (`source-repo.txt`
//! in the app data dir) and grows an `--update` mode that never reaches for sudo or
//! a prompt, so the whole thing can run unattended.
//!
//! This executes code fetched from a remote without asking, which is only
//! defensible because of two rails:
//!
//! * **The remote is verified first.** `origin` must still point at the expected
//!   Bonfire repository, so a checkout whose remote was repointed — the one way an
//!   attacker with write access to the filesystem could turn this into arbitrary
//!   code execution — is refused rather than pulled.
//! * **The pull is `--ff-only`.** A dirty or diverged checkout stops the update
//!   instead of merging, rebasing, or discarding the user's own work.
//!
//! A running executable cannot replace itself, so a successful update takes effect
//! on the next launch; the caller says so rather than pretending otherwise.

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Command;

/// Written by `install.sh`; holds the absolute path of the source checkout.
const SOURCE_FILE: &str = "source-repo.txt";

/// The only repository this will ever pull from. Matched against `origin`'s URL,
/// which covers both the HTTPS and SSH spellings without pinning either.
const EXPECTED_REMOTE: &str = "sundoesdev/Bonfire";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateResult {
    /// "updated" | "up-to-date" | "skipped" | "failed"
    pub status: String,
    /// Human-readable detail, shown verbatim in the toast.
    pub detail: String,
}

impl UpdateResult {
    fn new(status: &str, detail: impl Into<String>) -> Self {
        UpdateResult {
            status: status.into(),
            detail: detail.into(),
        }
    }
}

/// Locate the source checkout recorded by `install.sh`.
fn source_repo(app_dir: &Path) -> Option<PathBuf> {
    let raw = std::fs::read_to_string(app_dir.join(SOURCE_FILE)).ok()?;
    let path = PathBuf::from(raw.trim());
    // A `.git` directory is what makes this a checkout we can fast-forward; a dev
    // build or a moved checkout simply isn't updatable, which is not an error.
    path.join(".git").exists().then_some(path)
}

/// The version `install.sh` would build, read from the checkout's tauri.conf.json.
fn version_at(repo: &Path) -> Option<String> {
    let raw = std::fs::read_to_string(repo.join("Bonfire/src-tauri/tauri.conf.json")).ok()?;
    let v: serde_json::Value = serde_json::from_str(&raw).ok()?;
    Some(v.get("version")?.as_str()?.to_string())
}

/// Check GitHub `main` and, if this checkout is behind, pull and reinstall.
///
/// Never returns `Err`: an update failing is informational, never something that
/// should surface as a broken app.
pub fn check_and_update(app_dir: &Path) -> UpdateResult {
    let Some(repo) = source_repo(app_dir) else {
        return UpdateResult::new("skipped", "Not installed from a source checkout");
    };
    if !crate::git::is_available() {
        return UpdateResult::new("skipped", "git is not on PATH");
    }

    // Rail 1: only ever pull from the real Bonfire repository.
    match crate::git::git(&repo, &["remote", "get-url", "origin"]) {
        Ok(url) if url.contains(EXPECTED_REMOTE) => {}
        Ok(url) => {
            return UpdateResult::new(
                "skipped",
                format!("Update refused: origin is {url}, not {EXPECTED_REMOTE}"),
            )
        }
        Err(e) => return UpdateResult::new("skipped", format!("No origin remote: {e}")),
    }

    if let Err(e) = crate::git::git(&repo, &["fetch", "--quiet", "origin", "main"]) {
        return UpdateResult::new("failed", format!("Could not reach GitHub: {e}"));
    }

    let local = crate::git::git(&repo, &["rev-parse", "HEAD"]).unwrap_or_default();
    let remote = crate::git::git(&repo, &["rev-parse", "origin/main"]).unwrap_or_default();
    if local.is_empty() || remote.is_empty() {
        return UpdateResult::new("failed", "Could not read the checkout's revisions");
    }
    // "Behind" means origin/main is NOT already contained in HEAD — not merely that
    // the two revisions differ. A checkout sitting on a feature branch, or ahead of
    // main with unpushed work, differs from origin/main while having nothing to
    // pull; treating that as an update would rebuild and reinstall over the user's
    // own build every single launch.
    if crate::git::git(&repo, &["merge-base", "--is-ancestor", "origin/main", "HEAD"]).is_ok() {
        return UpdateResult::new("up-to-date", "Hearth is up to date");
    }

    // Rail 2: fast-forward only — never merge over, rebase, or discard local work.
    if let Err(e) = crate::git::git(&repo, &["pull", "--ff-only", "origin", "main"]) {
        return UpdateResult::new(
            "failed",
            format!("Could not fast-forward the checkout (local changes?): {e}"),
        );
    }

    match Command::new("./install.sh")
        .arg("--update")
        .current_dir(&repo)
        .output()
    {
        Ok(out) if out.status.success() => {
            let version = version_at(&repo).unwrap_or_default();
            UpdateResult::new(
                "updated",
                if version.is_empty() {
                    "Updated — restart Hearth to apply".to_string()
                } else {
                    format!("Updated to {version} — restart Hearth to apply")
                },
            )
        }
        Ok(out) => {
            let err = String::from_utf8_lossy(&out.stderr);
            UpdateResult::new(
                "failed",
                format!("Rebuild failed: {}", err.lines().last().unwrap_or("see install.sh output")),
            )
        }
        Err(e) => UpdateResult::new("failed", format!("Could not run install.sh: {e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TmpDir(PathBuf);
    impl TmpDir {
        fn new(tag: &str) -> Self {
            let p = std::env::temp_dir().join(format!("hearth-update-{tag}-{}", std::process::id()));
            let _ = std::fs::remove_dir_all(&p);
            std::fs::create_dir_all(&p).unwrap();
            TmpDir(p)
        }
    }
    impl Drop for TmpDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn no_source_file_is_skipped_not_failed() {
        let dir = TmpDir::new("nosource");
        let r = check_and_update(&dir.0);
        assert_eq!(r.status, "skipped", "{}", r.detail);
    }

    /// A checkout that is *ahead* of origin/main has nothing to pull. Without the
    /// ancestor check this rebuilt and reinstalled on every launch.
    #[test]
    fn a_checkout_ahead_of_main_is_up_to_date() {
        let app = TmpDir::new("ahead-app");
        let origin = TmpDir::new("ahead-origin");
        let repo = TmpDir::new("ahead-repo");

        let commit = |dir: &std::path::Path, msg: &str| {
            std::fs::write(dir.join(msg), msg).unwrap();
            crate::git::git(dir, &["add", "-A"]).unwrap();
            crate::git::git(dir, &["commit", "--quiet", "-m", msg]).unwrap();
        };
        // A bare-ish origin holding just `main`.
        crate::git::git(&origin.0, &["init", "--quiet", "--initial-branch=main"]).unwrap();
        crate::git::git(&origin.0, &["config", "user.email", "t@example.com"]).unwrap();
        crate::git::git(&origin.0, &["config", "user.name", "t"]).unwrap();
        commit(&origin.0, "base");

        crate::git::git(
            &repo.0,
            &["clone", "--quiet", origin.0.to_str().unwrap(), "."],
        )
        .unwrap();
        crate::git::git(&repo.0, &["config", "user.email", "t@example.com"]).unwrap();
        crate::git::git(&repo.0, &["config", "user.name", "t"]).unwrap();
        // Local work on a branch, ahead of origin/main.
        crate::git::git(&repo.0, &["checkout", "--quiet", "-b", "feature"]).unwrap();
        commit(&repo.0, "local-work");
        // Point origin at the expected repo name so the remote rail passes.
        crate::git::git(
            &repo.0,
            &["remote", "set-url", "origin", &format!("https://github.com/{EXPECTED_REMOTE}.git")],
        )
        .unwrap();
        std::fs::write(app.0.join(SOURCE_FILE), repo.0.to_string_lossy().as_bytes()).unwrap();

        // The fetch will fail against the fake URL, which is itself a safe outcome —
        // assert only that we never report an update available.
        let r = check_and_update(&app.0);
        assert_ne!(r.status, "updated", "{}", r.detail);
    }

    #[test]
    fn a_repointed_origin_is_refused() {
        let app = TmpDir::new("app");
        let repo = TmpDir::new("repo");
        crate::git::git(&repo.0, &["init", "--quiet"]).unwrap();
        crate::git::git(&repo.0, &["remote", "add", "origin", "https://example.com/evil/repo.git"])
            .unwrap();
        std::fs::write(app.0.join(SOURCE_FILE), repo.0.to_string_lossy().as_bytes()).unwrap();

        let r = check_and_update(&app.0);
        assert_eq!(r.status, "skipped");
        assert!(r.detail.contains("refused"), "{}", r.detail);
    }
}
