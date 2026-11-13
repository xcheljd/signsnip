import { describe, expect, it } from "vitest";
import { clampPage, pageOfRow, pagesOneAtATime } from "../web/src/sheetPager";

describe("sheet pager: one page at a time", () => {
  it("only from 3 pages, and never with Show all pages on", () => {
    expect(pagesOneAtATime(0, false)).toBe(false);
    expect(pagesOneAtATime(1, false)).toBe(false);
    expect(pagesOneAtATime(2, false)).toBe(false);
    expect(pagesOneAtATime(3, false)).toBe(true);
    expect(pagesOneAtATime(20, true)).toBe(false);
  });

  it("a page that no longer exists falls back to the last one", () => {
    expect(clampPage(7, 3)).toBe(2);
    expect(clampPage(-1, 3)).toBe(0);
    expect(clampPage(0, 0)).toBe(0);
  });
});

describe("which page a row prints on (pageOfRow)", () => {
  // 10 per page; rows of 4, 4, 4, 9 and 1 copies fill slots 0-3, 4-7, 8-11, 12-20, 21
  const copies = [4, 4, 4, 9, 1];

  it("the first row is on page 1 (index 0)", () => {
    expect(pageOfRow(copies, 0, 10)).toBe(0);
  });

  it("a row that starts on one page and runs onto the next shows the page it starts on", () => {
    expect(pageOfRow(copies, 2, 10)).toBe(0); // slots 8-11
  });

  it("later rows count every copy before them", () => {
    expect(pageOfRow(copies, 3, 10)).toBe(1); // slot 12
    expect(pageOfRow(copies, 4, 10)).toBe(2); // slot 21
  });

  it("a row about to be added lands after the last copy", () => {
    expect(pageOfRow(copies, 5, 10)).toBe(2); // slot 22
    expect(pageOfRow([10], 1, 10)).toBe(1); // a full first page: the next row starts page 2
  });

  it("12 per page", () => {
    expect(pageOfRow([12, 1], 1, 12)).toBe(1);
  });
});
