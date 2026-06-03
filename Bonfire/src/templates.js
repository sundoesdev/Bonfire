// Card templates: reusable field presets for fast authoring. The built-in seeds
// live in constants.js; user-defined ones persist in the `card_templates` setting.
import { BUILTIN_TEMPLATES } from "./constants.js";

const KEY = "card_templates";

function isBuiltin(t) {
  return String(t.id || "").startsWith("builtin-");
}

// All templates (built-ins first, then any saved custom ones).
export async function loadTemplates(ctx) {
  let custom = [];
  try {
    const raw = await ctx.api.getSetting(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) custom = parsed;
    }
  } catch (_e) {
    /* ignore — fall back to built-ins only */
  }
  return [...BUILTIN_TEMPLATES, ...custom];
}

// Persist only the custom (non-built-in) templates.
export async function saveTemplates(ctx, templates) {
  const custom = (templates || []).filter((t) => !isBuiltin(t));
  await ctx.api.setSetting(KEY, JSON.stringify(custom));
}

export { isBuiltin };
