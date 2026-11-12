import type { Warning } from "../../src/core/types";

/** What a warning lets you do about it (the same buttons the warning list above the batch offers). */
export type WarningAction = "remove-background" | "open-brand" | "open-designer" | "edit-sign";

export const ACTION_LABEL: Record<WarningAction, string> = {
  "remove-background": "Remove background",
  "open-brand": "Open brand",
  "open-designer": "See it in the designer",
  "edit-sign": "Edit sign",
};

/**
 * The actions for one warning, by the same rules as the warning list above the batch (BatchPanel):
 * Remove background for a logo on a box, Open brand for a missing or low-resolution logo of a brand
 * that still exists, See it in the designer for text too big for its box, Edit sign for text below
 * the minimum, a "was" price that isn't higher, or a template of the other kind.
 */
export function warningActions(w: Warning, brandExists: boolean): WarningAction[] {
  const out: WarningAction[] = [];
  if (w.code === "logo-background") out.push("remove-background");
  if ((w.code === "low-res-logo" || w.code === "no-logo") && brandExists) out.push("open-brand");
  if (w.code === "small-text" && /too big for its box/.test(w.message)) out.push("open-designer");
  if (w.code === "small-text" || w.code === "was-price" || w.code === "kind-mismatch") out.push("edit-sign");
  return out;
}

export interface RowWarning { message: string; brandId: string; actions: WarningAction[] }

/**
 * The warnings each batch row shows behind its red triangle: row index -> its warnings, in the
 * order the checks gave them. Only real warnings (level "warn"); notes ("info") get no triangle.
 */
export function warningsByRow(warnings: Warning[], brandIds: Iterable<string>): Map<number, RowWarning[]> {
  const known = new Set(brandIds);
  const rows = new Map<number, RowWarning[]>();
  for (const w of warnings) {
    if (w.level !== "warn") continue;
    const item: RowWarning = { message: w.message, brandId: w.brandId, actions: warningActions(w, known.has(w.brandId)) };
    for (const i of w.items) rows.set(i, [...(rows.get(i) ?? []), item]);
  }
  return rows;
}
