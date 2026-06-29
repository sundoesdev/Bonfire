# Hearth — Part 2: Views Overhaul & Polish Specification

> **Handoff document for Claude Code.** Part 1 (`Hearth-Redesign-and-Rebrand-Spec.md`) covered the token layer, the two-theme system, the rename, and the dashboard — **all of that has shipped.** This Part 2 covers the remaining views: **Library, Study setup, Stats, Tags, Settings, and the Study session**, plus three small dark-mode control bugs. It is written to be executed surgically against the current codebase, following the working agreement in §1.

> **Visual references:** six rendered Light-mode mockups accompany this document — one per view above. They are the canonical visual target. Where a mockup and this document agree, follow both; where this document specifies something a mockup can't show (dark mode, exact selectors, what *not* to touch), this document governs.

---

## Table of contents

1. [Working agreement (how to execute this)](#1-working-agreement-how-to-execute-this)
2. [What's already done — do not rebuild](#2-whats-already-done--do-not-rebuild)
3. [Decisions to confirm before coding](#3-decisions-to-confirm-before-coding)
4. [Three global control fixes (the dark-mode bugs)](#4-three-global-control-fixes-the-dark-mode-bugs)
5. [Shared: page-header consistency](#5-shared-page-header-consistency)
6. [Library](#6-library)
7. [Study setup](#7-study-setup)
8. [Stats](#8-stats)
9. [Tags](#9-tags)
10. [Settings — the tabbed overhaul](#10-settings--the-tabbed-overhaul)
11. [Study session](#11-study-session)
12. [Phased plan with verification](#12-phased-plan-with-verification)
13. [Acceptance checklist](#13-acceptance-checklist)

---

## 1. Working agreement (how to execute this)

This project follows the four `CLAUDE.md` principles. Here is what each means *specifically* for this overhaul:

**Think before coding.** This is a reskin of an app whose logic already works. Before changing a file, read its current state and confirm the change is visual/structural, not behavioral. Three decisions in this spec are genuinely open — they're listed in §3. Do not pick them silently; confirm with the user first. If a mockup seems to imply a behavior change the prose doesn't call for, treat the prose as authoritative and ask.

**Simplicity first.** Prefer a CSS-only change over a markup change, and a markup change over a logic change. Every view below is mostly CSS plus small markup edits. If you find yourself rewriting a view module's data flow, selection logic, or event wiring, stop — that's out of scope. The Study session and Stats especially are *already* close; resist the urge to rebuild them.

**Surgical changes.** Touch only what each task names. Do not "improve" adjacent handlers, do not refactor the `el()`/`querySelector` rendering pattern, do not restyle components a task doesn't mention. Match the existing conventions: views build a DOM tree with `el(\`…\`)`, wire it with `root.querySelector(...)`, and append to `container`. New markup should use the existing token-driven classes (`.panel`, `.section-title`, `.list-row`, `.pill`, `.lang-dot`, `.btn*`, `.ring`, `progressRing()`) rather than new bespoke CSS wherever possible. If a change orphans an import or a CSS rule, remove only that orphan.

**Goal-driven execution.** Each task below ends with a **verify** block — concrete, checkable success criteria. Implement to the verify block, then check it in both Light and Dark before moving on. The phased plan in §12 sequences the work so each phase is independently verifiable.

**Scope guardrails (do not touch):** the Rust backend, the Tauri command surface, the SQLite schema, the `shard` data model, SR scheduling, the review log, import/export, `main.js` navigation/shortcuts, the bulk-action logic in `bulkBar.js`, the modal/confirm/toast components, and the selection/Shift-click logic in any view. This is a presentation pass.

---

## 2. What's already done — do not rebuild

Reading the current source confirms Part 1 landed cleanly. **Do not redo any of this:**

- **Token layer + two themes.** `styles.css` `:root` holds Hearth Light; `body.theme-dark` holds Coal & Ember. Legacy aliases (`--panel`, `--primary`, `--due`, etc.) map onto the new tokens. `color-scheme` is set per theme.
- **`theme.js`** is collapsed to `light`/`dark`, defaults to `prefers-color-scheme`, persists `ui_theme`.
- **Dashboard** (`dashboard.js`) is fully redesigned (serif greeting + sub, hero with `progressRing`, stat tiles, language bars, forecast, quiet rows). It is signed off — leave it alone.
- **Badge→dot system** (`dom.js`): `langDot`, `langBadge`, `famBadge` (demoted), `catBadge`, `metaBadges` (quiet pills), and `progressRing` all exist and are correct. Reuse them; don't reinvent.
- **Study session essentials** (`study.js` + CSS): `body.studying` dims the sidebar (focus field); the CodeMirror editor is themed with `--code-bg`, a gutter, a placeholder, and the VIM keymap; the reveal `.compare` two-column diff exists; the warm rating buttons (`.rating .forgot/.hard/.good/.easy` + `.rating-key` hotkey chips) exist and are correctly warmed. The 1/2/3/4 keyboard grading is wired and gated to post-reveal.
- **Stats warmth**: the retention curve (`.ret-line`/`.ret-area`) is accent-tinted; the heatmap ramp (`.hm-cell[data-level]`) uses accent opacity steps with `--surface-3` empties; the card-debt copy is already reframed ("A few shards have cooled…").
- **Rename**: brand is "Hearth", `index.html` title is Hearth, export default is `hearth-export.json`, Tabler icons + Fraunces are vendored.
- **Accessibility base**: `:focus-visible` rings and a `prefers-reduced-motion` reset exist.

The remaining work is therefore **narrower than the mockups imply**: three control bugs, one big structural change (Settings tabs), two medium ones (Library filter bar, Tags grouping), and light polish on Study setup / Stats / the Study session.

---

## 3. Decisions to confirm before coding

Per "think before coding," confirm these with the user before implementing — each changes flow or scope, so don't pick silently:

1. **Study setup: live-preview card vs restyle-only.** The mockup shows a two-column setup (form + a live "session preview" card with the Build-queue CTA). The app already has a setup → editable-queue-preview → session flow (`renderSetup` → `renderPreview` in `study.js`). Options: **(a)** add a lightweight live summary card beside the existing form (more build, mild flow change, matches mockup), or **(b)** restyle the existing form into tidy cards + segmented control + difficulty chips and leave the existing preview flow intact (simpler, surgical). Recommendation: **(b)** unless the user specifically wants the side-preview. Confirm.

2. **Settings sub-nav: top tabs vs left rail.** The mockup shows top tabs. A left sub-rail is also viable and reads more like a "preferences" app. Top tabs are less layout change. Recommendation: **top tabs.** Confirm before building.

3. **Checkbox fix depth.** The minimal fix (`accent-color`) recolors the check but leaves the native box shape; a full custom checkbox (`appearance: none` + drawn box) gives complete control but touches more. Recommendation: start minimal, escalate only if the unchecked box still reads too bright in Dark. Confirm acceptable. (Details in §4.)

Everything else in this document is presentation-only and safe to implement directly.

---

## 4. Three global control fixes (the dark-mode bugs)

All three live in `styles.css` and fix every view at once. These are the highest-priority items — they're the bugs the user reported.

### 4.1 Unstyled number inputs render as white boxes

**Cause:** the input rule matches only `input[type="text"], textarea` (around line 260). `input[type="number"]` (Max cards, ease floor, interval modifier, hard multiplier, FSRS retention) and any other input types fall through to the native control, which is white in Dark.

**Fix:** broaden the selector so all text-like inputs get the token treatment. Minimal, surgical:

```css
input[type="text"],
input[type="number"],
input[type="search"],
textarea { /* existing token styles unchanged */ }
```

(Or, equivalently, `input:not([type="checkbox"]):not([type="radio"]) , textarea`.) Do not change the declarations inside — only the selector list. Apply the same broadening to the `input:focus, textarea:focus, select:focus` rule so number inputs get the accent focus ring too.

**Verify:** in Dark mode, the Max cards field (Study setup) and the ease-floor/interval/hard fields (Settings → Scheduling) have the dark `--input` background and readable `--text`, with an accent focus ring — no white boxes.

### 4.2 Native checkboxes are bright white squares

**Cause:** native `<input type="checkbox">` (row selectors, "Select all", the difficulty/language/tag filter checkboxes in the study form) has no token styling.

**Minimal fix:**

```css
input[type="checkbox"] { accent-color: var(--accent); }
```

This colors the checked fill with the ember accent and is supported in the WebKitGTK/WebView2 webviews. **If** the *unchecked* box still reads too bright on the coal background (likely on WebKitGTK), escalate to a full custom control:

```css
input[type="checkbox"]{
  appearance:none; -webkit-appearance:none;
  width:15px; height:15px; border-radius:4px;
  border:1.5px solid var(--border-strong); background:var(--surface);
  cursor:pointer; vertical-align:-2px;
}
input[type="checkbox"]:checked{ background:var(--accent); border-color:var(--accent); }
input[type="checkbox"]:checked::after{
  content:""; display:block; width:4px; height:8px; margin:1px auto;
  border:solid var(--on-accent); border-width:0 2px 2px 0; transform:rotate(45deg);
}
```

Keep whichever is sufficient — don't add the custom block if `accent-color` alone looks right (simplicity first). This is decision §3.3.

**Verify:** in both themes, checkboxes match the palette — accent when checked, a calm token-bordered box when not. No stark white squares in Dark.

### 4.3 Selects show native faceted chrome ("hexagonal border")

**Cause:** the `select` rule (around line 270) styles background/border/radius but never sets `appearance: none`, so WebKitGTK renders its native widget chrome (the faceted corner the user saw) on top.

**Fix:** suppress the native chrome and supply a custom chevron, so no markup changes are needed (selects are generated in many places):

```css
select{
  appearance:none; -webkit-appearance:none;
  padding-right:28px;
  background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2395876F' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M6 9l6 6 6-6'/></svg>");
  background-repeat:no-repeat;
  background-position:right 9px center;
  /* existing background-color/border/radius/min-height/etc. unchanged */
}
```

Note the chevron stroke color is hardcoded to the muted hex (`%2395876F`). If you want it to track the theme exactly, that's optional polish; the muted tone reads fine in both. Keep the existing `background` color declaration — set it as `background-color` so it doesn't clobber the chevron `background-image` (i.e. split the shorthand, or declare `background-image` after the existing `background`).

**Verify:** in both themes, every dropdown (Library filters, deck switcher, Settings selects, Study session-type) shows a single clean rounded control with one chevron — no faceted/native border, no double chevron.

---

## 5. Shared: page-header consistency

Several views still use `<h2 style="margin:0;font-size:16px">Title</h2>` (Stats, Tags, Settings) while the dashboard uses the serif `.page-greeting` (24px). Unify them so every view opens the same way.

**Change:** replace each view's `<h2 style="…16px">` header with the dashboard's pattern:

```html
<div class="page-greeting">Title</div>
<div class="page-sub">one quiet line of context</div>   <!-- optional, where it adds info -->
```

`.page-greeting` and `.page-sub` already exist in `styles.css`. Use the existing `.dash-head` row only if the view also has top-right actions (Library, Stats don't need it). This is a 1-line markup swap per view; do not add new CSS.

**Verify:** Library, Study, Stats, Tags, Settings all open with a 24px serif title in the same position and size as the dashboard.

---

## 6. Library

**Current state** (`library.js`): a `.row` with a full-width search + `+ New`; a `.filters` flex of five native `<select>`s; an always-present `.bulk-toolbar` (sticky, with greyed buttons + "Select all"); then the list. Rows already use `langDot` + `metaBadges` + a Review button — the row itself is already quiet and correct.

**Target** (see Library mockup): a calmer filter bar, a **contextual** bulk bar that appears only when something is selected, and the same quiet rows.

**Changes:**

1. **Selects** are fixed globally by §4.3 — no per-view work needed; they'll lose the native chrome automatically. Optionally push the sort select to the right with `margin-left:auto` (the `.filters` rule already wraps).
2. **Bulk bar → contextual.** Today `.bulk-toolbar` is always visible with disabled buttons. Make it appear only when `selected.size > 0`. Minimal approach that respects the existing logic: keep the toolbar element, but toggle a `hidden` attribute (or a `.is-empty` class that sets `display:none`) inside the existing `updateToolbar()` function based on `selected.size`. Keep "Select all" available — relocate it to the filter row or leave a slim persistent strip; simplest is to hide the *action buttons* container when empty and keep "Select all" + count always visible. Do **not** change the selection logic, `runBulk`, or the bulk handlers — only their container's visibility.
3. **Rows** need no change — `langDot` + `metaBadges` already produce the mockup's quiet pill + dot. Confirm `metaBadges` is what's rendered (it is) and leave it.

**Do not touch:** `fuzzyMatch`/`searchText`, the filter/sort logic in `applyAndRender`, Shift-click range selection, dblclick-to-open, the Review handler.

**Verify:** with nothing selected, the toolbar shows only "Select all" + the result count (no greyed button row); selecting a card reveals the action buttons; deselecting all hides them again. Filters render as clean dropdowns in both themes. Selection/range/open behaviors are unchanged.

---

## 7. Study setup

**Current state** (`study.js` `renderSetup` + `buildStudyConfigForm`): a stack of panels (Deck, Session limits with a native select + number input, Difficulty as checkboxes, Cram). `buildStudyConfigForm` is **shared** with Settings → Study, so changes here ripple there — keep it backward-compatible.

**Target** (see Study setup mockup): tidy cards, session type as a **segmented control**, difficulty as **toggle chips**, a properly-styled Max-cards input (fixed by §4.1), and optionally a live session-preview card with the Build-queue CTA (decision §3.1).

**Changes (restyle path, recommended):**

1. **Wrap each group in a `.panel`** with a `.section-title` eyebrow, matching the rest of the app (the form likely already uses panels — verify and align spacing with the spacing tokens; don't hand-roll margins).
2. **Session type → segmented control.** Replace the `By card count / By time` `<select>` with two `.btn-toggle` buttons in a small segmented group (the `.btn-toggle.on` style already exists). This is a markup change in `buildStudyConfigForm`; preserve the underlying value the rest of the form reads (set a hidden field or the same state variable the existing `syncMode()` uses, so no logic downstream changes). If wiring `syncMode()` to buttons instead of a select is non-trivial, **leave it as a styled select** — the §4.3 fix already makes it look clean. Prefer the smaller change.
3. **Difficulty checkboxes → toggle chips.** Render the difficulty options as `.btn-toggle` chips (on/off) instead of raw checkboxes. Keep the same underlying selected-set logic. If the checkbox→chip rewrite risks the filter logic, the §4.2 checkbox fix already makes the checkboxes acceptable — fall back to that. Prefer chips only if it's a clean swap.
4. **Max cards / number inputs** are fixed by §4.1 — no per-view work.
5. **Optional (decision §3.1):** a side preview card. If approved, add a right-column `.panel` that reads the current queue size (reuse `matchingCards`/`queueCap` already in `study.js`) and hosts the primary "Build queue" button. Wrap `renderSetup`'s form + this card in a two-column grid (reuse `.dash-cols` or a local grid). Do not duplicate the existing `renderPreview` queue editor — this is a *summary*, not the editable queue.

**Do not touch:** `buildQueue`, `matchingCards`, `queueCap`, `loadConfig`/`saveConfig`, the preview/session flow.

**Verify:** the setup screen reads as composed cards (no sparse floating panels); session type and difficulty are visually on-brand; Max cards is dark-correct; Settings → Study (which reuses the form) still renders and saves correctly. Building a queue and studying still works end to end.

---

## 8. Stats

**Current state** (`stats.js`): already warm and well-structured — stat tiles, accent heatmap with month labels and totals, reframed card-debt panel, accent retention curve, weak-tags list, and **deck mastery as `.mastery-track` bars**.

**Target** (see Stats mockup): the same content, with deck mastery shown as a **ring** to rhyme with the dashboard hero, and the shared header.

**Changes:**

1. **Header** → `.page-greeting` per §5.
2. **Deck mastery → ring (optional but on-brand).** In the deck-mastery list, replace the per-deck `.mastery-track`/`.mastery-fill` bar with `progressRing(d.mastery, d.name, 64)` (the helper already exists in `dom.js`). Keep the card count beside it. If a deck has many entries and rings get heavy, keep the bar — but for the typical 1–3 decks, rings are nicer. Your call within the spirit of the mockup; the bar is acceptable if rings crowd the layout.
3. **Heatmap empties** are already `--surface-3` via the `--glass-bg` alias — **verify in Dark** they render as soft coal cells (not bright). If they read bright in Dark, the cause is the `1px solid var(--glass-border)` border on tiny cells; reduce to `0.5px` or drop the border on `data-level="0"`. Only change this if the Dark render is actually wrong.
4. **Weak-tags / debt rows** already use quiet `.lang-dot`/`.cat`/`.mastery-track` — leave them.

**Do not touch:** all the computation (`buildHeatmap`, `streaks`, `retentionCurve`, `weakTags`, `deckMastery`, `cardDebt`), the reset dialog, the Study-all wiring.

**Verify:** Stats opens with the serif header; deck mastery shows rings (or intentionally-kept bars); heatmap empties are soft in both themes; retention curve and debt panel unchanged.

---

## 9. Tags

**Current state** (`tags.js`): a flat `.list-row` list; each row has `#tag`, a muted "special" marker, a count, a loud `.btn-accent` "Rename / merge", and a `.btn-danger` "Delete".

**Target** (see Tags mockup): tags **grouped** into *Special / keyword* vs *Topic*, each row with a thin **usage bar** (relative to the most-used tag), and **quiet** rename/delete actions (orange is reserved — Rename should not be an accent button).

**Changes:**

1. **Header** → `.page-greeting` + the existing helper line as `.page-sub`.
2. **Group the tags.** Partition `tags` into special (`SPECIAL_TAGS.has(t)`) and topic. Render two labeled groups (`.section-title` "Special — keyword tags" / "Topic tags"), each a `.panel` of rows. If a group is empty (e.g. no topic tags), show a quiet empty hint ("No topic tags yet — add one like `networking` to organize by subject.") rather than omitting it.
3. **Usage bar.** Add a `.mastery-track`/`.mastery-fill` (reuse the existing Stats bar classes — don't add new CSS) sized to `count / maxCount`. Keep the count label.
4. **Quiet the actions.** Change "Rename / merge" from `.btn-accent` to `.btn-tool` (secondary); keep Delete but as a quiet danger (`.btn-tool` with `.btn-danger` text, or keep `.btn-danger` if a filled danger is preferred — but make Rename secondary so orange isn't spent on it).

**Do not touch:** the `renameTag`/`deleteTag` calls, the `prompt`/`confirm` flows (cosmetic only), the global-over-all-shards counting.

**Verify:** tags appear in two labeled groups with usage bars; Rename is a neutral secondary button (not accent); Delete still works; renaming/merging and deleting still re-render correctly.

---

## 10. Settings — the tabbed overhaul

**This is the headline of Part 2.** Current state (`settings.js`): one long `el(\`…\`)` tree of eight `.section-title` + `.panel` blocks in a single scroll — Card integrity, Appearance, Editor, Decks, Spaced repetition, Card templates, Study session defaults (+ a `#study-slot` that hosts `buildStudyConfigForm`), Data. Handlers are wired afterward by `root.querySelector(...)`.

**Target** (see Settings mockup): the same blocks, reorganized into **tabbed sections** so each panel is short and focused, with the controls fully styled (theme swatch control already exists; selects/inputs/checkboxes fixed by §4).

**Approach — surgical, because the wiring is `querySelector`-based and order-independent:**

1. **Group the existing blocks into tabs** (no content rewrite):
   - **Appearance** → the existing Appearance panel + the Editor (VIM) panel.
   - **Study** → the Study-session-defaults panel + `#study-slot` (the shared form).
   - **Decks** → the Decks panel.
   - **Scheduling** → the Spaced-repetition panel.
   - **Templates** → the Card-templates panel.
   - **Data** → the Data panel (export/import + danger zone).
   - **Integrity** → the Card-integrity panel.

2. **Wrap, don't rewrite.** Keep every section's existing markup verbatim. Wrap each group's `.section-title`+`.panel`(s) in a `<section class="settings-tab" data-tab="appearance">…</section>`. Add a tab bar above:
   ```html
   <div class="settings-tabs" role="tablist">
     <button class="settings-tab-btn active" data-tab="appearance">Appearance</button>
     … one per group …
   </div>
   ```
   Show the active section, hide the rest with a class (`.settings-tab{display:none} .settings-tab.active{display:block}`). A tiny switch function toggles `.active` on the clicked button + matching section. This is ~15 lines of new JS and ~6 lines of new CSS; **all existing `root.querySelector(...)` handlers keep working** because every element is still in the DOM, just in a hidden section.

3. **New CSS** (small, token-driven — mirror the mockup's tab bar):
   ```css
   .settings-tabs{ display:flex; gap:4px; flex-wrap:wrap; border-bottom:0.5px solid var(--border); margin-bottom:var(--space-4); }
   .settings-tab-btn{ padding:7px 12px; border:none; background:transparent; color:var(--text-2); font:inherit; font-size:13px; border-radius:var(--r-md) var(--r-md) 0 0; cursor:pointer; }
   .settings-tab-btn.active{ color:var(--text); font-weight:500; background:var(--surface); border:0.5px solid var(--border); border-bottom-color:var(--surface); margin-bottom:-1px; }
   .settings-tab{ display:none; }
   .settings-tab.active{ display:block; }
   ```
   (Per the host's "no rounded corners on single-sided borders" caution from Part 1, the active tab uses a full border with a matched bottom color rather than only a top accent.)

4. **Persist the active tab (optional, nice):** remember the last-opened tab in a setting (e.g. `settings_tab`) so re-entering Settings lands where the user left. Only if trivial; skip if it adds risk.

5. **The 36-language filter** (inside the shared study form, now under the **Study** tab) is the worst density offender. If — and only if — decision §3.1's form work is approved, consider rendering it as a wrap of `.btn-toggle` chips instead of 36 stacked checkboxes. Otherwise the §4.2 checkbox fix makes the existing list acceptable; leave it. Do not let this balloon scope.

**Do not touch:** any of the section handlers (deck add/delete/preset, SR save/reset, template add/edit, study-defaults save, export/import, wipe/delete gates, integrity list), the `buildStudyConfigForm` integration, or the modal helpers at the bottom of the file. Only wrap markup, add the tab bar, and add the switch function + CSS.

**Verify:** Settings opens on the Appearance tab; clicking a tab shows only that group; every existing control (theme swatch, font/scale selects, VIM toggle, deck management, SR knobs, templates, study defaults, export/import, danger zone, integrity) still works exactly as before; no console errors from missing elements; the whole screen is short enough to use without the old endless scroll.

---

## 11. Study session

**Current state** (`study.js` `runSession`/`card`/`showReveal` + CSS): already the focus field — `body.studying` dims the sidebar, the card is `.review-card` (centered, `max-width:760px`), the editor is themed with a placeholder + gutter + VIM, the reveal shows the `.compare` diff, and the warm rating buttons with 1–4 hotkeys exist. The user has already signed off on how this looks. **Treat this as polish-only; do not rebuild.**

**Optional refinements (only if the user wants them — otherwise leave as-is):**

1. **Calmer Submit.** The current Submit is `.btn-primary .full-width` — a wide accent slab. If the user wants it dialed back (the mockup shows a slightly calmer primary with a `Ctrl+Enter` hint), keep `.btn-primary` but it's fine as-is; a `Ctrl+Enter` hint chip is a nice touch. Low priority.
2. **Vertically center the field.** `.review-card` is `margin:16px auto` (top-aligned). The mockup grounds it more centrally. If desired, center the session content vertically in `#view` during `body.studying`. Cosmetic; skip if it complicates the existing layout.
3. **VIM toggle as a switch.** Currently a checkbox-style toggle (`.editor-vim-toggle`). The §4.2 fix already tames it; a switch is optional polish.

**Do not touch:** the session loop, `gradeAndAdvance`, `submitReview` wiring, the reveal teardown that gates 1–4, the cloze/reverse/reveal-only branches, the timer, `maybeFinish`.

**Verify:** the session still runs the full loop (type → submit → reveal/compare → 1–4 grade → next) with no layout shift; the sidebar still dims; any refinement applied looks correct in both themes. If no refinements are requested, this view ships unchanged.

---

## 12. Phased plan with verification

Sequenced so each phase is independently verifiable and low-risk first. Work on a branch; screenshot each view in both themes before and after.

```
Phase 0 — Branch + baseline screenshots (all views, both themes).
          verify: app builds and runs; baseline captured.

Phase 1 — Global control fixes (§4): number inputs, checkboxes, selects.
          verify: in Dark, no white inputs, no bright checkboxes, no faceted
          select borders — checked on Settings, Study setup, Library.

Phase 2 — Page-header consistency (§5) across Library/Study/Stats/Tags/Settings.
          verify: all five open with the 24px serif title like the dashboard.

Phase 3 — Library filter bar + contextual bulk bar (§6).
          verify: toolbar hidden until selection; selection/range/open unchanged.

Phase 4 — Tags grouping + usage bars + quiet actions (§9).
          verify: two groups, bars render, Rename is secondary, rename/delete work.

Phase 5 — Stats header + deck-mastery rings + heatmap-empty check (§8).
          verify: rings render; heatmap empties soft in Dark; computations intact.

Phase 6 — Settings tabs (§10).  [the big one]
          verify: tabs switch; every existing handler still works; no scroll wall.

Phase 7 — Study setup restyle (§7).  [confirm §3.1 first]
          verify: composed cards; shared form still saves; queue build works.

Phase 8 — Study session optional polish (§11).  [only if requested]
          verify: full loop intact, no layout shift.

Phase 9 — Cross-check: every view in both themes against its mockup + a11y
          (focus rings, contrast, reduced motion still honored).
```

Phases 1–2 are pure CSS/markup and nearly risk-free. Phase 6 is the largest but is wrap-and-toggle, not a rewrite. Phases 7–8 are gated on the §3 confirmations.

---

## 13. Acceptance checklist

Done when all are true, verified in **both** Light and Dark:

- [ ] **Bugs gone:** no white number inputs, no bright native checkboxes, no faceted/native select borders anywhere.
- [ ] Every view opens with the shared serif `.page-greeting` header.
- [ ] **Library:** bulk action buttons appear only on selection; filters are clean dropdowns; rows are quiet (dot + title + one difficulty pill + Review); all selection/search/sort behavior unchanged.
- [ ] **Study setup:** composed cards, on-brand session-type and difficulty controls, dark-correct Max cards; the shared form still powers Settings → Study and still saves.
- [ ] **Stats:** serif header; deck mastery as rings (or intentionally-kept bars); heatmap empties soft in Dark; all stats compute as before.
- [ ] **Tags:** grouped into special/topic with usage bars; Rename is a neutral secondary (orange reserved); rename/merge/delete work.
- [ ] **Settings:** tabbed into Appearance / Study / Decks / Scheduling / Templates / Data / Integrity; opens on Appearance; **every** existing control still functions; no endless scroll; no console errors.
- [ ] **Study session:** full review loop intact with no layout shift; sidebar still dims; any requested polish looks right.
- [ ] No backend, schema, scheduling, navigation, selection, or bulk-action logic was changed.
- [ ] Diffs are surgical — every changed line traces to a task above; no incidental refactors; orphaned imports/rules from these changes (and only those) cleaned up.
- [ ] Focus rings, AA contrast, and `prefers-reduced-motion` still hold in both themes.

---

*End of Part 2. Pair this with Part 1 (tokens, themes, rename, dashboard — already shipped) and the six Light-mode view mockups (canonical visual targets). Confirm the three §3 decisions before starting Phases 7–8.*
