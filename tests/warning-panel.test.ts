import { describe, expect, it } from "vitest";
import type { Warning } from "../src/core/types";
import { GROUP_TITLE, PANEL_LIMIT, groupOf, lineCount, panelGroups, panelTitle, visibleGroups } from "../web/src/warningPanel";

const w = (code: Warning["code"], items: number[], level: Warning["level"] = "warn", message = `${code} ${items.join(",")}`, brandId = "northwind"): Warning =>
  ({ code, items, message, level, brandId });

describe("panelTitle", () => {
  it("reads naturally for one and for many", () => {
    expect(panelTitle(1)).toBe("1 thing to check before printing");
    expect(panelTitle(9)).toBe("9 things to check before printing");
  });
});

describe("groupOf (short headings by kind)", () => {
  it("puts every logo check under Logos", () => {
    for (const c of ["no-logo", "low-res-logo", "logo-background"] as const) expect(groupOf(w(c, [0]))).toBe("logos");
  });
  it("splits text, prices and templates", () => {
    expect(groupOf(w("small-text", [0]))).toBe("text");
    expect(groupOf(w("was-price", [0]))).toBe("prices");
    expect(groupOf(w("kind-mismatch", [0]))).toBe("templates");
  });
  it("keeps the two note boxes' titles for the notes", () => {
    expect(groupOf(w("auto-abbrev", [0], "info"))).toBe("auto-fit");
    expect(groupOf(w("auto-template", [0], "info"))).toBe("auto-fit");
    expect(groupOf(w("spill", [0], "info"))).toBe("tight");
    expect(GROUP_TITLE["auto-fit"]).toBe("Auto-fit kept the text readable");
    expect(GROUP_TITLE.tight).toBe("Tight fits that still print fine");
  });
});

describe("panelGroups", () => {
  const all = [
    w("spill", [8], "info"),
    w("auto-abbrev", [7], "info"),
    w("was-price", [5]),
    w("small-text", [0], "warn", "Row 1: the collection is too big for its box"),
    w("no-logo", [2], "warn", "Row 3 uses a brand that was deleted", "retired-brand"),
    w("logo-background", [3], "info", "white background"), // a note the batch card never listed
    w("kind-mismatch", [6]),
    w("low-res-logo", [4]),
  ];
  const groups = panelGroups(all, ["northwind"]);

  it("lists warnings by kind first, then the quieter notes", () => {
    expect(groups.map((g) => g.id)).toEqual(["logos", "text", "prices", "templates", "auto-fit", "tight"]);
    const levels = groups.flatMap((g) => g.lines.map((l) => l.level));
    expect(levels.indexOf("info")).toBe(levels.lastIndexOf("warn") + 1);
  });

  it("keeps the check order inside a group", () => {
    expect(groups[0]!.lines.map((l) => l.row)).toEqual([2, 4]);
  });

  it("lists only what the batch card listed before: warnings plus auto-fit and tight-fit notes", () => {
    expect(lineCount(groups)).toBe(7);
    expect(groups.flatMap((g) => g.lines).some((l) => l.message === "white background")).toBe(false);
  });

  it("keeps each line's buttons (a deleted brand has no Open brand; a tight fit opens the designer)", () => {
    const line = (row: number) => groups.flatMap((g) => g.lines).find((l) => l.row === row)!;
    expect(line(2).actions).toEqual([]);
    expect(line(4).actions).toEqual(["open-brand"]);
    expect(line(0).actions).toEqual(["open-designer", "edit-sign"]);
    expect(line(5).actions).toEqual(["edit-sign"]);
    expect(line(6).actions).toEqual(["edit-sign"]);
    expect(line(7).actions).toEqual([]);
    expect(line(8).actions).toEqual(["open-designer"]);
  });
});

describe("visibleGroups (Show all)", () => {
  const many = panelGroups([w("no-logo", [0]), w("low-res-logo", [1]), w("low-res-logo", [2]), w("small-text", [3]), w("was-price", [4]), w("was-price", [5]), w("spill", [6], "info")], ["northwind"]);

  it("shows the first lines only, and drops headings left empty", () => {
    const v = visibleGroups(many, false);
    expect(lineCount(v)).toBe(PANEL_LIMIT);
    expect(v.map((g) => g.id)).toEqual(["logos", "text", "prices"]);
    expect(v[2]!.lines.map((l) => l.row)).toEqual([4]);
  });

  it("shows everything when expanded or short", () => {
    expect(lineCount(visibleGroups(many, true))).toBe(7);
    const few = panelGroups([w("was-price", [0])], []);
    expect(visibleGroups(few, false)).toBe(few);
  });
});
