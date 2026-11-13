import { describe, expect, it } from "vitest";
import { chipsThatFit, rowsFor } from "../web/src/chipRows";

describe("rowsFor lays items out like flex-wrap", () => {
  it("counts rows with gaps between items", () => {
    expect(rowsFor([], 100, 8)).toBe(0);
    expect(rowsFor([40, 40], 100, 8)).toBe(1); // 40 + 8 + 40 = 88
    expect(rowsFor([50, 50], 100, 8)).toBe(2); // 50 + 8 + 50 = 108 > 100
    expect(rowsFor([46, 46], 100, 8)).toBe(1); // exactly 100 fits
  });
  it("an item wider than the line gets a row of its own", () => {
    expect(rowsFor([10, 300, 10], 100, 8)).toBe(3);
  });
});

describe("preset chips: at most two rows", () => {
  const base = { line: 300, gap: 8, lead: 50, more: 100 };
  it("everything fits: all chips, no Show all control", () => {
    // row 1: 50 + 8+100 + 8+100 = 266; row 2: 120
    expect(chipsThatFit({ ...base, chips: [100, 100, 120] })).toBe(3);
  });
  it("too many: the most chips that still fit with the control at the end of row 2", () => {
    // row 1: 50 + 100 + 100 (266); row 2: 120 + 8 + 100 = 228, + more would be 336 > 299, so only 1 chip on row 2
    const chips = [100, 100, 120, 100, 100, 100];
    const k = chipsThatFit({ ...base, chips });
    expect(k).toBe(3);
    expect(rowsFor([base.lead, ...chips.slice(0, k), base.more], base.line - 1, base.gap)).toBeLessThanOrEqual(2);
    expect(rowsFor([base.lead, ...chips.slice(0, k + 1), base.more], base.line - 1, base.gap)).toBeGreaterThan(2);
  });
  it("uses the real widths: one wide chip early leaves less room", () => {
    const narrow = chipsThatFit({ ...base, chips: Array(12).fill(40) });
    const wide = chipsThatFit({ ...base, chips: [240, ...Array(11).fill(40)] });
    expect(wide).toBeLessThan(narrow);
  });
  it("a wider line shows more chips (re-computed on resize)", () => {
    const chips = Array.from({ length: 16 }, (_, i) => 60 + (i % 4) * 30);
    const at820 = chipsThatFit({ ...base, line: 700, chips });
    const at1280 = chipsThatFit({ ...base, line: 1100, chips });
    expect(at1280).toBeGreaterThan(at820);
    expect(at820).toBeLessThan(16);
  });
  it("rows can be set and never returns more chips than there are", () => {
    expect(chipsThatFit({ ...base, rows: 1, chips: [100, 100, 100] })).toBe(1); // 50+100+100 = 266, the control takes the rest
    expect(chipsThatFit({ ...base, chips: [] })).toBe(0);
  });
  it("sub-pixel widths that only just fit are treated as not fitting (no chip ever wraps to a third row)", () => {
    // 50 + 8 + 241.5 = 299.5: fits a 300 line on paper, but the browser may round it over
    expect(chipsThatFit({ ...base, rows: 1, chips: [241.5] })).toBe(0);
  });
});
