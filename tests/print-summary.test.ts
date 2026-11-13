import { describe, expect, it } from "vitest";
import { printSummary } from "../web/src/printSummary";

describe("print settings summary line", () => {
  it("letter, landscape 5x2, no cut lines", () => {
    expect(printSummary({ paper: "letter", grid: "landscape-5x2", cutMarks: false })).toBe("Letter · 10 per page · cut lines off");
  });

  it("A4, portrait 4x3, cut lines on", () => {
    expect(printSummary({ paper: "a4", grid: "portrait-4x3", cutMarks: true })).toBe("A4 · 12 per page · cut lines on");
  });
});
