#!/usr/bin/env bash
#
# Run Hearth from source instead of the installed binary.
#
# Installed as ~/.local/bin/hearth by `./install.sh --dev`, so the desktop entry
# and the `hearth` command both end up here. Every launch runs `npm run tauri dev`
# against the checkout, which means you always get whatever is in Bonfire/src right
# now — the point of it during a testing period.
#
# The trade is real: each start pays a cargo rebuild before the window appears, and
# the result is a debug build, so the app itself runs slower than a release one.
# Run a plain `./install.sh` to go back to the compiled binary.
set -euo pipefail

DATA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/com.bonfire.app"
LOG="$DATA_DIR/dev-launch.log"

# A desktop launcher starts from the session, not a login shell, so it inherits a
# minimal PATH: no mise shims and no ~/.cargo/bin. Put them back before anything
# tries to find npm or cargo.
export PATH="$HOME/.local/share/mise/shims:$HOME/.cargo/bin:$HOME/.local/bin:$PATH"

# There is no terminal attached, so failures have to reach the user some other way.
note() {
  command -v notify-send >/dev/null 2>&1 && notify-send -a Hearth "Hearth" "$1" || true
}

# install.sh records where the checkout lives; the same file the updater reads.
REPO_DIR="$(cat "$DATA_DIR/source-repo.txt" 2>/dev/null || true)"
if [ ! -d "$REPO_DIR/Bonfire/src-tauri" ]; then
  note "Can't find the source checkout. Re-run ./install.sh --dev from it."
  exit 1
fi

mkdir -p "$DATA_DIR"
note "Building from source — the window will open when it's ready."

cd "$REPO_DIR/Bonfire"
# Truncated per launch: the log that matters is this run's.
exec npm run tauri dev >"$LOG" 2>&1
