// Auto-updater scaffolding (roadmap — NOT active yet).
//
// Intended behavior once activated: on launch, check the production GitHub
// release for a newer version; if we're behind, reveal a subtle "Update
// available" badge at the top of the GUI. Clicking it downloads + installs the
// update and restarts the app.
//
// This file is a SAFE NO-OP until the updater plugin is wired up. It only does
// anything if `window.__TAURI__.updater` exists, so dev/build are unaffected and
// nothing ever throws. To turn it on, see SETUP-GITHUB-RELEASES.txt
// ("FUTURE: AUTO-UPDATER") / CLAUDE.md → Updater:
//   1. cargo add tauri-plugin-updater tauri-plugin-process (register in lib.rs)
//   2. tauri signer generate → pubkey in tauri.conf.json, private key as CI secret
//   3. bundle.createUpdaterArtifacts = true + plugins.updater.endpoints
//   4. capabilities: updater:default, process:allow-restart

function updaterApi() {
  return (window.__TAURI__ && window.__TAURI__.updater) || null;
}

// Check production for a newer release and reveal the badge if one exists.
// `badgeEl` is the #update-badge button. Silent on any failure (offline, plugin
// not installed, etc.).
export async function checkForUpdate(_ctx, badgeEl) {
  const updater = updaterApi();
  if (!updater || typeof updater.check !== "function") return; // plugin not installed yet
  try {
    const update = await updater.check();
    // v2 `check()` resolves to an Update (truthy/`.available`) or null.
    if (update && (update.available === undefined || update.available) && badgeEl) {
      badgeEl.hidden = false;
      if (update.version) badgeEl.title = `Update to ${update.version}`;
    }
  } catch (_e) {
    /* offline / not configured — stay silent */
  }
}

// Download + install the update, then restart. Called from the badge click.
export async function applyUpdate() {
  const updater = updaterApi();
  const proc = window.__TAURI__ && window.__TAURI__.process;
  if (!updater || typeof updater.check !== "function") {
    alert("The auto-updater isn't configured yet. See SETUP-GITHUB-RELEASES.txt.");
    return;
  }
  try {
    const update = await updater.check();
    if (!update || (update.available !== undefined && !update.available)) {
      alert("You're already on the latest version.");
      return;
    }
    await update.downloadAndInstall();
    if (proc && typeof proc.relaunch === "function") await proc.relaunch();
  } catch (e) {
    alert("Update failed: " + (e && e.message ? e.message : e));
  }
}
