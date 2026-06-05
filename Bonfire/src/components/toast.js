// Tiny transient toast notifier for confirming actions (CRUD saves/deletes, etc.).
// Lives in its own #toast-root appended to <body> — NOT inside #view — so a toast
// survives the navigate()/re-render many handlers trigger right after mutating.
const DISMISS_MS = 2500;

function toastRoot() {
  let root = document.querySelector("#toast-root");
  if (!root) {
    root = document.createElement("div");
    root.id = "toast-root";
    document.body.appendChild(root);
  }
  return root;
}

// type: "success" (default, green) | "error" (red).
export function showToast(message, type = "success") {
  const root = toastRoot();
  const node = document.createElement("div");
  node.className = `toast ${type}`;
  node.textContent = message;
  root.appendChild(node);

  // Trigger the slide/fade-in on the next frame.
  requestAnimationFrame(() => node.classList.add("show"));

  const remove = () => {
    node.classList.remove("show");
    node.addEventListener("transitionend", () => node.remove(), { once: true });
    // Fallback in case the transition doesn't fire.
    setTimeout(() => node.remove(), 400);
  };
  setTimeout(remove, DISMISS_MS);
}
