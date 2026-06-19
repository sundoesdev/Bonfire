// A small yes/no confirmation dialog, stacked above everything else (appended to
// <body>, not #modal-root, so it can sit on top of an open card modal). Resolves
// true on confirm, false on cancel / backdrop click / Escape. Reused by the Add &
// Edit discard guard (item 8) and the study-session nav lock (item 6).
import { el } from "../dom.js";

export function confirmDialog({
  title,
  message,
  confirmLabel = "Yes",
  cancelLabel = "Cancel",
  confirmClass = "btn-primary",
} = {}) {
  return new Promise((resolve) => {
    const backdrop = el(`
      <div class="modal-backdrop confirm-backdrop">
        <div class="modal modal-confirm">
          <h2>${title}</h2>
          <div class="desc" style="margin-bottom:14px">${message}</div>
          <div class="actions">
            <button class="btn btn-secondary" id="confirm-no">${cancelLabel}</button>
            <button class="btn ${confirmClass}" id="confirm-yes">${confirmLabel}</button>
          </div>
        </div>
      </div>
    `);

    function done(val) {
      backdrop.remove();
      // Capture-phase so it beats any underlying modal's Escape handler.
      document.removeEventListener("keydown", onKey, true);
      resolve(val);
    }
    function onKey(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        done(false);
      } else if (e.key === "Enter") {
        e.preventDefault();
        done(true);
      }
    }

    backdrop.querySelector("#confirm-yes").addEventListener("click", () => done(true));
    backdrop.querySelector("#confirm-no").addEventListener("click", () => done(false));
    backdrop.addEventListener("mousedown", (e) => {
      if (e.target === backdrop) done(false);
    });

    document.body.appendChild(backdrop);
    document.addEventListener("keydown", onKey, true);
    backdrop.querySelector("#confirm-yes").focus();
  });
}
