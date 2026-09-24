// Wrapper around the vendored highlight.js browser bundle (loaded as a global
// `hljs` via a <script> tag in index.html).
import { hljsLang } from "./constants.js";
import { esc } from "./dom.js";

// Highlight `code` and return HTML. Falls back to escaped plain text if hljs or
// the language is unavailable, so the result is always safe for innerHTML.
export function highlightHtml(code, language) {
  const hljs = window.hljs;
  if (!hljs) return esc(code);
  const id = hljsLang(language);
  try {
    if (id && hljs.getLanguage(id)) {
      return hljs.highlight(code, { language: id, ignoreIllegals: true }).value;
    }
    return hljs.highlightAuto(code).value;
  } catch (_e) {
    return esc(code);
  }
}

// Render `code` into `el` as syntax-highlighted HTML.
export function highlightInto(el, code, language) {
  el.innerHTML = highlightHtml(code, language);
  el.classList.add("hljs");
}
