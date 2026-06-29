# Hearth — Frontend Redesign & Rebrand Specification

> **Handoff document for Claude Code.** This describes how to take the existing **Bonfire** app (Tauri 2.0, Rust backend, vanilla HTML/CSS/JS frontend, no bundler) from its current state to **Hearth**: a warm, editorial, fire-themed redesign with a single Light theme and a single Dark theme. It is written to be executed in a future session with no prior context beyond the codebase itself and the accompanying dashboard mockup image.

> **Read this first:** there is an accompanying rendered mockup of the **Hearth dashboard (Light mode)**. That image is the canonical visual reference for the Light theme. This document is the source of truth for everything else — the Dark theme, the tokens, the methodology, and how the look extends to every other screen. When the image and this document agree, follow both. When this document specifies something the image doesn't show (e.g. Dark mode, the Study session, accessibility), follow this document.

---

## Table of contents

1. [The vision, in one paragraph](#1-the-vision-in-one-paragraph)
2. [Scope: what this is and isn't](#2-scope-what-this-is-and-isnt)
3. [The rebrand: Bonfire → Hearth (and the data-loss trap)](#3-the-rebrand-bonfire--hearth-and-the-data-loss-trap)
4. [Design philosophy & methodology](#4-design-philosophy--methodology)
5. [Design tokens — the source of truth](#5-design-tokens--the-source-of-truth)
6. [Theme system refactor (9 themes → 2)](#6-theme-system-refactor-9-themes--2)
7. [Typography & the serif identity](#7-typography--the-serif-identity)
8. [Iconography](#8-iconography)
9. [Component library](#9-component-library)
10. [Per-view application guide](#10-per-view-application-guide)
11. [The flow state — the single most important concept](#11-the-flow-state--the-single-most-important-concept)
12. [Microcopy & voice](#12-microcopy--voice)
13. [Accessibility](#13-accessibility)
14. [Implementation plan (phased, ordered by risk)](#14-implementation-plan-phased-ordered-by-risk)
15. [What stays exactly the same](#15-what-stays-exactly-the-same)
16. [Acceptance checklist](#16-acceptance-checklist)

---

## 1. The vision, in one paragraph

Hearth is a spaced-repetition tool for remembering code, redesigned to feel less like a SIEM dashboard and more like a high-end reading-and-learning app — Readwise, Reflect, iA Writer, Things. Every other developer tool is a dark, dense, high-contrast grid. Hearth's bet is the opposite: a **warm, paper-toned Light theme** (and a coal-and-ember Dark theme) with a **serif display face**, generous whitespace, soft depth, and a **single restrained accent** (terracotta/ember). The name carries a metaphor — you *tend* a hearth; a short session "keeps the embers warm" — and that metaphor sets the emotional tone of the whole product: calm, forgiving, intrinsically pleasant to return to. The redesign is almost entirely a CSS and markup reskin plus a theme-system collapse; the application logic, the Rust backend, and the data model do not change.

---

## 2. Scope: what this is and isn't

**In scope:**

- A complete visual redesign of the existing frontend (styles, markup classes, a handful of template strings).
- Collapsing the current 9-theme system down to exactly two: **Light** (the cream Hearth look) and **Dark** (warm coal/ash on ember).
- A cosmetic rename of the product from Bonfire to Hearth (display strings, window title, product name — **not** the bundle identifier; see §3).
- Carrying one coherent design language across every view, including views not shown in the mockup.
- Fixing specific existing UI problems documented below (badge/chip overload, alarm-colored forecast, the empty Study editor, inconsistent spacing).

**Out of scope (do not do these):**

- Renaming the **`shard`** data model, the Rust commands (`save_shard`, `list_shards`, `delete_shard`, etc.), or the SQLite schema. "Shard" stays. (Rationale in §3.)
- Changing the Tauri **bundle identifier** (this would orphan the user's existing database — see §3).
- Changing spaced-repetition algorithms, scheduling, the review log, decks/tags data, import/export formats, or any backend behavior.
- Adding new features. This is a redesign, not a feature release. (A couple of small UX *refinements* are called out where they're inseparable from the redesign — e.g. the Study completion state — but no net-new functionality.)

---

## 3. The rebrand: Bonfire → Hearth (and the data-loss trap)

### 3.1 The one thing you must not get wrong

Tauri derives the per-user application-data directory (where the SQLite database and settings live) from the app's **bundle identifier** in `tauri.conf.json` (the reverse-DNS `identifier`, e.g. `com.bonfire.dev`). On some platforms/configs the `productName` has historically influenced data paths as well.

**If you change the `identifier`, the renamed app will look in a new, empty directory and the user's entire vault will appear to have vanished.** This is the single highest-risk action in the whole rebrand.

**Therefore:**

- **Keep the existing `identifier` byte-for-byte.** Do not "tidy" it from `com.bonfire.*` to `com.hearth.*`.
- You **may** change `productName` and the window `title` to "Hearth" (these drive the installer/binary name and the OS window title).
- **After any rename, verify the data directory is unchanged**: launch the renamed build, confirm the existing shards/decks/settings load. If you must change `productName` for branding and it turns out to move the data dir on the target platform, you must add a one-time migration that copies the old app-data directory to the new one before first read — but the strongly preferred path is to keep both `identifier` and `productName`'s data implications stable and rename only display-facing strings. When in doubt, rename the display, keep the plumbing, and verify by loading real data.

### 3.2 "Shard" stays — here's why

The fire theme tempts a rename of the card unit (logs, kindling, embers, coals). **Don't.** "Shard" is woven through the Rust command surface (`save_shard`, `list_shards`, `delete_shards`, `retag_shards`, `add_cards_to_deck`…), the DB schema, and dozens of JS call sites. Renaming it is a backend refactor plus a data migration with zero functional payoff. "Shard" also reads fine alongside Hearth — a shard is a *fragment*, and Hearth is a deck of knowledge fragments you keep warm. Keep the word. If you ever want full thematic unity, that's a future, display-string-only project explicitly deferred here.

### 3.3 Rename checklist (display strings only)

Change "Bonfire" → "Hearth" in these user-facing places. This list is illustrative; grep the repo for `Bonfire` and treat each hit as display-or-plumbing per §3.1.

| File | What | Change |
|---|---|---|
| `index.html` | `<title>Bonfire</title>` | → `Hearth` |
| `index.html` | `.brand` div text "Bonfire" | → `Hearth` (with the flame mark — see §9.1) |
| `views/dashboard.js` | `<h2>Bonfire</h2>` in the header row | → a greeting (see §10.1) or `Hearth` |
| `data.js` | default export filename `"bonfire-export.json"` | → `"hearth-export.json"` (old files still import fine; this is just the default save name) |
| `update.js` | alert/setup strings mentioning Bonfire | → Hearth (cosmetic) |
| `tauri.conf.json` | `productName`, window `title` | → `Hearth` |
| `tauri.conf.json` | `identifier` | **leave unchanged** |
| `Cargo.toml` | package `name` | optional; affects binary name — change deliberately and only if you also accept a new binary filename. Safe to leave. |
| app icons / `icons/` | filenames referencing bonfire | rename files + update references if any are name-bound (cosmetic) |

The auto-updater scaffold (`update.js`) is a no-op until configured; renaming its strings is purely cosmetic and safe.

---

## 4. Design philosophy & methodology

This section is the "why." If a future decision isn't covered by a token or a component spec, derive it from these principles.

### 4.1 The stance

**Warm editorial calm.** Hearth treats long-form study as something closer to reading than to data entry. The visual language borrows from print and from premium reading apps: a real serif for display, paper-toned surfaces, ink-colored text, wide margins, and restraint with color. The emotional target is *unhurried and forgiving* — the antithesis of the red-overdue-pile anxiety that makes people quit Anki.

### 4.2 The methodologies actually used

1. **One-accent discipline (the most important rule).** The entire UI uses exactly one chromatic accent — terracotta/ember — plus one supporting hue (sage) used almost exclusively for the second category. Everything else is the neutral paper/ink ramp. Color is *earned*: a thing is colored only when color carries meaning (the accent CTA, a single language dot, the due/spike bar). This is the direct cure for the current build's biggest problem — every list row currently carries three-plus saturated chips, so nothing stands out and the eye has nowhere to rest. **Restraint is the aesthetic.**

2. **Semantic, not decorative, color.** Color encodes meaning, never sequence or decoration. Language identity becomes a small colored *dot*, not a full saturated label background (the current `langColor` values are GitHub *linguist* colors — designed as tiny dots, not as text backgrounds; painting `#e34c26` behind "WebDev (HTML/CSS/JS)" is what makes the current lists shout). "Due/overdue" is the *only* place warm-alarm intensity is allowed, and even then it's gentle.

3. **Typographic hierarchy as identity.** The serif/sans pairing isn't ornament; it's the brand. Serif = display (greetings, section/card titles, the big editorial stat numerals, the wordmark). Sans = everything functional (body, labels, buttons, inputs, lists). Mono = code. The contrast between serif headings and sans body is what makes Hearth instantly recognizable and "not another dev tool."

4. **Whitespace and vertical rhythm.** The current CSS hardcodes margins (`14px` here, `8px 0` there, inline `style="margin-bottom:14px"`). Hearth introduces a spacing scale and a slightly larger base font (14px) to breathe. Air is a feature: it signals calm and quality.

5. **Progressive disclosure / demotion of noise.** Most metadata that's currently shown on every row (`fresh`, `snippet`) is the *default state of most cards* — showing it everywhere is like labeling every unread email "unread." Demote it: familiarity becomes a small dot or a hover/detail-only detail; category moves to the detail view. The list shows what differentiates a row (its title, its language dot, whether it's due), nothing else.

6. **The "focus field" concept for study.** The app has two modes of being: *browsing* (dashboard, library, stats — these can be richer, warmer, more decorative) and *studying* (the review session — this must be quiet, minimal, and distraction-free). The design treats these differently on purpose. See §11.

7. **Soft, consistent depth.** Cards sit on the page with a single soft, warm shadow and a hairline border — never the near-flat, barely-there glass of the current `rgba(255,255,255,0.04)` panels that dissolve into the background. Depth is gentle but unambiguous: you can always tell a surface from the page.

### 4.3 Problems in the current build this redesign explicitly fixes

- **Chip/badge overload** → language-as-dot + demoted metadata (§9.3).
- **Alarm-colored forecast** (`--due: #f59e0b` at full brightness for a normal study day reads as a warning) → the forecast uses the accent at calm intensity; warm-alarm is reserved for genuine overdue/debt (§9.7, §10.1, §10.5).
- **No spacing scale / drifting rhythm** → spacing tokens + larger base (§5.4).
- **Panels that don't read as panels** (4%-alpha glass on a gradient) → opaque warm surfaces with soft shadow + hairline border (§5, §9.2).
- **The empty Study editor void** (CodeMirror not visibly mounted / unstyled black box) → a properly themed, mounted editor with a gutter and placeholder, centered in a calm field (§10.4).
- **Theme sprawl** (9 themes, several with questionable token mappings like red "muted" text) → two carefully built themes (§6).

---

## 5. Design tokens — the source of truth

These are the canonical values. Define them once as CSS custom properties and have **all** component CSS reference only tokens (the existing stylesheet is already almost entirely `var(--…)`-driven, which is what makes this redesign tractable — swapping the token layer does most of the work).

> **Color notation:** all hex values are final. Contrast notes use WCAG AA targets (4.5:1 for normal text, 3:1 for large/UI text and non-text indicators).

### 5.1 Light theme — "Hearth" (default)

| Token | Value | Role |
|---|---|---|
| `--bg` | `#F1E9DA` | Page background (warm cream) |
| `--surface` | `#FFFDF8` | Cards / panels |
| `--surface-2` | `#F8F2E7` | Sidebar, secondary surfaces |
| `--surface-3` | `#EFE6D6` | Sunken elements: bar tracks, inert wells |
| `--border` | `#ECE1CF` | Default hairline border |
| `--border-strong` | `#E2D6C2` | Emphasized border, dividers under hover |
| `--text` | `#2C2620` | Primary text (ink) |
| `--text-2` | `#6B6051` | Secondary text — **AA-safe**, use for any real text |
| `--text-3` | `#95876F` | Muted hints only — **decorative, not for essential text** |
| `--accent` | `#C75B39` | Terracotta/ember — the one accent |
| `--accent-hover` | `#B54F30` | Accent hover / accent text on light when <14px |
| `--accent-pressed` | `#A3461F` | Accent active state |
| `--accent-soft` | `#F2DCCF` | Accent tint: active nav pill, selected rows |
| `--on-accent` | `#FFFFFF` | Text/icon on an accent fill |
| `--sage` | `#6F9070` | Secondary hue — fills/dots/bars only, not body text |
| `--sage-soft` | `#E3EBE0` | Sage tint |
| `--danger` | `#B23A2E` | Destructive (warm-shifted red so it sits in the palette) |
| `--danger-soft` | `#F4DCD7` | Destructive tint |
| `--code-bg` | `#F6EFE2` | Code surface (editor + code blocks) |
| `--code-text` | `#4A4136` | Base code text |
| `--shadow-sm` | `0 1px 2px rgba(120,90,50,0.06)` | |
| `--shadow-md` | `0 6px 18px rgba(120,90,50,0.08)` | Card resting elevation |
| `--shadow-lg` | `0 14px 34px rgba(120,90,50,0.12)` | Modals, hero |
| `color-scheme` | `light` | |

### 5.2 Dark theme — "Coal & Ember" (warm dark, Claude-dark-adjacent)

A warm coal charcoal (red/orange-tinted, never neutral gray, never pure black) with a brightened ember accent. The accent is bright enough that **text on the accent fill is dark ink, not white** — this is both an accessibility requirement and the look you asked for.

| Token | Value | Role |
|---|---|---|
| `--bg` | `#1B1917` | Page background (warm coal) |
| `--surface` | `#232020` | Cards / panels |
| `--surface-2` | `#1F1C1A` | Sidebar, secondary surfaces |
| `--surface-3` | `#2A2624` | Sunken: bar tracks, wells |
| `--border` | `#322E2B` | Default hairline border |
| `--border-strong` | `#3E3935` | Emphasized border, dividers |
| `--text` | `#ECE7E0` | Primary text (warm off-white) |
| `--text-2` | `#A89E92` | Secondary text — **AA-safe** |
| `--text-3` | `#7D7368` | Muted hints only — **decorative** |
| `--accent` | `#E07A52` | Brightened ember |
| `--accent-hover` | `#EA8862` | Accent hover |
| `--accent-pressed` | `#C9663F` | Accent active |
| `--accent-soft` | `#3A2A22` | Accent tint (solid): active nav pill, selected rows |
| `--on-accent` | `#1E120C` | **Dark ink** on accent fills (≈5.7:1 on `--accent`) |
| `--sage` | `#87A98A` | Secondary hue — fills/dots/bars |
| `--sage-soft` | `#2B332B` | Sage tint |
| `--danger` | `#E0664F` | Destructive |
| `--danger-soft` | `#3A2420` | Destructive tint |
| `--code-bg` | `#141211` | Code surface (deep coal) |
| `--code-text` | `#C9BFB2` | Base code text |
| `--shadow-sm` | `0 1px 2px rgba(0,0,0,0.30)` | |
| `--shadow-md` | `0 6px 18px rgba(0,0,0,0.35)` | |
| `--shadow-lg` | `0 14px 34px rgba(0,0,0,0.45)` | |
| `color-scheme` | `dark` | |

### 5.3 Language dot colors (replaces full-badge linguist fills)

Language identity becomes an 8–9px dot, not a saturated text background. The dot colors can keep the spirit of the current `LANG_COLORS` map, but **muted/desaturated** so they read as quiet accents next to ink text rather than as alarms. Two examples that appear in the mockup:

| Language | Light dot | Dark dot |
|---|---|---|
| WebDev (HTML/CSS/JS) | `#C75B39` (the accent — it's the dominant language) | `#E07A52` |
| Shell | `#6F9070` (sage) | `#87A98A` |

For the full language set, desaturate each existing linguist color toward the warm palette (reduce saturation ~30–40%, nudge hue slightly warm). The dot is decorative-supportive; it is **never** the sole signal for anything (the language name is always available as text in the detail view and as a `title`/tooltip on the dot).

### 5.4 Spacing scale

Replace hardcoded margins with these.

| Token | Value |
|---|---|
| `--space-1` | `4px` |
| `--space-2` | `8px` |
| `--space-3` | `12px` |
| `--space-4` | `16px` |
| `--space-5` | `20px` |
| `--space-6` | `24px` |
| `--space-7` | `32px` |
| `--space-8` | `40px` |

Default gaps between stacked panels: `--space-4` (16px). Card internal padding: `14–18px`. Page padding in `#view`: `--space-5`/`--space-6`.

### 5.5 Radius scale (rounder/softer than current 4/6/8)

| Token | Value | Use |
|---|---|---|
| `--r-sm` | `8px` | Inputs, small controls, dots-of-rounding |
| `--r-md` | `11px` | Buttons, nav pills, deck box |
| `--r-lg` | `14px` | Cards / panels |
| `--r-xl` | `18px` | App window frame, modals, hero |
| `--r-pill` | `999px` | Pills, tag chips |

### 5.6 Motion

| Token | Value |
|---|---|
| `--t-fast` | `120ms` |
| `--t` | `180ms` |
| `--t-slow` | `260ms` |
| `--ease` | `cubic-bezier(0.2, 0, 0, 1)` (ease-out) |

Hover lifts are subtle (`translateY(-1px)` + shadow step). **All motion must be disabled under `prefers-reduced-motion`** (see §13), including the existing update-badge pulse animation.

---

## 6. Theme system refactor (9 themes → 2)

### 6.1 Target structure

- `:root` holds the **Light** tokens (Light is the default).
- A single override block holds **Dark**. Use a `data-theme="dark"` attribute on `<html>` (or `body.theme-dark` if you prefer to match the existing class approach — but an attribute is cleaner). All Dark tokens are redefined there.
- **All component CSS references only tokens** — no theme-specific component rules except the two syntax-highlighting token sets (§6.3). The current stylesheet's per-theme `.list-row.current`, `.time-banner`, and `.hljs-*` overrides collapse into the token layer + the two code themes.

### 6.2 What to delete / rewrite

- In `styles.css`: **delete all nine `body.theme-*` blocks** (Light, Solarized, Elflord, Habamax, Slate, Desert, Industry, Delek, and the existing dark `:root`). Replace with the two token sets above. Delete every per-theme `.hljs-*` and `.list-row.current`/`.time-banner` override; they're superseded by §6.3 and by tokens.
- In `theme.js`: reduce `THEMES` to `[{ id: "light", label: "Light" }, { id: "dark", label: "Dark" }]`. `applyTheme(id)` sets/removes the `data-theme="dark"` attribute (or class). Keep the persistence (`ui_theme` setting) you already have. **Default behavior on first run:** honor `prefers-color-scheme` (so a user on OS dark mode opens in Dark), then respect the user's explicit choice once set.
- In `settings.js`: replace the 9-theme selector with a clean **Light/Dark toggle** — ideally a small segmented control or two labeled swatches showing the cream and the coal. Remove the theme grid entirely.
- The existing **UI font** and **UI scale** settings (`ui_font`, `ui_scale`) are orthogonal and may stay. **But note:** headings/wordmark/stat-numbers always use the brand **serif** regardless of the UI-font setting (the UI-font setting governs the *body/UI sans* only). If you want to reduce surface further, it's reasonable to drop the user-selectable UI font and ship the one curated pairing (§7); your call. UI scale (zoom) can stay as-is.

### 6.3 Syntax highlighting — two themes, warm

Collapse the per-theme `hljs` and CodeMirror token overrides to exactly two sets, keyed off the same `data-theme`. Both are warm: a near-monochrome warm base with a single cool pop (teal) for functions/types, so code reads calmly on the cream/coal code surfaces.

**Light code tokens** (on `--code-bg #F6EFE2`):

| Token group | Color |
|---|---|
| base text | `#4A4136` |
| comment / quote | `#A89A83` *(italic)* |
| keyword / built-in / literal | `#B5491F` |
| string | `#5E7A4A` |
| number | `#9C6A1F` |
| function / title / section | `#2E6E78` |
| type / class | `#2E6E78` |
| attr / property / variable | `#8A5A2E` |
| meta / preprocessor | `#9A4FA0` |
| tag / name | `#B5491F` |

**Dark code tokens** (on `--code-bg #141211`):

| Token group | Color |
|---|---|
| base text | `#C9BFB2` |
| comment / quote | `#7D7368` *(italic)* |
| keyword / built-in / literal | `#E0805A` |
| string | `#9DBE7E` |
| number | `#E0B080` |
| function / title / section | `#6FB7C0` |
| type / class | `#6FB7C0` |
| attr / property / variable | `#D8A878` |
| meta / preprocessor | `#C79BD0` |
| tag / name | `#E0805A` |

Apply these to both the `.hljs-*` classes (highlight.js, used in read-only code views) **and** the CodeMirror `.cm-s-*` classes (the answer editor). Define a CodeMirror theme name (e.g. `cm-s-hearth`) and switch nothing per-mode at the CM level — let the `data-theme` token swap drive both, or define `cm-s-hearth-light` / `cm-s-hearth-dark` if cleaner. Selection color = `--accent-soft`. Cursor = `--text`. Gutter background = `--code-bg`, gutter text = `--text-3`.

---

## 7. Typography & the serif identity

### 7.1 Families

- **Display serif (the brand):** a warm, slightly literary serif. Recommended, in order: **Fraunces** (has an optical-size axis and a soft warmth that fits the metaphor), **Newsreader**, or **Source Serif 4** (the safe, neutral choice). All are OFL-licensed and safe to bundle.
- **UI sans:** **Inter** (already the app default). Keep it.
- **Mono:** the existing mono stack (`ui-monospace, Menlo, Consolas, …`). Keep it for code and, optionally, for small numeric counts.

**Vendor the serif as a self-hosted `woff2`** (this is an offline-capable desktop app — do not depend on a Google Fonts network fetch at runtime; bundle it the same way CodeMirror and highlight.js are vendored). Add `@font-face` rules and expose:

```
--font-serif: "Fraunces", Georgia, "Times New Roman", serif;   /* display */
--ui-font:    "Inter", "Segoe UI", "Helvetica Neue", sans-serif; /* body/UI (existing) */
--font-mono:  ui-monospace, Menlo, Consolas, "Liberation Mono", monospace;
```

If you ship a variable font, use weights 400 / 500 / 560. Georgia is the acceptable fallback (it's already in the app's serif stack) — the mockup was rendered with Georgia and still reads well, so the design degrades gracefully if the vendored font fails to load.

### 7.2 Type scale

| Element | Family | Size | Weight |
|---|---|---|---|
| Page greeting / H1 | serif | 24px | 500 |
| Section / card title (H2) | serif | 18px | 500 |
| Hero title / H3 | serif | 17–19px | 500 |
| Editorial stat number | serif | 27px | 500 (560 if the serif needs presence) |
| Body | sans | **14px** | 400 |
| Secondary body | sans | 13px | 400 |
| Eyebrow / section label | sans | 11px | 500, `letter-spacing: .4px`, uppercase |
| Button / control | sans | 13–14px | 500 |
| Code / mono | mono | 13px | 400 |

**Base body goes from 13px → 14px.** This is deliberate: the editorial feel wants more air and slightly larger reading text. Weights stay restrained — 400 for body, 500 for emphasis/headings, optionally 560 for the largest serif numerals. **No 700/black weights** anywhere; they fight the warmth.

> **Eyebrow accessibility note:** eyebrow labels carry section meaning, so color them `--text-2` (AA-safe), not `--text-3`. The mockup used a lighter muted tone for delicacy; the spec tightens it to pass contrast.

---

## 8. Iconography

The current app is text-only in the nav. Hearth introduces a small, consistent icon set (the mockup uses a leading icon per nav item, plus icons on buttons and stat affordances).

- **Recommended:** vendor a single outline icon set — **Lucide** (clean, editorial, pairs beautifully with the serif) or **Tabler** (outline) — as a self-hosted webfont (`woff2` + CSS) or as a curated inline-SVG sprite. Either fits the no-bundler, vendored-asset pattern already in the repo. Outline weight only; never filled.
- Icons inherit `currentColor` and `font-size`; size them 16px inline, 18–20px for nav, 24px max decorative.
- Decorative icons get `aria-hidden="true"`; icon-only buttons get an `aria-label`.

**Nav icon mapping** (suggested): Dashboard → home, Library → book, Study → play, Stats → bar-chart, Tags → tag, Settings → settings, New Shard → plus. Brand mark → **flame** (the one literal fire reference in the chrome — see §9.1). Misc: search, download (export), upload (import), chevron-down (deck switch), clock, check, sparkles (used once, on the dashboard hero in Light if desired).

If you prefer zero new dependencies, a tiny `icon(name)` helper returning inline SVG (mirroring the existing `el()`/`langBadge()` helpers in `dom.js`) with ~20 hand-picked paths is acceptable.

---

## 9. Component library

Reusable patterns. Build these once; every view composes them. All values reference tokens from §5.

### 9.1 App shell (sidebar + main)

- **Window frame:** the whole app reads as a warm panel. Outer radius `--r-xl`, page background `--bg`.
- **Sidebar** (`#sidebar`): `--surface-2`, right border `--border`, width ~**152px** (slightly wider than the current 148px for breathing room). Contains, top to bottom: the **wordmark** ("Hearth" in `--font-serif`, 17px/500, with a small flame icon in `--accent`), the **deck switcher** (eyebrow "Deck" + a rounded `--surface`/`--border` select styled as a soft box), the **nav**, a spacer, and the **+ New Shard** button pinned to the bottom (accent-filled).
- **Nav items:** 13px sans, `--text-2` resting, full-width pill (`--r-md`). **Active item:** background `--accent-soft`, text `--text` (Light) and icon/text tinted toward accent; weight 500. (Replace the current `inset 2px 0 0 var(--primary)` left-bar treatment with the soft pill fill — softer, warmer, and avoids the "rounded corner on a single-sided border" problem.)
- **Main** (`#view`): `--bg`, padding `--space-5`/`--space-6`, scrollbar thumb `--border-strong`. **Remove the current `linear-gradient(160deg, …)` background** — Hearth surfaces are flat warm fills, not gradients.

### 9.2 Cards / panels

- Background `--surface`, border `0.5px solid --border`, radius `--r-lg`, padding `14–18px`, shadow `--shadow-md` (resting). Hover (only where interactive): `--shadow-lg` + `translateY(-1px)`.
- **Section title inside a card** = eyebrow style (§7.2): 11px/500 uppercase, `--text-2`, `--space-3` bottom margin.
- This replaces the current `.panel` glass treatment (`--glass-bg`, `backdrop-filter: blur(10px)`). **Drop the `backdrop-filter`** — Hearth is not glass; flat warm surfaces are the look, and dropping blur also removes the WebKitGTK/Linux blur inconsistency and its GPU cost.

### 9.3 Badge → dot transformation (the #1 fix)

This is the highest-impact change in the whole redesign. In `dom.js`:

- **`langBadge(lang)`** → render a **dot + neutral text**, not a saturated fill. Markup intent:
  ```
  <span class="lang"><span class="lang-dot" style="--dot:<langColor>"></span>Name</span>
  ```
  `.lang-dot` is an 8–9px circle filled with `var(--dot)`; the language name is `--text` (in lists, the name is usually implied and can be omitted, leaving just the dot + the shard title — see the mockup's "Recently added" rows). The dot's color comes from the **desaturated** language map (§5.3). Set the color via a CSS variable on the element (`style="--dot:…"`) rather than `style="background:…"`, so theming/overrides stay in CSS.
- **`famBadge(fam)`** → **demote.** Familiarity (`fresh`/`shaky`/`solid`/`mastered`) should not appear as a saturated chip on every row. Options, in order of preference: (a) a small status dot only where it's *not* the default ("fresh" is the default — show nothing; "shaky" shows a small warm-amber dot), or (b) show familiarity only in the detail/edit view and in the Library's familiarity filter. Do **not** paint a `fresh` chip on every row.
- **`catBadge(cat)`** (e.g. "snippet") → **move to the detail view.** It's metadata, not list-differentiating. Remove it from `list-row` rendering in both `dashboard.js` and `library.js`.
- **`metaBadges(tags)`** (difficulty + foundation) → keep difficulty visible in the **Library** (it's genuinely useful there) but as a **quiet pill** (see §9.4), not a saturated fill. Use the warm neutral pill with a small colored dot for difficulty rather than a full-color background. `foundation` → a quiet pill, not the current `#7e7eff` fill.

**Net effect on a list row:** language dot + title (+ a due dot if due) (+ in Library, a quiet difficulty pill). That's it. The row becomes scannable.

### 9.4 Pills / tag chips

For tags and metadata that *should* be visible (e.g. difficulty in Library, tags in the detail view):

- Quiet pill: background `--surface-3` (Light) / `--surface-3` (Dark), text `--text-2`, radius `--r-pill`, 11px, padding `2px 9px`. Optional leading dot in a category color.
- The "fresh"-style status pill on the dashboard hero ("fresh") in the mockup uses an accent-soft tint (`--accent-soft` bg, `--accent`-family text) — reserve that *tinted* treatment for moments, not for every row.

### 9.5 Buttons (simplified semantic set)

Keep the existing semantic button architecture (it's good), but re-skin and prune:

- **Primary** (`--accent` fill, `--on-accent` text): the one CTA per context — New Shard, Start studying, Begin review.
- **Secondary / tool** (`--surface` fill, `--border` border, `--text` text; hover `--surface-2`/`--surface-3`): Export, Import, filters, most actions.
- **Danger** (`--danger` fill or `--danger`-text ghost): Delete.
- **Toggle "on"** (`--accent-soft` bg, accent text) for active toggles — re-map the current green `--success` toggle to the accent family so the palette stays unified (green has no other role in Hearth except sage-as-second-language; don't introduce a separate success-green button).
- Shape: `--r-md`, min-height 32–34px, 13–14px/500, `--shadow-sm` resting. Hover is a one-step surface/shade change, active `scale(0.98)`.
- The Study rating buttons are a special case — see §10.4.

### 9.6 Inputs / selects / search

- Background `--surface`, border `0.5px --border-strong`, radius `--r-sm`, padding `7–9px`, 14px.
- **Focus ring:** `outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft);` (replace the current blue `rgba(0,120,212,0.15)` ring).
- Search input: full-width, with a leading search icon.
- Native `option` background must be set to `--surface` and text `--text` (the app already does this; keep it, retargeted to tokens).

### 9.7 List rows

- Height ~**40px** (up from 36px — more air now that the row is quiet), padding `0 --space-2`, bottom border `0.5px --border`.
- Hover: `--surface-2` (Light) / `--surface-2` (Dark).
- **Current/active row** (study queue, selection): `--accent-soft` background.
- **Due indicator:** a small `--accent` dot (or warm-amber dot) + a `title`. Due is the *only* place a list row gets warm color, and it's a dot, not a fill or a loud row tint.
- Contents, left→right: selection checkbox (existing custom checkbox is good — keep it, retarget to tokens; checked state uses `--accent`), language dot, **title** (`flex: 1`, ellipsis), due dot (conditional), [Library only: quiet difficulty pill], a **Review** button (ghost/secondary, appears on hover or always-subtle).

### 9.8 Stat tiles

- `--surface`, border `0.5px --border`, radius `--r-lg`, padding `14–15px`.
- The **number** is the editorial serif (27px/500, `--text`); the **label** is sans 11px `--text-2` below it.
- Units (`%`, `d`) are a smaller, `--text-2` superscript-ish span next to the serif number.
- Grid of 4 with `--space-3` gaps. (Replace the current `.stat-num.due`/`.shaky` colored numbers with ink numerals — color is reserved; the *label* carries meaning, not an alarmed number color. The one exception: if "Due today" is **> 0**, the number may take `--accent` to draw the eye. Zero/low stays ink.)

### 9.9 Progress rings (SVG)

The signature Hearth data viz, used for **mastery** and **retention**.

- An SVG donut: a track circle (`--surface-3` stroke) + a value arc (`--accent` stroke, `stroke-linecap: round`, rotated `-90°` to start at 12 o'clock). Center label = the percentage in serif (`--text`) with a tiny sans caption below (`--text-3`/`--text-2`).
- Stroke width ~9–11px relative to radius ~30–34px. See the mockup's hero ring (33% mastery).

### 9.10 Bar / forecast charts

- Vertical bars in a row, `--surface-3` for the inert/zero bars, `--accent` for the meaningful bar (the spike / due day). Day labels in `--text-2`, 10–11px. Optional count above the spike.
- This replaces the current 4-level brightness `--due` ramp with a calmer two-tone (inert vs. accent). The forecast should read as "here's your upcoming load," **not** as a warning — so even a busy day (the Saturday-34 spike) is the *accent*, not an alarm yellow.
- For the Stats heatmap, see §10.5.

### 9.11 Hero / CTA banner

The dashboard's emotional anchor.

- **Light:** a warm `--surface` card with a leading mastery **ring**, a serif title ("Tend the fire"), a calm one-line body in `--text-2`, and a primary **Begin review** button. (The mockup shows exactly this. Note: the *glass* direction used a vibrant gradient banner here; **Hearth does not** — it's a calm warm card. Keep it flat.)
- **Dark:** same structure on `--surface`, with the ring and button in the brightened ember accent. You may give the hero a very subtle `--accent`-tinted border or a faint inner warmth in Dark to make it feel like the one "lit" element, but keep it restrained — no glow.

### 9.12 Modals & toasts

- **Modal:** `--surface`, radius `--r-xl`, `--shadow-lg`, hairline border. Backdrop `rgba(0,0,0,0.4)` (Light) and `rgba(0,0,0,0.55)` (Dark) with **no blur** (consistency + perf). Keep the existing modal sizing/scroll behavior; retarget colors to tokens.
- **Toast:** `--surface` with a colored left accent or a small leading icon (success → sage check; error → `--danger`). Retarget the current `--success`/`--danger` toast backgrounds; prefer a neutral surface with a colored icon over a fully saturated toast.
- **Empty states:** centered, `--text-2`, generous padding, a single line of warm copy (§12), optionally a tiny outline icon. (E.g. the due list's "Nothing due.")

### 9.13 Custom checkbox

The existing CSS-only checkbox (`.chk` with `::before`/`::after`) is good. Keep it; retarget: unchecked box `--surface`/`--border-strong`, checked `--accent` fill with white check, hover border `--accent`.

---

## 10. Per-view application guide

The mockup shows the Dashboard. Here's how the *same language* lands on every other screen. (View files: `views/dashboard.js`, `views/library.js`, `views/study.js`, `views/stats.js`, `views/tags.js`, `views/settings.js`.)

### 10.1 Dashboard (`dashboard.js`)

Matches the mockup. Specifics:

- Header: replace `<h2>Bonfire</h2>` with a **serif greeting** ("Good evening" / "Welcome back") plus a quiet one-line sub in `--text-2` summarizing state ("You have a quiet day — nothing due until Saturday."). Export/Import become icon buttons on the right.
- **Hero CTA** (§9.11) directly under the header: mastery ring + "Tend the fire" + Begin review. This gives the dashboard a clear primary action and an emotional hook.
- **Stat tiles** (§9.8): Total shards / Due today / Day streak / Reviews. Ink numerals; "Due today" may go accent only if > 0.
- **Languages** panel: dot + name + thin track bar + count (mockup). WebDev = accent, Shell = sage.
- **Next 7 days** forecast (§9.10): calm bars, the due day is the accent spike — not an alarm.
- **Recently added** list (§9.7): language dot + title + a quiet "fresh" pill *only if you choose to surface it* (the mockup shows it as a tinted accent-soft pill; acceptable here as a "moment," but do not replicate it on every Library row).

### 10.2 Library (`library.js`)

- Search input (full-width, leading icon) + a primary **+ New** button.
- **Filters row:** the five selects (language / category / familiarity / tag / sort) restyled per §9.6 — soft surfaces, accent focus ring. Consider letting them wrap gracefully; keep them quiet (they're tools, not focal points).
- **Bulk toolbar** (the sticky `.bulk-toolbar`): retarget to `--surface`/`--border`; the bulk action buttons use the secondary/danger styles (§9.5). Keep the sticky-top behavior; it's good.
- **Rows** (§9.7): this is where the badge cleanup matters most — the current Library row is the most crowded screen in the app (language fill + difficulty fill + foundation fill + snippet + fresh). New row = language **dot** + **title** + due dot (conditional) + a single **quiet difficulty pill** (§9.4) + Review button. Drop `snippet`, drop `fresh`, drop the saturated fills. The ragged right-edge chip stack disappears; the list becomes a clean column of titles.
- Keep all selection/Shift-click/dblclick-to-open logic exactly as-is.

### 10.3 Study config screen (`study.js`, the pre-session setup)

- The deck select, session-type select, max-cards input, Cram button, and difficulty checkboxes — restyle per §9.6/§9.13. Group them into proper **cards** (§9.2) with eyebrow section titles, and **tighten the vertical rhythm** (the current screen has orphaned, widely-spaced sections — wrap each logical group in a card and use the spacing scale). The "Drill weak spots" / "Build queue" buttons are secondary/primary respectively.
- The explanatory microcopy here is already good; keep it, set in `--text-2`.

### 10.4 Study session (`study.js`, the review loop) — THE flagship screen

This screen carries the product. It is also where the current build's worst visual bug lives (the empty editor void). Treat this view as a distinct **focus field** (see §11).

**Layout & field:**

- Center the review card vertically and horizontally in a calm field; constrain width (~720–760px). The current card floats high in a sea of empty space — ground it.
- **Quiet the chrome during a session.** The sidebar can dim (reduce contrast / lower opacity slightly) or the session can take a more focused full-bleed layout. The point: nothing competes with the card. (You already have `studyActive` state and `guardStudy()` nav-locking — lean on that to justify a quieted, committed session mode.)
- Progress ("1 of 37") and the queue count are present but understated, in `--text-2`.

**The card:**

- Surface `--surface`, radius `--r-xl`, `--shadow-lg`, generous padding (28px). Language **dot** + difficulty **pill** at the top (quiet), the **prompt/title** in serif, the **question** in `--text-2`.

**The editor (fix the void):**

- The black void is the un-mounted/un-themed CodeMirror (or its plain-textarea fallback). Ensure **CodeMirror mounts on render** over the answer field.
- Theme it with the Hearth code tokens (§6.3): `--code-bg` surface, themed gutter (line numbers in `--text-3`), `--text` cursor, `--accent-soft` selection.
- Add a **placeholder** so an empty editor reads as an editor, not a hole: e.g. *"Write your answer…"* (CodeMirror placeholder addon, or a faint overlay). Keep the existing **VIM mode** toggle (the user values it) — style the toggle as a quiet checkbox/segment.
- Min-height ~150–200px, full width, the warm code surface, hairline border, `--r-md`.

**Grading & feedback (the loop):**

- On submit, reveal the answer comparison instantly (the existing `.compare`/`.compare-col` two-column diff), then the **rating buttons**.
- **Rating buttons** are the one place a small spectrum of color is allowed, but warm it into the palette and keep it *calm*: Forgot / Hard / Good / Easy. Re-map the current `#ef4444 / #f59e0b / #3b82f6 / #10b981` to a warmer, less alarming set, e.g.: Forgot → `--danger` (warm brick, not fire-engine red), Hard → a muted ochre, Good → sage, Easy → a deeper sage/teal — or keep them near-neutral with only the keyboard-number chip colored. **Crucially, "Forgot" is not a shame state** — it's a neutral, expected grade. Don't paint it as failure. Keep the 1/2/3/4 keyboard hotkeys and their chips.
- After grading, the **next card appears with zero layout shift** and the editor is focused and empty, ready to type. This seamless advance *is* the flow loop — protect it (no modals, no toasts, no spinner between cards).

**Completion state (small, worth adding):**

- When the queue is cleared, show a calm completion card: a serif line, the count reviewed, and the ember line — *"Embers warm. You reviewed 34 shards today."* — with a quiet "Done" that returns to the dashboard. This is the emotional payoff that makes daily return feel good (§11). It's the one net-new bit of UX and it's inseparable from the redesign's intent.

### 10.5 Stats (`stats.js`)

The current Stats screen is already the most "designed" — keep its structure, re-skin it warm:

- **Streak/summary stat tiles** → §9.8 (serif numerals).
- **Activity heatmap** → recolor the 0–4 intensity ramp from the amber `--due` scale to a **warm accent ramp**: empty cells `--surface-3`, then four steps of increasing `--accent` saturation (in Dark, steps of the brightened ember). Keep the GitHub-style grid.
- **Retention decay curve** → this is the prettiest existing element. Recolor: area fill = a faint `--accent` tint (`rgba` of the accent at ~10%), line = `--accent`, grid = `--border`, axis labels = `--text-2`. (Currently blue; warm it.)
- **Card debt** → reframe warmly (§12): not a red overdue pile — *"A few shards have cooled. Review when you're ready — nothing's lost."* The "Study all" button is secondary, not alarming.
- **Deck mastery bar** → a slim track (`--surface-3`) with an `--accent` fill, or reuse the **ring** (§9.9) for consistency with the dashboard hero. Either is fine; the ring is more on-brand.
- **Areas you're lacking** → quiet list with sage/accent dots.

### 10.6 Tags (`tags.js`)

- Title in serif, the explanatory line in `--text-2`.
- Tag rows (§9.7): `#tagname` as the title, a quiet "special" pill for keyword tags (difficulty/foundation/reveal-only), a count in `--text-2`, and **Rename / merge** (secondary) + **Delete** (danger ghost) buttons.
- Replace the `prompt()`/`confirm()` calls' surrounding affordances cosmetically only; the logic stays.

### 10.7 Settings (`settings.js`)

- This is now also the home of the **Light/Dark toggle** (§6.2) — present it as a clean segmented control or two swatches at the top of an "Appearance" card.
- Restyle the existing sections (VIM toggle, Decks management, Spaced repetition algorithm + params, Card templates, Study session defaults) into consistent **cards** (§9.2) with eyebrow titles and the spacing scale. The dense explanatory copy is good — keep it in `--text-2`, and let the cards give it rhythm so it stops feeling like a wall.
- The "VIM mode in the answer editor" toggle and the algorithm/params controls keep their logic; just re-skin.

---

## 11. The flow state — the single most important concept

You asked what the most important concept around the flow state of the UI is. Here is the full answer; it should guide every judgment call on the Study session in particular.

### 11.1 The thesis

**The single most important concept is this: the study session is a "focus field," and the entire design exists to protect the recall loop.**

The core unit of value in a spaced-repetition app is one tiny loop, repeated:

> **recall → reveal → grade → next**

Everything Hearth does in a session is in service of making that loop *frictionless, rhythmic, and emotionally safe*. Browsing surfaces (dashboard, library, stats) can be rich, warm, even a little decorative — they're outside the field. But the moment a session starts, the app's job is to **get out of the way** so the loop can run without interruption. If you must optimize one thing, optimize the seamlessness of that loop and the calm of the field around it.

### 11.2 Why this is the thing that matters

The number-one reason people abandon spaced-repetition tools (the classic Anki failure mode) is not features — it's **the anxiety and guilt of an accumulating review pile**, combined with **friction every time you sit down**. The product doesn't fail because the algorithm is wrong; it fails because the daily experience is unpleasant enough that activation energy wins and people stop. Hearth's entire emotional design — the warmth, the forgiving framing, the ember metaphor, the "embers warm" payoff — is a direct answer to that failure mode. Flow, here, is a **retention mechanism for the human**, not just a nicety.

So the design has three jobs, in order:

1. **Lower the activation energy to start.** (The dashboard hero, the Ctrl+D daily quick-start, a calm "you have a quiet day" framing instead of a red 247-due alarm.)
2. **Maximize absorption while in the loop.** (The focus field below.)
3. **Make coming back feel good, not guilty.** (Forgiving framing of lapses; the completion payoff.)

### 11.3 Flow conditions, mapped to Hearth concretely

Csikszentmihalyi's flow has well-known preconditions. Here's how each becomes a specific UI decision in the Study session:

- **Clear goals.** The queue count and an understated progress ("1 of 37") are always visible, and "done" is concretely defined (queue cleared → embers warm). The user always knows how much remains and what finishing looks like.
- **Immediate feedback.** Submit reveals the answer instantly; grading (1–4) advances instantly; the schedule, streak, and retention update as a consequence. No latency, no spinner, no confirmation dialog between cards.
- **Challenge/skill balance.** The SR algorithm *is* the difficulty regulator — it surfaces cards at the edge of forgetting (desirable difficulty). The UI must not add artificial difficulty: no fiddly controls mid-session, no mode-switching, no hunting for buttons. Difficulty tags and weak-spot drilling let the user tune challenge *before* the session, not during.
- **Merging of action and awareness (concentration).** The focus field: during a session, the chrome recedes, one card is centered, nothing competes for attention, and the visual field is low-stimulation (warm, quiet, no saturated alarms). This is why Hearth quiets the sidebar and centers the card in a session.
- **Sense of control.** Keyboard-first throughout — type the answer, Enter to submit, 1–4 to grade, auto-advance; VIM mode for those who want it; Skip is always available; the nav-lock (`guardStudy`) prevents *accidental* exit but is deliberately escapable. Predictable and reversible.
- **Loss of self-consciousness.** No shame mechanics. "Forgot" is a neutral, expected grade — not painted as failure. Lapses are framed as embers cooling, gently relightable. The card-debt screen is reassuring, not accusatory.
- **Transformation of time.** A calm, rhythmic, low-stimulation loop makes sessions feel shorter; the "by time" session mode respects the user's intended time budget so they can enter the field knowing it has a humane end.
- **Autotelic reward.** The warmth, the serif, the satisfying micro-interactions, and the "embers warm" completion make the act of studying pleasant in itself — and the streak/ember is a *gentle pull*, never a Duolingo-style guilt trip.

### 11.4 The practical rules that fall out of this

- **Zero layout shift between cards.** The card frame, editor, and controls hold their position; only the content swaps. Jank breaks flow more than almost anything.
- **No interruptions inside the loop.** No modals, no toasts, no update badges, no notifications during a session.
- **Keyboard never leaves home row.** The full loop is operable without the mouse.
- **Calm color in the field.** Save warm-alarm intensity for outside the field; inside, even grades are warmed and gentle.
- **A clear, kind beginning and end.** The daily CTA pulls you in; the completion state sends you off feeling good. That arc — *invitation → absorption → warm payoff* — is what makes the habit stick.

---

## 12. Microcopy & voice

You liked "A short session keeps the embers warm." That sentence is the voice. Codify it.

### 12.1 Principles

- **Warm, plain, lightly literary.** Plain language first; reach for a fire metaphor only at *moments* (roughly one per screen, max), so it stays special and never becomes cute.
- **Second person, present tense.** "You have a quiet day." "Keep it lit."
- **Never shaming, never alarmist.** Lapses and debt are normal and recoverable. No red urgency, no guilt, no "you're falling behind."
- **Encouraging, not gamified.** The streak and embers are gentle pulls, not pressure.

### 12.2 Do / don't

| Don't | Do |
|---|---|
| "247 cards overdue!" (alarm) | "A few shards have cooled — review when you're ready." |
| "You broke your streak." | "Relight your streak with a short session." |
| "Failed" / "Wrong" | "Forgot" (neutral grade) |
| Metaphor on every label | Metaphor at one moment per screen |
| "Loading…" mid-session | (nothing — advance instantly) |

### 12.3 Examples by surface

- **Dashboard sub-greeting (quiet day):** "You have a quiet day — nothing due until Saturday."
- **Dashboard hero:** title "Tend the fire" · body "Your deck is 33% mastered. A short session keeps the embers warm and your 1-day streak alive." · button "Begin review."
- **Streak chip:** "1-day streak · keep it lit."
- **Due list empty:** "Nothing due. The fire's banked — rest easy." (or plainly "All caught up.")
- **Library empty:** "No shards yet. Press Ctrl+N to add your first."
- **Card debt:** "A few shards have cooled. Review when you're ready — nothing's lost."
- **Session complete:** "Embers warm. You reviewed 34 shards today."
- **Toasts:** "Shard saved." · "Imported 12 shards." (plain; the warmth lives in the bigger moments.)

Keep all *functional* copy (errors, confirmations, settings help) plain and clear — the metaphor is for the emotional beats, not the plumbing.

---

## 13. Accessibility

Both themes must pass WCAG AA. The palettes in §5 were chosen with this in mind; verify after implementation.

- **Contrast targets:** normal text ≥ 4.5:1; large/UI text and non-text indicators ≥ 3:1.
  - Primary text on surfaces: very high in both modes (`#2C2620` on `#FFFDF8` ≈ 13:1; `#ECE7E0` on `#232020` ≈ 11:1). ✔
  - **Secondary text** uses `--text-2` (`#6B6051` light ≈ 5.2:1; `#A89E92` dark ≈ 6:1). ✔ **`--text-3` is decorative only** — never use it for text a user must read.
  - **Accent button labels:** Light uses white on `--accent` (≈ 4.5:1 — acceptable for 14px/500; if any accent-on-white text is < 14px, use `--accent-hover`/`#B54F30`). **Dark uses dark ink (`--on-accent #1E120C`) on the brighter ember (≈ 5.7:1)** — do **not** use white on the ember in Dark (it fails).
  - **Sage** is a *fill/dot/bar* color, not a text color (sage-as-text on cream fails AA). If sage text is ever needed, darken it.
- **Color is never the sole signal:** due = dot **+** `title`/label; grades = label **+** fixed position **+** keyboard number, not color alone; language = dot **+** name available as text/tooltip.
- **Focus visibility:** every interactive element (nav, list rows, buttons, inputs, rating buttons, the deck switch) has a visible focus ring — `box-shadow: 0 0 0 3px var(--accent-soft)` plus an `--accent` border/outline. Keyboard users must be able to traverse and operate everything.
- **Reduced motion:** wrap all transitions/transforms/animations in `@media (prefers-reduced-motion: no-preference)`, or add a `@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; } }` reset. Specifically kill the existing **update-badge pulse** under reduced motion.
- **Hit targets:** controls ≥ ~32px in the smaller dimension; list-row Review buttons and checkboxes comfortably clickable.
- **Font sizes:** body 14px, nothing essential below 12px.
- **Theme default** honors `prefers-color-scheme` on first run, then the user's explicit choice.

---

## 14. Implementation plan (phased, ordered by risk)

Work on a branch. Snapshot the current state (screenshots of all views, both as a before-reference). The ordering is deliberate: the lowest-risk, highest-visual-delta change comes first, because **the stylesheet is already 100% token-driven**, so swapping the token layer transforms the whole app instantly with almost no risk.

**Phase 0 — Setup.** Branch. Capture before-screenshots of every view. Confirm the app builds and runs.

**Phase 1 — Token layer (biggest delta, lowest risk).** Rewrite `:root` to the **Light** tokens (§5.1) and add the **Dark** override (§5.2). Because components already consume `var(--…)`, the entire app re-skins immediately. Don't touch components yet — just verify everything still works and now looks warm. (Expect ~60% of the visual transformation from this phase alone.)

**Phase 2 — Typography & brand.** Vendor the serif `woff2` (§7.1), wire `--font-serif`, apply it to headings, the wordmark, and the big stat numerals. Bump base body to 14px and apply the type scale (§7.2). Rename the wordmark to "Hearth" + flame mark.

**Phase 3 — Theme collapse.** Delete the nine `body.theme-*` blocks (§6.2). Rewire `theme.js` to `light`/`dark` and the `data-theme` attribute; default to `prefers-color-scheme`. Replace the 9-theme selector in `settings.js` with the Light/Dark toggle. Collapse the syntax-highlighting blocks to the two token sets (§6.3) for both highlight.js and CodeMirror.

**Phase 4 — Component polish (the badge fix lives here).** In `dom.js`, transform `langBadge`/`famBadge`/`catBadge`/`metaBadges` per §9.3 (dots + demotion). In `dashboard.js` and `library.js`, remove `snippet`/`fresh` from row rendering. Re-skin buttons (§9.5), inputs/focus rings (§9.6), list rows to ~40px (§9.7), stat tiles (§9.8), radius/shadows. Retarget the custom checkbox.

**Phase 5 — Iconography.** Vendor the icon set (§8). Add icons to nav, buttons, and the few affordances shown in the mockup.

**Phase 6 — Per-view passes.** Apply §10 to Dashboard (hero + ring + calm forecast), Stats (warm heatmap + warm retention curve + ring), Library (quiet rows + filters), Study config, Tags, Settings.

**Phase 7 — Study session (flagship).** Center the card; build the focus field (quiet the chrome); **fix the CodeMirror mount + Hearth theme + placeholder + gutter**; warm the rating buttons; guarantee zero-layout-shift advance; add the "embers warm" completion state (§10.4, §11).

**Phase 8 — Rename (do anytime, but verify).** Change `productName`/window `title`/display strings to Hearth; **leave the bundle `identifier` unchanged**; launch and **confirm the existing vault loads** (§3.1).

**Phase 9 — Accessibility pass.** Audit contrast in both modes; add focus rings everywhere; add the reduced-motion guard; verify color is never the sole signal (§13).

**Phase 10 — QA.** Walk the acceptance checklist (§16) in both themes.

> Phases 1–3 are the spine and are nearly risk-free. Phases 4 and 7 carry the most hand-work. Rename (8) is independent and can slot in whenever, but always with the data-dir verification.

---

## 15. What stays exactly the same

To be unambiguous — this redesign does **not** touch:

- The **Rust backend** and every Tauri command (`list_shards`, `save_shard`, `submit_review`, decks, tags, settings, import/export, debt sync, etc.).
- The **SQLite schema** and the **`shard` data model**.
- The **spaced-repetition algorithms** (SM-2 / FSRS), their params, and the review log.
- The **JS view logic and state** in `main.js` and the view modules — selection, Shift-click ranges, bulk actions, the deck switcher, the study-session nav-lock, keyboard shortcuts (Ctrl+P/N/K/D), quick-capture, command palette, confirm dialogs.
- The **vendoring approach** (CodeMirror, highlight.js loaded as globals via `<script>` in `index.html`) — Hearth adds a vendored serif and an icon set the same way.
- The **import/export JSON format** (old `bonfire-export.json` files still import).

**This is a reskin + a theme-system collapse + a cosmetic rename.** The reason it's tractable in a single focused effort is that the existing CSS is already fully variable-driven and the existing JS cleanly separates rendering from data. Respect that separation: prefer changing CSS tokens, component CSS, markup classes, and a handful of template strings over touching application logic.

---

## 16. Acceptance checklist

The redesign is done when all of these are true, verified in **both** Light and Dark:

- [ ] App launches as "Hearth" (window title, wordmark, title bar); the user's existing shards/decks/settings still load (identifier unchanged).
- [ ] Exactly two themes exist (Light, Dark); the nine old themes are gone; the toggle lives in Settings and defaults to the OS preference on first run.
- [ ] Light theme matches the accompanying dashboard mockup (cream surfaces, terracotta accent, serif headings, quiet rows).
- [ ] Dark theme is warm coal/ash with a brightened ember accent; **dark ink on accent fills**, not white; no element inverts incorrectly.
- [ ] No list row shows more than: language **dot** + title (+ due dot) (+ in Library, one quiet difficulty pill). `snippet`/`fresh` no longer appear on rows; no saturated full-fill language/familiarity badges anywhere.
- [ ] Headings, the wordmark, and the large stat numerals use the vendored serif; body is 14px sans; weights are restrained (no 700/black).
- [ ] The forecast/heatmap read as calm "upcoming load," not as alarms; warm-alarm intensity appears only for genuine due/debt, and even then gently.
- [ ] Cards are opaque warm surfaces with a soft shadow + hairline border; no `backdrop-filter`/glass and no page gradient remain.
- [ ] The Study editor is a properly mounted, Hearth-themed CodeMirror with a gutter and a placeholder — no empty black void; VIM toggle still works.
- [ ] The Study session is a centered focus field with quieted chrome, keyboard-operable end-to-end (type → Enter → 1–4 → instant advance), zero layout shift between cards, and a warm "embers warm" completion state.
- [ ] Grades are warmed and "Forgot" is not styled as a failure/shame state.
- [ ] Microcopy follows the voice guide (warm, plain-first, metaphor at moments, never shaming).
- [ ] Both themes pass WCAG AA for text (using `--text`/`--text-2`; `--text-3` only decorative); visible focus rings everywhere; reduced-motion respected; color never the sole signal.
- [ ] All existing functionality (decks, tags, bulk actions, shortcuts, import/export, SR scheduling) works unchanged.

---

*End of specification. The accompanying Light-mode dashboard mockup is the canonical visual reference; this document governs the Dark theme, the tokens, the methodology, and every screen the mockup doesn't show.*
