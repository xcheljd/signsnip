import { describe, expect, it } from "vitest";
import { logoThumb } from "../web/src/logoThumb";

describe("logoThumb (which batch rows show a logo, which the no-logo placeholder)", () => {
  it("a brand with a logo shows it, keyed by the logo's version", () => {
    expect(logoThumb({ id: "northwind", logo: { width: 600, height: 200, aspect: 3, background: "transparent", hasOriginal: false, version: "abc123" } })).toEqual({ id: "northwind", version: "abc123" });
  });

  it("a brand without a logo gets the placeholder (no request)", () => {
    expect(logoThumb({ id: "quillfeather", logo: null })).toBeNull();
  });

  it("a deleted brand gets the placeholder (no request)", () => {
    expect(logoThumb(undefined)).toBeNull();
  });
});
