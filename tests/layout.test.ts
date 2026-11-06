import { describe, expect, it } from "vitest";
import { fitLogo, fitSize, layoutSign, LOGO_BOX, MAX_TEXT_W, wrapWords } from "../src/core/layout";
import type { Sign } from "../src/core/types";

// fake metric: 0.5 em per char, em = size pt -> mm
const measure = (t: string, s: number) => t.length * 0.45 * s * 0.3528;
const sign = (o: Partial<Sign> = {}): Sign => ({
  id: "x", brandId: "b", prefix: "SELECT", collection: "MODELS", percent: 50, offLabel: "OFF*", footer: "*MSRP", copies: 1, ...o,
});

describe("fitLogo", () => {
  it("wide logos are width-limited and centred", () => {
    const r = fitLogo(6, LOGO_BOX);
    expect(r.w).toBeCloseTo(LOGO_BOX.w);
    expect(r.h).toBeLessThanOrEqual(LOGO_BOX.h);
    expect(r.x + r.w / 2).toBeCloseTo(LOGO_BOX.x + LOGO_BOX.w / 2);
  });
  it("tall logos are height-limited and never overflow", () => {
    const r = fitLogo(0.65, LOGO_BOX);
    expect(r.h).toBeCloseTo(LOGO_BOX.h);
    expect(r.w).toBeLessThanOrEqual(LOGO_BOX.w);
  });
});

describe("text fitting", () => {
  it("shrinks long text to fit the width", () => {
    const s = fitSize(measure, "DEEP FIELD CHRONOGRAPH", 14, MAX_TEXT_W);
    expect(s).toBeLessThan(14);
    expect(measure("DEEP FIELD CHRONOGRAPH", s)).toBeLessThanOrEqual(MAX_TEXT_W + 1e-6);
  });
  it("wraps on words, max two lines", () => {
    const l = wrapWords(measure, "FIELD MASTER AUTOMATIC", 14, MAX_TEXT_W, 2);
    expect(l.length).toBeLessThanOrEqual(2);
    expect(l.join(" ")).toBe("FIELD MASTER AUTOMATIC");
  });
});

describe("layoutSign", () => {
  it("emits prefix, collection, percent and footer, all inside the sign", () => {
    const { lines } = layoutSign(sign(), measure);
    expect(lines.map((l) => l.text)).toEqual(["SELECT", "MODELS", "50% OFF*", "*MSRP"]);
    for (const l of lines) expect(measure(l.text, l.sizePt)).toBeLessThanOrEqual(MAX_TEXT_W + 1e-6);
  });
  it("drops the prefix line when empty", () => {
    expect(layoutSign(sign({ prefix: "" }), measure).lines.map((l) => l.text)[0]).toBe("MODELS");
  });
  it("keeps the big percent at 30pt when it fits", () => {
    expect(layoutSign(sign(), measure).lines.find((l) => l.text.startsWith("50"))!.sizePt).toBe(30);
  });
});
