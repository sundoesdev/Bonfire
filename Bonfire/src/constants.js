// Static UI metadata — mirrors the language/category/familiarity sets and the
// color palette from the original Qt app (shard.h).

export const DEFAULT_LANGUAGES = [
  "C", "C++", "C#", "Lua", "Python", "Bash", "Rust", "JavaScript", "TypeScript",
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
  "JavaScript": "#f1e05a", "TypeScript": "#3178c6", "Git": "#F05032",
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
  "TypeScript": "typescript", "Git": "bash", "Docker": "dockerfile",
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

// ---- Subject presets ----
// A deck's `preset` drives how the editor/capture forms and study/view panes
// behave, so Bonfire stays developer-first but can also hold non-code decks
// (world history, vocab, etc.). `code` is the default; existing cards live in
// the default "Code" deck. `showLanguage`/`highlight` gate the code-only bits;
// `answerLabel`/`answerPlaceholder` relabel the answer field.
export const DEFAULT_DECK_ID = "default";
export const DEFAULT_PRESET = "code";

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
