import { describe, expect, it } from "vitest";
import type { Warning } from "../src/core/types";
import { ACTION_LABEL, warningActions, warningsByRow } from "../web/src/rowWarnings";

const w = (code: Warning["code"], items: number[], message = `${code} message`, level: Warning["level"] = "warn", brandId = "northwind"): Warning =>
  ({ code, items, message, level, brandId });

describe("warningActions (same buttons as the warning list above the batch)", () => {
  it("offers Remove background for a logo on a box", () => {
    expect(warningActions(w("logo-background", [0]), true)).toEqual(["remove-background"]);
  });

  it("offers Open brand for a missing or low-resolution logo, only when the brand still exists", () => {
    expect(warningActions(w("low-res-logo", [0]), true)).toEqual(["open-brand"]);
    expect(warningActions(w("no-logo", [0]), true)).toEqual(["open-brand"]);
    expect(warningActions(w("no-logo", [0]), false)).toEqual([]);
  });

  it("offers the designer for text too big for its box, plus Edit sign", () => {
    expect(warningActions(w("small-text", [2], "Row 3: the collection is too big for its box"), true)).toEqual(["open-designer", "edit-sign"]);
    expect(warningActions(w("small-text", [2], "Row 3: the collection is below your 10pt readable minimum"), true)).toEqual(["edit-sign"]);
  });

  it("offers Edit sign for a was-price that isn't higher and a template of the other kind", () => {
    expect(warningActions(w("was-price", [3]), true)).toEqual(["edit-sign"]);
    expect(warningActions(w("kind-mismatch", [3]), true)).toEqual(["edit-sign"]);
  });

  it("labels each action with the wording the warning list uses", () => {
    expect(ACTION_LABEL).toEqual({
      "remove-background": "Remove background", "open-brand": "Open brand", "open-designer": "See it in the designer", "edit-sign": "Edit sign",
    });
  });
});

describe("warningsByRow (what a row's red triangle shows)", () => {
  it("gives each row every warning that names it, in order", () => {
    const rows = warningsByRow([
      w("low-res-logo", [0, 2], "Northwind's logo is low resolution"),
      w("was-price", [2], "Row 3: the “was” price isn't higher"),
    ], ["northwind"]);
    expect([...rows.keys()].sort()).toEqual([0, 2]);
    expect(rows.get(0)!.map((x) => x.message)).toEqual(["Northwind's logo is low resolution"]);
    expect(rows.get(2)!.map((x) => x.message)).toEqual(["Northwind's logo is low resolution", "Row 3: the “was” price isn't higher"]);
    expect(rows.get(2)!.map((x) => x.actions)).toEqual([["open-brand"], ["edit-sign"]]);
    expect(rows.has(1)).toBe(false);
  });

  it("leaves out notes (info), which get no triangle", () => {
    const rows = warningsByRow([w("logo-background", [1], "white background", "info"), w("auto-abbrev", [1], "shortened", "info")], ["northwind"]);
    expect(rows.size).toBe(0);
  });

  it("drops Open brand for a deleted brand and keeps its id for the action", () => {
    const rows = warningsByRow([w("no-logo", [4], "Row 5 uses a brand that was deleted", "warn", "retired-brand")], ["northwind"]);
    expect(rows.get(4)).toEqual([{ message: "Row 5 uses a brand that was deleted", brandId: "retired-brand", actions: [] }]);
  });
});
