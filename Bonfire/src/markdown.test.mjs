// Run with: node --test src/markdown.test.mjs
//
// These lock down the two things markdown-lite kept getting wrong on code notes:
// a C pointer must never become emphasis, and a fenced block must never be parsed
// as markdown at all. There is no frontend test runner — this file is standalone.
import test from "node:test";
import assert from "node:assert/strict";

// mdLite's only environment dependency is `window.hljs`; without it highlightHtml
// falls back to escaped plain text, which is exactly what we want to assert on.
globalThis.window = {};

const { mdLite } = await import("./markdown.js");

test("pointer stars are literal, not emphasis", () => {
  for (const src of [
    "void swap(int *a, int *b);",
    "int *ptr = *other;",
    "*p++ = *q++;",
    "char **argv is a pointer to a pointer",
  ]) {
    const out = mdLite(src);
    assert.ok(!out.includes("<em>"), `italicized: ${src} -> ${out}`);
    assert.ok(!out.includes("<strong>"), `bolded: ${src} -> ${out}`);
  }
});

test("underscores inside a word are literal", () => {
  const out = mdLite("MAX_INT and my_var_name");
  assert.equal(out, "MAX_INT and my_var_name");
});

test("real emphasis still works", () => {
  assert.equal(mdLite("*italic*"), "<em>italic</em>");
  assert.equal(mdLite("**bold**"), "<strong>bold</strong>");
  assert.equal(mdLite("an _emphasized_ word"), "an <em>emphasized</em> word");
  assert.equal(mdLite("an __important__ word"), "an <strong>important</strong> word");
});

test("fenced blocks render as code and shield their contents", () => {
  const out = mdLite("```c\nint *p = &x;\n```");
  assert.match(out, /^<pre class="code-block hljs"><code>/);
  assert.ok(!out.includes("<em>"), out);
  assert.ok(out.includes("int *p = &amp;x;"), out);
});

test("two fenced blocks do not swallow the prose between them", () => {
  const out = mdLite("```c\nint *p;\n```\ntext *ptr here\n```c\nchar *q;\n```");
  assert.equal(out.match(/<pre /g).length, 2, out);
  assert.ok(out.includes("text *ptr here"), out);
  assert.ok(!out.includes("<em>"), out);
});

test("inline code is still shielded and escaped", () => {
  assert.equal(mdLite("use `*ptr` here"), "use <code>*ptr</code> here");
  assert.equal(mdLite("`a < b`"), "<code>a &lt; b</code>");
});

test("bullets and links survive", () => {
  assert.equal(mdLite("- one\n- two"), "<ul><li>one</li><li>two</li></ul>");
  assert.equal(
    mdLite("[docs](https://example.com)"),
    '<a href="https://example.com" target="_blank" rel="noreferrer">docs</a>'
  );
});

test("html in the source is escaped", () => {
  assert.equal(mdLite("<script>alert(1)</script>"), "&lt;script&gt;alert(1)&lt;/script&gt;");
});
