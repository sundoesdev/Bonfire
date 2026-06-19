// Static UI metadata — mirrors the language/category/familiarity sets and the
// color palette from the original Qt app (shard.h).

export const DEFAULT_LANGUAGES = [
  "C", "C++", "C#", "Lua", "Python", "Bash", "Rust", "JavaScript", "TypeScript",
  "WebDev (HTML/CSS/JS)",
  "Git", "Docker", "SQL", "Go", "Ruby", "Java", "CSS", "HTML", "PHP", "Kotlin",
  "Swift", "Zig", "Haskell", "Perl", "R", "Scala", "Shell", "PowerShell",
  "YAML", "JSON", "TOML", "Makefile", "Assembly", "Vim", "Nix", "KQL",
];

export const CATEGORIES = [
  "snippet", "pattern", "boilerplate", "one-liner", "troubleshoot",
  "concept", "config", "cheatsheet",
];

export const FAMILIARITIES = ["fresh", "shaky", "solid", "mastered"];

// Order used for the "Familiarity (shaky first)" sort.
export const FAMILIARITY_ORDER = ["shaky", "fresh", "solid", "mastered"];

const LANG_COLORS = {
  "C": "#555555", "C++": "#f34b7d", "C#": "#178600", "Lua": "#000080",
  "Python": "#3572A5", "Bash": "#89e051", "Rust": "#dea584",
  "JavaScript": "#f1e05a", "TypeScript": "#3178c6", "WebDev (HTML/CSS/JS)": "#e34c26", "Git": "#F05032",
  "Docker": "#384d54", "SQL": "#e38c00", "Go": "#00ADD8", "Ruby": "#701516",
  "Java": "#b07219", "CSS": "#563d7c", "HTML": "#e34c26", "PHP": "#4F5D95",
  "Kotlin": "#A97BFF", "Swift": "#F05138", "Zig": "#ec915c", "Haskell": "#5e5086",
  "Perl": "#0298c3", "R": "#198CE7", "Scala": "#c22d40", "Shell": "#89e051",
  "PowerShell": "#012456", "YAML": "#cb171e", "JSON": "#555555", "TOML": "#9c4221",
  "Makefile": "#427819", "Assembly": "#6E4C13", "Vim": "#199f4b", "Nix": "#7e7eff",
  "KQL": "#0078D4",
};

const FAM_COLORS = {
  fresh: "#f59e0b",
  shaky: "#ef4444",
  solid: "#3b82f6",
  mastered: "#10b981",
};

export function langColor(lang) {
  return LANG_COLORS[lang] || "#555555";
}

export function famColor(fam) {
  return FAM_COLORS[fam] || "#666666";
}

// Maps our language display names to highlight.js language ids.
const HLJS_LANG = {
  "C": "c", "C++": "cpp", "C#": "csharp", "Lua": "lua", "Python": "python",
  "Bash": "bash", "Rust": "rust", "JavaScript": "javascript",
  "TypeScript": "typescript", "WebDev (HTML/CSS/JS)": "xml", "Git": "bash", "Docker": "dockerfile",
  "SQL": "sql", "Go": "go", "Ruby": "ruby", "Java": "java", "CSS": "css",
  "HTML": "xml", "PHP": "php", "Kotlin": "kotlin", "Swift": "swift",
  "Haskell": "haskell", "Perl": "perl", "R": "r", "Scala": "scala",
  "Shell": "bash", "PowerShell": "powershell", "YAML": "yaml", "JSON": "json",
  "TOML": "ini", "Makefile": "makefile", "Assembly": "x86asm", "Vim": "vim",
  "Nix": "nix", "Zig": "zig",
};

export function hljsLang(lang) {
  return HLJS_LANG[lang] || null;
}

// Maps our display language names to CodeMirror 5 mode strings / MIME types
// (the vendored modes in index.html). null → plain text (still a usable editor).
const CM_MODE = {
  "C": "text/x-csrc",
  "C++": "text/x-c++src",
  "C#": "text/x-csharp",
  "Java": "text/x-java",
  "Kotlin": "text/x-kotlin",
  "Scala": "text/x-scala",
  "Swift": "swift",
  "JavaScript": "javascript",
  "TypeScript": "application/typescript",
  "JSON": "application/json",
  "WebDev (HTML/CSS/JS)": "htmlmixed",
  "HTML": "htmlmixed",
  "CSS": "css",
  "Python": "python",
  "Bash": "shell",
  "Shell": "shell",
  "Git": "shell",
  "PowerShell": "powershell",
  "Rust": "rust",
  "Go": "go",
  "Ruby": "ruby",
  "PHP": "php",
  "SQL": "sql",
  "Docker": "dockerfile",
  "Lua": "lua",
  "Perl": "perl",
  "Haskell": "haskell",
  "R": "r",
  "YAML": "yaml",
  "TOML": "toml",
};

export function cmMode(lang) {
  return CM_MODE[lang] || null;
}

// ---- Subject presets ----
// A deck's `preset` drives how the editor/capture forms and study/view panes
// behave, so Bonfire stays developer-first but can also hold non-code decks
// (world history, vocab, etc.). `code` is the default; existing cards live in
// the default "Code" deck. `showLanguage`/`highlight` gate the code-only bits;
// `answerLabel`/`answerPlaceholder` relabel the answer field.
export const DEFAULT_DECK_ID = "default";
// The always-present, non-deletable auto "Debt" deck (overdue cards). Kept in
// sync by the backend; mirror of db.rs DEBT_DECK_ID.
export const DEBT_DECK_ID = "card-debt";
// Sentinel "deck" meaning every card regardless of membership — the library of all
// cards (decks are wrappers, so a card lives here whether it's in 0 or many decks).
export const ALL_DECKS = "__all__";
export const DEFAULT_PRESET = "code";

// "Native" decks ship with Bonfire and are required for its functionality — they
// can't be deleted or renamed (item 2, notes-03). Settings can grey them out and
// optionally hide them from the deck-management list.
export const NATIVE_DECK_IDS = new Set([DEFAULT_DECK_ID, DEBT_DECK_ID]);

export function isNativeDeck(id) {
  return NATIVE_DECK_IDS.has(id);
}

export const SUBJECT_PRESETS = {
  code: {
    label: "Code",
    showLanguage: true,
    highlight: true,
    answerLabel: "Answer (code)",
    answerPlaceholder: "Paste the answer code here...",
  },
  prose: {
    label: "General / Notes",
    showLanguage: false,
    highlight: false,
    answerLabel: "Answer",
    answerPlaceholder: "The answer...",
  },
  vocab: {
    label: "Language / Vocab",
    showLanguage: false,
    highlight: false,
    answerLabel: "Answer / Translation",
    answerPlaceholder: "The translation or answer...",
  },
};

// List form for building <select>s of presets.
export const PRESET_OPTIONS = Object.entries(SUBJECT_PRESETS).map(([id, p]) => ({
  id,
  label: p.label,
}));

// Resolve a preset key to its config (falls back to the code preset).
export function presetConfig(preset) {
  return SUBJECT_PRESETS[preset] || SUBJECT_PRESETS[DEFAULT_PRESET];
}

// ---- Card types ----
// How a card is tested in a study session. `basic` is the default active-recall
// flow; `cloze` blanks out {{c1::..}} spans in the answer; `reverse` shows the
// answer and asks you to recall the title (great for vocab decks).
export const CARD_TYPES = [
  { id: "basic", label: "Basic — type the answer" },
  { id: "cloze", label: "Cloze — fill in {{c1::blanks}}" },
  { id: "reverse", label: "Reverse — answer shown, recall the title" },
];

export function cardTypeOptions(current) {
  return CARD_TYPES.map(
    (t) => `<option value="${t.id}" ${t.id === current ? "selected" : ""}>${t.label}</option>`
  ).join("");
}

// ---- Special "keyword" tags ----
// These are ordinary tags, but Bonfire treats them specially: they organize
// cards by difficulty/foundation and control how a card behaves in study.
// See SPECIAL_TAGS.md.
export const DIFFICULTIES = ["beginner", "intermediate", "advanced", "expert", "master"];
export const FOUNDATION_TAG = "foundation";
export const REVEAL_ONLY_TAG = "reveal-only";

// All reserved tags, for UI that wants to distinguish them from free-form tags.
export const SPECIAL_TAGS = new Set([...DIFFICULTIES, FOUNDATION_TAG, REVEAL_ONLY_TAG]);

const DIFFICULTY_COLORS = {
  beginner: "#10b981",
  intermediate: "#3b82f6",
  advanced: "#f59e0b",
  expert: "#ef4444",
  master: "#a855f7",
};

export function difficultyColor(d) {
  return DIFFICULTY_COLORS[d] || "#555555";
}

// The card's difficulty = the first difficulty keyword present in its tags ("" if none).
export function getDifficulty(tags) {
  return (tags || []).find((t) => DIFFICULTIES.includes(t)) || "";
}

export function isFoundation(tags) {
  return (tags || []).includes(FOUNDATION_TAG);
}

export function isRevealOnly(tags) {
  return (tags || []).includes(REVEAL_ONLY_TAG);
}

// Return a new tag array with all difficulty keywords removed, then `level` added
// (pass "" to clear difficulty entirely).
export function setDifficulty(tags, level) {
  const out = (tags || []).filter((t) => !DIFFICULTIES.includes(t));
  if (level) out.push(level);
  return out;
}

// Return a new tag array with `tag` present (on=true) or absent (on=false).
export function toggleTag(tags, tag, on) {
  const out = (tags || []).filter((t) => t !== tag);
  if (on) out.push(tag);
  return out;
}

// ---- Spaced-repetition algorithm ----
// The active scheduler is a global setting (key `sr_algorithm`); SM-2 and FSRS
// each have a JSON params blob (`sm2_params` / `fsrs_params`). The defaults here
// mirror the Rust-side defaults (sm2.rs Sm2Config / fsrs.rs FsrsConfig).
export const SR_ALGORITHMS = [
  { id: "sm2", label: "SM-2 — classic SuperMemo (default)" },
  { id: "fsrs", label: "FSRS — Free Spaced Repetition Scheduler" },
];
export const DEFAULT_ALGORITHM = "sm2";

export const SM2_DEFAULTS = {
  easeFloor: 1.3,
  intervalModifier: 1.0,
  hardMultiplier: 1.2,
};

// FSRS-4.5 published default weights (17). Kept in sync with fsrs.rs.
export const FSRS_DEFAULT_WEIGHTS = [
  0.4072, 1.1829, 3.1262, 15.4722, 7.2102, 0.5316, 1.0651, 0.0234, 1.616, 0.1544,
  1.0824, 1.9813, 0.0953, 0.2975, 2.2042, 0.2407, 2.9466,
];

export const FSRS_DEFAULTS = {
  requestRetention: 0.9,
  weights: FSRS_DEFAULT_WEIGHTS,
};

// ---- Media attachments ----
// Cards can carry inline image/audio attachments (base64 data-URLs) on either
// the question or the answer side, orthogonal to card_type. See models.rs MediaItem.
export const MEDIA_KINDS = { image: "Image", audio: "Audio" };
export const MEDIA_SIDES = [
  { id: "question", label: "Question side" },
  { id: "answer", label: "Answer side" },
];

// ---- Card templates ----
// Reusable starting points for fast authoring. Stored (with any user-defined
// ones) in the `card_templates` setting; these are the built-in seeds. A template
// prefills the editor/quick-capture fields. `tags` is a comma-separated string.
export const BUILTIN_TEMPLATES = [
  {
    id: "builtin-code-qa",
    name: "Question → Answer",
    cardType: "basic",
    language: "",
    tags: "",
    prompt: "What does this do / how do you …?",
    code: "",
    description: "",
  },
  {
    id: "builtin-vocab",
    name: "Vocab term",
    cardType: "reverse",
    language: "",
    tags: "vocab",
    prompt: "Define / translate the term.",
    code: "",
    description: "",
  },
  {
    id: "builtin-cloze",
    name: "Cloze note",
    cardType: "cloze",
    language: "",
    tags: "",
    prompt: "Fill in the blanks.",
    code: "The {{c1::capital}} of France is {{c2::Paris}}.",
    description: "",
  },
];
