// Frontend sync helpers, shared by main.js (app start), study.js (session start
// and end) and views/settings.js (the Sync tab).
//
// Everything here is best-effort and silent by default: a sync failure must
// never interrupt studying, so the only visible sign is the sidebar badge going
// amber. The backend does the real work — see src-tauri/src/sync.rs.

// Settings key for the opt-in per-card sync (off by default; the default cadence
// of start / session-start / session-end already closes the conflict window,
// and a per-card push only adds a network round-trip mid-session).
export const SYNC_EACH_CARD = "sync_each_card";

// One sync at a time. Session-end and the app's own refresh can fire together,
// and overlapping git invocations in the same repo would trip over each other.
let inFlight = null;
// A request that lands mid-flight (a session ending during the slow startup pull)
// carries reviews the running sync never saw. Handing back `inFlight` would drop
// them, so one follow-up run is queued instead — one, not a chain, because a
// second follow-up would see the same already-published work.
let queued = null;

// Cached so the common "sync not set up" case costs nothing on every call.
let configured = null;

function badge(state) {
  const el = document.querySelector("#sync-badge");
  if (!el) return;
  const labels = {
    syncing: "◐ Syncing…",
    error: "▲ Sync failed",
  };
  el.textContent = labels[state] || "";
  el.className = `sync-badge ${state}`;
  el.hidden = !labels[state];
}

/// Re-read whether a remote is configured (call after changing it in Settings).
export function invalidateSyncState() {
  configured = null;
}

export async function isConfigured(ctx) {
  if (configured === null) {
    try {
      configured = (await ctx.api.syncStatus()).configured;
    } catch (_e) {
      configured = false; // treat an unreachable backend as "not set up"
    }
  }
  return configured;
}

// Run a sync. Returns the backend's summary string, or null if it did not run.
// `silent` suppresses the success toast (used for automatic syncs).
export async function syncNow(ctx, { silent = true } = {}) {
  if (!(await isConfigured(ctx))) return null;
  if (inFlight) {
    return (queued ||= inFlight.then(() => {
      queued = null;
      return syncNow(ctx, { silent });
    }));
  }

  badge("syncing");
  inFlight = (async () => {
    try {
      const summary = await ctx.api.syncNow();
      badge("idle");
      if (!silent) ctx.toast(summary, "success");
      return summary;
    } catch (e) {
      badge("error");
      if (!silent) ctx.toast(String(e), "error");
      return null;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

// Sync after a single card, only if the user opted in.
export async function syncAfterCard(ctx) {
  try {
    if ((await ctx.api.getSetting(SYNC_EACH_CARD)) === "true") await syncNow(ctx);
  } catch (_e) {
    /* never let sync interfere with grading */
  }
}
