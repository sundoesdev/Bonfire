// Tests for the pure helpers in dom.js — the ones with real logic rather than
// markup. Run with: node --test Bonfire/src/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { enableTab, dueLabel } from "./dom.js";

// A textarea stand-in: enough of the interface for enableTab, plus a way to fire
// the keydown it registers.
function editor(value, start, end = start) {
  const ta = {
    value,
    selectionStart: start,
    selectionEnd: end,
    addEventListener: (_name, handler) => (ta.press = (shiftKey) =>
      handler({ key: "Tab", shiftKey, preventDefault() {} })),
  };
  enableTab(ta, 4);
  return ta;
}

test("Tab indents by the configured width", () => {
  const ta = editor("abc", 3);
  ta.press(false);
  assert.equal(ta.value, "abc    ");
  assert.equal(ta.selectionStart, 7);
});

test("Tab replaces the selection rather than keeping it", () => {
  const ta = editor("ab", 0, 2);
  ta.press(false);
  assert.equal(ta.value, "    ");
  assert.equal(ta.selectionStart, 4);
});

test("Shift+Tab outdents by one full width", () => {
  const ta = editor("        deep", 12);
  ta.press(true);
  assert.equal(ta.value, "    deep");
  assert.equal(ta.selectionStart, 8);
});

test("Shift+Tab removes only what indent there is", () => {
  const ta = editor("  two", 5);
  ta.press(true);
  assert.equal(ta.value, "two");
  assert.equal(ta.selectionStart, 3);
});

test("Shift+Tab on an unindented line changes nothing", () => {
  const ta = editor("none", 4);
  ta.press(true);
  assert.equal(ta.value, "none");
  assert.equal(ta.selectionStart, 4);
});

test("Shift+Tab outdents the caret's own line, not the first", () => {
  const ta = editor("a\n    b", 7);
  ta.press(true);
  assert.equal(ta.value, "a\nb");
  assert.equal(ta.selectionStart, 3);
});

test("a caret inside the indent never lands before the line start", () => {
  const ta = editor("    xy", 1);
  ta.press(true);
  assert.equal(ta.value, "xy");
  assert.equal(ta.selectionStart, 0);
});

// dueLabel drives the grade-button previews, so its day arithmetic has to be
// right at the boundaries a user actually sees.
const inDays = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

test("dueLabel names the near days rather than counting them", () => {
  assert.match(dueLabel(inDays(0)), /^today\n/);
  assert.match(dueLabel(inDays(1)), /^tomorrow\n/);
  assert.match(dueLabel(inDays(2)), /^in 2 days\n/);
});

test("dueLabel counts further days, including across a month boundary", () => {
  assert.match(dueLabel(inDays(11)), /^in 11 days\n/);
  assert.match(dueLabel(inDays(111)), /^in 111 days\n/);
});

test("dueLabel treats an overdue date as today rather than going negative", () => {
  assert.match(dueLabel(inDays(-5)), /^today\n/);
});

test("dueLabel returns empty for a missing or malformed date", () => {
  assert.equal(dueLabel(""), "");
  assert.equal(dueLabel(null), "");
  assert.equal(dueLabel("not-a-date"), "");
});
