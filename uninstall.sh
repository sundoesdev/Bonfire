#!/usr/bin/env bash
#
# Hearth uninstaller — removes exactly what install.sh created.
#
# Your study data is deleted only once it is confirmed published to your vault
# remote, so a reinstall picks up exactly where you left off. If anything is
# unsynced this script refuses and tells you what.
#
# The remote is NEVER touched. This checkout is NEVER touched.
#
#   ./uninstall.sh            remove app files, then data if it is fully synced
#   ./uninstall.sh --keep-data   remove app files only, leave the vault alone
#   ./uninstall.sh --force       remove data even if it is unsynced (destructive)
#
set -euo pipefail

APP_ID="com.bonfire.app"
DATA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/$APP_ID"
VAULT_DIR="$DATA_DIR/vault"
MANIFEST="$DATA_DIR/install-manifest.txt"
DESKTOP_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/applications"

FORCE=0
KEEP_DATA=0
for arg in "$@"; do
  case "$arg" in
    --force)     FORCE=1 ;;
    --keep-data) KEEP_DATA=1 ;;
    -h|--help)   awk 'NR>2 && /^#/ { sub(/^# ?/, ""); print; next } NR>2 { exit }' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "Unknown option: $arg (try --help)" >&2; exit 2 ;;
  esac
done

say()  { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
info() { printf '    %s\n' "$*"; }
die()  { printf '\n\033[1;31mError:\033[0m %s\n' "$*" >&2; exit 1; }

# ------------------------------------------------------- app files

remove_app_files() {
  say "Removing Hearth from this system"
  if [ -f "$MANIFEST" ]; then
    # Remove exactly what was installed, rather than guessing at paths.
    while IFS= read -r path; do
      [ -n "$path" ] || continue
      if [ -e "$path" ]; then
        rm -f "$path"
        info "removed $path"
      fi
    done < "$MANIFEST"
  else
    info "No install manifest found — falling back to the default locations."
    for path in \
      "$HOME/.local/bin/hearth" \
      "${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor/256x256/apps/hearth.png" \
      "$DESKTOP_DIR/hearth.desktop"
    do
      [ -e "$path" ] && rm -f "$path" && info "removed $path"
    done
  fi

  command -v update-desktop-database >/dev/null 2>&1 &&
    update-desktop-database "$DESKTOP_DIR" 2>/dev/null || true
}

# ------------------------------------------------------- data

# "Safe to delete" means: a remote is configured, the working tree is clean, and
# nothing is sitting on HEAD that the remote has not got.
vault_state() {
  [ -e "$DATA_DIR/vault.db" ] || { echo "no-data"; return; }
  [ -d "$VAULT_DIR/.git" ] || { echo "no-remote"; return; }
  git -C "$VAULT_DIR" remote get-url origin >/dev/null 2>&1 || { echo "no-remote"; return; }
  [ -z "$(git -C "$VAULT_DIR" status --porcelain 2>/dev/null)" ] || { echo "dirty"; return; }
  git -C "$VAULT_DIR" rev-parse --verify -q '@{upstream}' >/dev/null 2>&1 || { echo "unpushed"; return; }
  local ahead
  ahead="$(git -C "$VAULT_DIR" rev-list --count '@{upstream}..HEAD' 2>/dev/null || echo 1)"
  [ "$ahead" = "0" ] && echo "synced" || echo "unpushed"
}

remove_data() {
  local state
  state="$(vault_state)"

  case "$state" in
    no-data)
      info "No study data to remove."
      return
      ;;
    synced)
      info "Vault is fully published to the remote — safe to remove."
      ;;
    *)
      if [ "$FORCE" -eq 0 ]; then
        local reason
        case "$state" in
          no-remote) reason="no vault remote is configured, so this data exists nowhere else" ;;
          dirty)     reason="the vault has changes that were never committed" ;;
          unpushed)  reason="the vault has commits that were never pushed" ;;
        esac
        printf '\n\033[1;31mRefusing to delete your study data:\033[0m %s.\n\n' "$reason" >&2
        if [ "$state" != "no-remote" ]; then
          info "What is only on this machine:"
          git -C "$VAULT_DIR" status --short 2>/dev/null | sed 's/^/      /' || true
          # A never-pushed vault has no @{upstream} to diff against, so fall back
          # to listing HEAD itself — otherwise this prints nothing at all and the
          # refusal looks unfounded.
          if git -C "$VAULT_DIR" rev-parse --verify -q '@{upstream}' >/dev/null 2>&1; then
            git -C "$VAULT_DIR" log --oneline '@{upstream}..HEAD' 2>/dev/null | sed 's/^/      /' || true
          else
            info "  (never pushed — the entire history is local)"
            git -C "$VAULT_DIR" log --oneline -5 2>/dev/null | sed 's/^/      /' || true
          fi
        fi
        cat >&2 <<EOF

    Open Hearth and run Settings → Sync → Sync now, then re-run this script.

    Other options:
      ./uninstall.sh --keep-data   remove the app, keep your cards on this machine
      ./uninstall.sh --force       delete anyway (this data is not recoverable)
EOF
        exit 1
      fi
      info "--force given: removing unsynced data."
      ;;
  esac

  rm -rf "$DATA_DIR"
  info "removed $DATA_DIR"
}

main() {
  remove_app_files

  if [ "$KEEP_DATA" -eq 1 ]; then
    say "Keeping study data"
    info "Your vault stays at $DATA_DIR — reinstalling picks up where you left off."
  else
    say "Study data"
    remove_data
  fi

  say "Done"
  info "Your vault remote was not touched; reinstalling and reconnecting restores everything."
  info "This source checkout was left in place — delete it yourself if you want it gone."
}

main "$@"
