import { describe, expect, it } from "vitest";
import { pageMeter } from "../web/src/pageMeter";

describe("pageMeter (one line under the batch)", () => {
  it("says nothing for an empty batch", () => {
    expect(pageMeter(0, 10, 0)).toBeNull();
  });

  it("one full page: no Fill button", () => {
    expect(pageMeter(10, 10, 7)).toEqual({ text: "1 page · all 10 slots filled", fill: null });
  });

  it("one part-filled page: fills the page with copies of the last row", () => {
    expect(pageMeter(7, 10, 4)).toEqual({
      text: "1 page · 7 of 10 slots filled",
      fill: { more: 3, row: 4, label: "Fill the page: 3 more copies of row 4", undo: "Filled page 1 with 3 more of row 4" },
    });
  });

  it("many pages, last one part-filled", () => {
    expect(pageMeter(197, 10, 45)).toEqual({
      text: "20 pages · last page 7 of 10 filled",
      fill: { more: 3, row: 45, label: "Fill the last page: 3 more copies of row 45", undo: "Filled page 20 with 3 more of row 45" },
    });
  });

  it("many full pages", () => {
    expect(pageMeter(200, 10, 45)).toEqual({ text: "20 pages · every page full", fill: null });
  });

  it("one more copy reads as one", () => {
    expect(pageMeter(11, 12, 2)!.fill!.label).toBe("Fill the page: 1 more copy of row 2");
  });
});
