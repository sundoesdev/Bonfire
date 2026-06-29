// Shared import/export helpers (used by Dashboard and Settings).

export async function exportVault(ctx) {
  const path = await ctx.api.saveDialog("hearth-export.json");
  if (!path) return;
  await ctx.api.exportToJson(path);
  ctx.toast("Vault exported");
}

export async function importVault(ctx) {
  const path = await ctx.api.openDialog();
  if (!path) return 0;
  const n = await ctx.api.importFromJson(path);
  ctx.toast(`Imported ${n} card${n === 1 ? "" : "s"}`);
  return n;
}
