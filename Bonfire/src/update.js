// Auto-updater: fast-forward the source checkout from GitHub `main` and rebuild.
//
// Hearth is installed by install.sh from a git checkout, so an update is
// `git pull --ff-only && ./install.sh --update` in that checkout. All of the real
// work — and the safety rails around executing pulled code — lives in the backend
// (src-tauri/src/update.rs); this file only decides when to run it and how to say
// what happened.
//
// It runs unattended on launch. The rebuild takes minutes, so it never blocks the
// UI: the result arrives as a toast whenever it lands. A running binary can't
// replace itself, so a successful update applies on the next launch.

import * as api from "./api.js";

// Check for an update and, if there is one, apply it. Reports through `ctx.toast`.
// `badgeEl` is the #update-badge button, revealed once an update is waiting to be
// picked up by a restart.
export async function checkForUpdate(ctx, badgeEl) {
  let result;
  try {
    result = await api.checkAndUpdate();
  } catch (_e) {
    return; // backend unavailable — never let this surface as a startup error
  }
  if (!result) return;
  // "skipped" is the normal case for a dev build or a non-git install, and
  // "up-to-date" is the normal case for everyone else. Neither is worth a toast.
  if (result.status === "updated") {
    ctx.toast(result.detail, "success");
    if (badgeEl) {
      badgeEl.hidden = false;
      badgeEl.textContent = "● Restart to finish update";
      badgeEl.title = result.detail;
    }
  } else if (result.status === "failed") {
    ctx.toast(result.detail, "error");
  }
}

// The badge is only shown after an update has already been installed, so clicking
// it has nothing left to do but explain that a restart is what applies it.
export function applyUpdate(ctx) {
  ctx.toast("Quit and reopen Hearth to finish updating");
}
