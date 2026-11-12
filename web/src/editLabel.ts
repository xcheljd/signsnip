import type { Sign } from "../../src/core/types";

/**
 * Names the batch row the sign form is editing, e.g. "Editing row 3 · Kestrel & Vale Falcon".
 * Shown as the sign card's title and in the sticky print bar next to Update sign / Cancel.
 * It names the row as it is saved in the batch (not the unsaved form), so it keeps pointing at
 * the same row while you change its brand or collection. A brand that was deleted shows its id,
 * like the batch table does. Null when no row is being edited.
 */
export function editLabel(items: Sign[], editingId: string | null, brands: { id: string; name: string }[]): string | null {
  if (!editingId) return null;
  const i = items.findIndex((s) => s.id === editingId);
  const row = items[i];
  if (!row) return null;
  const brand = brands.find((b) => b.id === row.brandId)?.name ?? row.brandId;
  const what = [brand, row.collection].map((t) => t.trim().replace(/\s+/g, " ")).filter(Boolean).join(" ");
  return what ? `Editing row ${i + 1} · ${what}` : `Editing row ${i + 1}`;
}
