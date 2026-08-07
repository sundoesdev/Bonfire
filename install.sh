#!/usr/bin/env bash
#
# Hearth installer — builds from source and installs into the user's home.
#
# Nothing here needs root except the distro package step, and everything it
# creates is recorded in a manifest so uninstall.sh can remove exactly that and
# nothing else.
#
#   ./install.sh              build, install, and offer to set up vault sync
#   ./install.sh --fresh      also wipe the local vault first (gated, see below)
#   ./install.sh --no-sync    skip the vault prompt entirely
#
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$REPO_DIR/Bonfire"
APP_ID="com.bonfire.app"
DATA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/$APP_ID"
VAULT_DIR="$DATA_DIR/vault"
MANIFEST="$DATA_DIR/install-manifest.txt"

BIN_DIR="$HOME/.local/bin"
ICON_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor/256x256/apps"
DESKTOP_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/applications"

FRESH=0
ASK_SYNC=1
for arg in "$@"; do
  case "$arg" in
    --fresh)   FRESH=1 ;;
    --no-sync) ASK_SYNC=0 ;;
    -h|--help) awk 'NR>2 && /^#/ { sub(/^# ?/, ""); print; next } NR>2 { exit }' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "Unknown option: $arg (try --help)" >&2; exit 2 ;;
  esac
done

say()  { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
info() { printf '    %s\n' "$*"; }
die()  { printf '\n\033[1;31mError:\033[0m %s\n' "$*" >&2; exit 1; }

# ----------------------------------------------------------------- distro

# Resolve the package family from ID plus ID_LIKE, so derivatives are covered:
# Pop!_OS and Mint report ID_LIKE="ubuntu debian", EndeavourOS reports "arch".
detect_family() {
  [ -r /etc/os-release ] || { echo unknown; return; }
  . /etc/os-release
  for id in ${ID:-} ${ID_LIKE:-}; do
    case "$id" in
      debian|ubuntu) echo debian; return ;;
      arch)          echo arch;   return ;;
    esac
  done
  echo unknown
}

install_system_deps() {
  local family="$1"
  case "$family" in
    debian)
      say "Installing system dependencies (apt)"
      sudo apt-get update
      sudo apt-get install -y \
        libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev patchelf \
        libayatana-appindicator3-dev build-essential curl wget file git
      ;;
    arch)
      say "Installing system dependencies (pacman)"
      sudo pacman -S --needed --noconfirm \
        webkit2gtk-4.1 base-devel curl wget file openssl \
        appmenu-gtk-module libappindicator-gtk3 librsvg git
      ;;
    *)
      die "Unsupported distribution.

Hearth builds on any Linux with the Tauri v2 prerequisites, but this script only
knows Debian- and Arch-family package names. Install the equivalents of:

  webkit2gtk 4.1, gtk3, librsvg, patchelf, a C toolchain, curl, wget, file, git

(see https://tauri.app/start/prerequisites/), then re-run with the packages
already present — the script will detect them and continue."
      ;;
  esac
}

# ----------------------------------------------------------------- toolchain

ensure_rust() {
  if command -v cargo >/dev/null 2>&1; then
    info "Rust: $(cargo --version)"
    return
  fi
  say "Installing Rust (rustup)"
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --no-modify-path
  # shellcheck disable=SC1091
  . "$HOME/.cargo/env"
  command -v cargo >/dev/null 2>&1 || die "Rust install finished but cargo is still not on PATH."
}

ensure_node() {
  if command -v node >/dev/null 2>&1; then
    local major
    major="$(node -v | sed 's/^v\([0-9]*\).*/\1/')"
    if [ "$major" -ge 18 ] 2>/dev/null; then
      info "Node: $(node -v)"
      return
    fi
    die "Node $(node -v) is too old — Hearth's build needs Node 18 or newer.
Update it through your package manager or nvm, then re-run this script."
  fi
  die "Node is not installed.

Install Node 18+ and re-run:
  Debian/Ubuntu/Pop:  sudo apt-get install -y nodejs npm
  Arch/Manjaro:       sudo pacman -S --needed nodejs npm
  Any distro:         https://github.com/nvm-sh/nvm"
}

# `git commit` hard-fails with no identity configured, which would surface later
# as a baffling mid-session sync error rather than here where we can explain it.
ensure_git_identity() {
  git config --get user.email >/dev/null 2>&1 && git config --get user.name >/dev/null 2>&1 && return
  say "git needs an identity before it can commit"
  info "Hearth's vault sync commits on your behalf, so git needs a name and email."
  local name email
  read -rp "    Your name:  " name
  read -rp "    Your email: " email
  [ -n "$name" ] && [ -n "$email" ] || die "Both a name and an email are required."
  git config --global user.name "$name"
  git config --global user.email "$email"
}

# ----------------------------------------------------------------- vault

# Is every byte of the local vault also on the remote?
#
# Callers reach this only when a vault.db exists, so "no vault repo" means this
# data has never been published anywhere — the most dangerous state to wipe, not
# the safest. Mirrors uninstall.sh's gate.
vault_is_clean() {
  [ -d "$VAULT_DIR/.git" ] || return 1
  git -C "$VAULT_DIR" remote get-url origin >/dev/null 2>&1 || return 1
  [ -z "$(git -C "$VAULT_DIR" status --porcelain 2>/dev/null)" ] || return 1
  git -C "$VAULT_DIR" rev-parse --verify -q '@{upstream}' >/dev/null 2>&1 || return 1
  [ "$(git -C "$VAULT_DIR" rev-list --count '@{upstream}..HEAD' 2>/dev/null || echo 1)" = "0" ]
}

# --fresh wipes the local vault so the configured remote becomes the source of
# truth. Safe on a new machine; destructive when re-running the installer just to
# update the app, so it is gated on the vault being fully published and always
# takes a copy first.
wipe_local_vault() {
  [ -e "$DATA_DIR/vault.db" ] || { info "No existing vault — starting blank."; return; }

  if ! vault_is_clean; then
    die "--fresh refused: this vault holds work that is not on any remote.

You have study data on this machine that would not come back after the wipe.
Open Hearth and run Settings → Sync → Sync now (setting up a vault remote first
if you have not), then try again.

To keep the existing vault instead, just re-run without --fresh — updating
Hearth never touches your data. To discard it deliberately, remove
$DATA_DIR by hand."
  fi

  local stamp backup
  stamp="$(date +%Y-%m-%d-%H%M%S)"
  backup="$HOME/hearth-vault-backup-$stamp.db"
  cp "$DATA_DIR/vault.db" "$backup"
  info "Backed up the old vault to $backup"
  rm -rf "$DATA_DIR/vault.db" "$VAULT_DIR"
  info "Local vault cleared — the remote is now the source of truth."
}

setup_sync() {
  [ "$ASK_SYNC" -eq 1 ] || return 0
  say "Vault sync (optional)"
  cat <<'EOF'
    Hearth can keep your cards, schedules, and review history identical on every
    machine, through a PRIVATE GIT REPOSITORY YOU OWN.

      1. Create a new, EMPTY private repo (e.g. "hearth-vault") on GitHub or any
         git host. Do not fork Hearth for this — your cards and Hearth's source
         are separate repositories.
      2. Paste its URL below.

    On another machine, point Hearth at the SAME repo and your vault follows you.
    Authentication uses the git credentials already on this machine, so Hearth
    never sees or stores a password or token.

    Leave blank to skip — Hearth works fully offline and you can set this up
    later in Settings → Sync.
EOF
  local remote
  read -rp "    Vault remote URL: " remote || true
  [ -n "${remote:-}" ] || { info "Skipped — sync is off."; return 0; }

  ensure_git_identity
  mkdir -p "$DATA_DIR"
  # Seeded directly into the settings table so the app picks it up on first run
  # without needing a round trip through the GUI.
  python3 - "$DATA_DIR/vault.db" "$remote" <<'PY'
import sqlite3, sys, datetime
db, remote = sys.argv[1], sys.argv[2]
conn = sqlite3.connect(db)
conn.execute("""CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '')""")
cols = [r[1] for r in conn.execute("pragma table_info(settings)")]
if "modified_at" not in cols:
    conn.execute("ALTER TABLE settings ADD COLUMN modified_at TEXT NOT NULL DEFAULT ''")
conn.execute(
    "INSERT INTO settings (key, value, modified_at) VALUES ('sync_remote', ?, ?) "
    "ON CONFLICT(key) DO UPDATE SET value = excluded.value, modified_at = excluded.modified_at",
    (remote, datetime.datetime.now().astimezone().isoformat()),
)
conn.commit()
PY
  info "Vault remote set. Hearth will sync on first launch."
}

# ----------------------------------------------------------------- install

record() { echo "$1" >> "$MANIFEST"; }

main() {
  [ -d "$APP_DIR/src-tauri" ] || die "Run this from a Hearth checkout (expected $APP_DIR/src-tauri)."

  local family
  family="$(detect_family)"
  say "Hearth installer"
  info "Repository: $REPO_DIR"
  info "Distro family: $family"

  install_system_deps "$family"
  ensure_rust
  ensure_node

  say "Building Hearth (this takes a few minutes the first time)"
  cd "$APP_DIR"
  npm install
  npm run tauri build

  local built
  built="$APP_DIR/src-tauri/target/release/bonfire"
  [ -x "$built" ] || die "Build finished but the binary is missing at $built"

  # Only --fresh ever touches existing study data. A plain re-install (the normal
  # way to update Hearth) leaves the vault exactly as it was.
  if [ "$FRESH" -eq 1 ]; then
    wipe_local_vault
  else
    [ -e "$DATA_DIR/vault.db" ] && info "Existing vault kept at $DATA_DIR/vault.db"
  fi

  say "Installing"
  mkdir -p "$BIN_DIR" "$ICON_DIR" "$DESKTOP_DIR" "$DATA_DIR"
  : > "$MANIFEST"   # rewritten each install so it always reflects reality

  install -m 755 "$built" "$BIN_DIR/hearth"
  record "$BIN_DIR/hearth"
  info "Binary  → $BIN_DIR/hearth"

  local icon="$APP_DIR/src-tauri/icons/128x128@2x.png"
  if [ -f "$icon" ]; then
    install -m 644 "$icon" "$ICON_DIR/hearth.png"
    record "$ICON_DIR/hearth.png"
    info "Icon    → $ICON_DIR/hearth.png"
  fi

  cat > "$DESKTOP_DIR/hearth.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Hearth
Comment=Active-recall spaced-repetition study tool
Exec=$BIN_DIR/hearth
Icon=hearth
Terminal=false
Categories=Education;
EOF
  record "$DESKTOP_DIR/hearth.desktop"
  info "Launcher → $DESKTOP_DIR/hearth.desktop"

  command -v update-desktop-database >/dev/null 2>&1 &&
    update-desktop-database "$DESKTOP_DIR" 2>/dev/null || true

  setup_sync

  say "Done"
  info "Launch Hearth from your application menu, or run: hearth"
  case ":$PATH:" in
    *":$BIN_DIR:"*) ;;
    *) info "Note: $BIN_DIR is not on your PATH — add it to use the 'hearth' command." ;;
  esac
  info "To remove Hearth later: $REPO_DIR/uninstall.sh"
}

main "$@"
