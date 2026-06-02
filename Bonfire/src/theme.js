// Appearance: theme, UI font, and UI scale. Values persist in the settings table
// (keys ui_theme / ui_font / ui_scale) and are applied via a body class (theme),
// a CSS variable (font), and CSS zoom (scale).
import * as api from "./api.js";

export const THEMES = [
  { id: "dark", label: "Dark" },
  { id: "light", label: "Light" },
  { id: "solarized", label: "Solarized Dark" },
  { id: "elflord", label: "Elflord" },
  { id: "habamax", label: "Habamax" },
  { id: "slate", label: "Slate" },
  { id: "desert", label: "Desert" },
  { id: "industry", label: "Industry" },
  { id: "delek", label: "Delek" },
];

export const FONTS = [
  { id: "inter", label: "Inter / System (default)", stack: '"Inter","Segoe UI","Helvetica Neue",sans-serif' },
  { id: "system", label: "System UI", stack: "system-ui, sans-serif" },
  { id: "serif", label: "Serif", stack: 'Georgia,"Times New Roman",serif' },
  { id: "mono", label: "Monospace", stack: "ui-monospace, Menlo, Consolas, monospace" },
];

export const SCALES = [
  { id: "0.9", label: "90%" },
  { id: "1", label: "100%" },
  { id: "1.1", label: "110%" },
  { id: "1.25", label: "125%" },
  { id: "1.5", label: "150%" },
];

const fontStack = (id) => (FONTS.find((f) => f.id === id) || FONTS[0]).stack;

export const appearance = { theme: "dark", font: "inter", scale: "1" };

export function applyTheme(id) {
  const valid = THEMES.some((t) => t.id === id) ? id : "dark";
  document.body.classList.remove(...THEMES.map((t) => "theme-" + t.id));
  document.body.classList.add("theme-" + valid);
}

export function applyFont(id) {
  document.documentElement.style.setProperty("--ui-font", fontStack(id));
}

export function applyScale(v) {
  document.body.style.zoom = String(parseFloat(v) || 1);
}

// Load saved appearance from the backend and apply it (called once at startup).
export async function loadAppearance() {
  try {
    const [t, f, s] = await Promise.all([
      api.getSetting("ui_theme"),
      api.getSetting("ui_font"),
      api.getSetting("ui_scale"),
    ]);
    if (t) appearance.theme = t;
    if (f) appearance.font = f;
    if (s) appearance.scale = s;
  } catch (_e) {
    /* fall back to defaults */
  }
  applyTheme(appearance.theme);
  applyFont(appearance.font);
  applyScale(appearance.scale);
}

// Update one appearance value: apply immediately and persist.
export async function setAppearance(key, value) {
  appearance[key] = value;
  if (key === "theme") applyTheme(value);
  if (key === "font") applyFont(value);
  if (key === "scale") applyScale(value);
  try {
    await api.setSetting("ui_" + key, value);
  } catch (_e) {
    /* ignore persistence errors */
  }
}
