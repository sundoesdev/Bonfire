// Wrapper around the vendored highlight.js browser bundle (loaded as a global
// `hljs` via a <script> tag in index.html).
import { hljsLang } from "./constants.js";

// Render `code` into `el` as syntax-highlighted HTML. Falls back to plain text
// if hljs or the language is unavailable.
export function highlightInto(el, code, language) {
  const hljs = window.hljs;
  if (!hljs) {
    el.textContent = code;
    return;
  }
  const id = hljsLang(language);
  try {
    if (id && hljs.getLanguage(id)) {
      el.innerHTML = hljs.highlight(code, { language: id, ignoreIllegals: true }).value;
    } else {
      el.innerHTML = hljs.highlightAuto(code).value;
    }
    el.classList.add("hljs");
  } catch (_e) {
    el.textContent = code;
  }
}
