// Shared import/export helpers (used by Dashboard and Settings).

export async function exportVault(ctx) {
  const path = await ctx.api.saveDialog("bonfire-export.json");
  if (!path) return;
  await ctx.api.exportToJson(path);
  alert("Exported to " + path);
}

export async function importVault(ctx) {
  const path = await ctx.api.openDialog();
  if (!path) return 0;
  const n = await ctx.api.importFromJson(path);
  alert(`Imported ${n} shard(s).`);
  return n;
}
