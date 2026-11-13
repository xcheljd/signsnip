import { describe, expect, it } from "vitest";
import type { LogoInfo } from "../src/core/images";
import { REFUSAL_WINDOW_MS, brandProblems, filterBrands, nextOpen, printedDpi, refusedJustNow, showBrandSearch, tapTarget } from "../web/src/brandList";

const B = [
  { id: "northwind", name: "Northwind" },
  { id: "kestrel-vale", name: "Kestrel & Vale" },
  { id: "tidemark", name: "Tidemark" },
  { id: "harborview", name: "Harborview Precision Timepieces & Marine Instruments Company" },
];
const ids = (l: { id: string }[]) => l.map((b) => b.id);

describe("brand list search (filterBrands)", () => {
  it("an empty or blank query shows every brand, in order", () => {
    expect(ids(filterBrands(B, "", null))).toEqual(ids(B));
    expect(ids(filterBrands(B, "   ", null))).toEqual(ids(B));
  });

  it("matches part of the name, whatever the capitals, ignoring spaces around the query", () => {
    expect(ids(filterBrands(B, "  MARK ", null))).toEqual(["tidemark"]);
    expect(ids(filterBrands(B, "&", null))).toEqual(["kestrel-vale", "harborview"]);
    expect(ids(filterBrands(B, "precision timepieces", null))).toEqual(["harborview"]);
  });

  it("no match shows nothing", () => {
    expect(filterBrands(B, "zebra", null)).toEqual([]);
  });

  it("the open editor holding unsaved or refused text is never filtered away, and keeps its place", () => {
    expect(ids(filterBrands(B, "tide", "northwind"))).toEqual(["northwind", "tidemark"]);
    expect(ids(filterBrands(B, "zebra", "kestrel-vale"))).toEqual(["kestrel-vale"]);
  });

  it("the search box shows only for more than 6 brands", () => {
    expect(showBrandSearch(6)).toBe(false);
    expect(showBrandSearch(7)).toBe(true);
  });
});

describe("one editor open at a time (nextOpen / tapTarget)", () => {
  const clean = { pending: false, refused: false };

  it("nothing open: the tapped brand opens", () => {
    expect(nextOpen(null, tapTarget(null, "tidemark"), null)).toBe("tidemark");
  });

  it("another row: the open one closes once it saved cleanly, and the tapped one opens", () => {
    expect(nextOpen("northwind", tapTarget("northwind", "tidemark"), clean)).toBe("tidemark");
  });

  it("the open row again: it closes", () => {
    expect(tapTarget("northwind", "northwind")).toBeNull();
    expect(nextOpen("northwind", tapTarget("northwind", "northwind"), clean)).toBeNull();
  });

  it("a save that failed (a name another brand has) keeps that editor open", () => {
    expect(nextOpen("northwind", "tidemark", { pending: true, refused: true })).toBe("northwind");
    expect(nextOpen("northwind", null, { pending: true, refused: false })).toBe("northwind");
  });

  it("an empty name that was just refused keeps the editor open to show why", () => {
    expect(nextOpen("northwind", "tidemark", { pending: false, refused: true })).toBe("northwind");
  });

  it("a refusal counts for the tap that switches only when it came just before it (or during it)", () => {
    const t = 1_000_000;
    expect(refusedJustNow(0, t)).toBe(false); // nothing refused since the last switch
    expect(refusedJustNow(t - 150, t)).toBe(true); // the name box lost focus as the tap landed
    expect(refusedJustNow(t - REFUSAL_WINDOW_MS, t)).toBe(false); // the error was already on screen: let the tap through
    expect(refusedJustNow(t - 30_000, t)).toBe(false);
  });

  it("a jump from another tab opens the brand, unless the open editor must stay", () => {
    expect(nextOpen("northwind", "tidemark", clean)).toBe("tidemark");
    expect(nextOpen("tidemark", "tidemark", clean)).toBe("tidemark");
    expect(nextOpen("northwind", "tidemark", { pending: true, refused: false })).toBe("northwind");
  });
});

describe("brand row problem badges (brandProblems)", () => {
  const logo = (o: Partial<LogoInfo>): LogoInfo => ({ width: 600, height: 200, aspect: 3, background: "transparent", hasOriginal: false, version: "v", ...o });

  it("no logo", () => {
    expect(brandProblems({ logo: null, logoScale: 1 })).toEqual(["no logo"]);
  });

  it("a sharp logo on a transparent background has none", () => {
    expect(brandProblems({ logo: logo({ width: 1200 }), logoScale: 1 })).toEqual([]);
  });

  it("a small logo is low resolution, with the same dpi the editor shows", () => {
    const b = { logo: logo({ width: 40, aspect: 40 / 14 }), logoScale: 1 };
    expect(printedDpi(b)).toBeLessThan(250);
    expect(brandProblems(b)).toEqual([`~${printedDpi(b)} dpi printed`]);
  });

  it("a logo on a solid box", () => {
    expect(brandProblems({ logo: logo({ width: 1200, background: "solid" }), logoScale: 1 })).toEqual(["solid background"]);
  });
});
