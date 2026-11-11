import { describe, expect, it } from "vitest";
import { pdfKey, reusablePdf } from "../web/src/pdfKey";

/** Print reuses the on-screen preview only when it was made for exactly the batch being printed. */
const sign = (percent: number) => ({ id: "s1", brandId: "northwind", collection: "HARBOR", percent, copies: 1 });
const options = { grid: "landscape-5x2", paper: "letter", cutMarks: true };
const preview = { bytes: "pdf of 50%" };

describe("Print never prints a stale preview", () => {
  it("reuses a preview made for the current batch", () => {
    const k = pdfKey([sign(50)], options, "sheet", "logos-v1");
    expect(reusablePdf({ pdf: preview, madeFor: k }, pdfKey([sign(50)], options, "sheet", "logos-v1"))).toBe(preview);
  });

  it("refuses a preview made before an edit (stale key), so Print fetches a fresh PDF", () => {
    const madeFor = pdfKey([sign(50)], options, "sheet", "logos-v1");
    expect(reusablePdf({ pdf: preview, madeFor }, pdfKey([sign(40)], options, "sheet", "logos-v1"))).toBeNull();
    expect(reusablePdf({ pdf: preview, madeFor }, pdfKey([sign(50)], { ...options, cutMarks: false }, "sheet", "logos-v1"))).toBeNull();
    expect(reusablePdf({ pdf: preview, madeFor }, pdfKey([sign(50)], options, "sheet", "logos-v2"))).toBeNull();
    expect(reusablePdf({ pdf: preview, madeFor }, pdfKey([sign(50)], options, "single", "logos-v1"))).toBeNull();
  });

  it("with no preview yet, Print fetches", () => {
    const k = pdfKey([sign(50)], options, "sheet");
    expect(reusablePdf({ pdf: null, madeFor: null }, k)).toBeNull();
    expect(reusablePdf({ pdf: null, madeFor: k }, k)).toBeNull();
    expect(reusablePdf({ pdf: preview, madeFor: null }, k)).toBeNull();
  });
});
