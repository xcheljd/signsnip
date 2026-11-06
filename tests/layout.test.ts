import { describe, expect, it } from "vitest";
import { fitLogo, fitSize, layoutSign, LOGO_BOX, LOGO_MAX, MAX_TEXT_W, maxLogoScale, money, smallLines, wrapWords } from "../src/core/layout";
import { cellRect, pageFill, sheetGeometry, slotOwners } from "../src/core/geometry";
import type { Sign, Template } from "../src/core/types";
import { DEFAULT_TEMPLATES, layoutTemplate, resolveTemplate, templateIssues, usedFields } from "../src/core/template";

// fake metric: 0.5 em per char, em = size pt -> mm
const measure = (t: string, s: number) => t.length * 0.45 * s * 0.3528;
const sign = (o: Partial<Sign> = {}): Sign => ({
  id: "x", brandId: "b", kind: "percent", prefix: "SELECT", collection: "MODELS", percent: 50, offLabel: "OFF*", priceLabel: "", footer: "*MSRP", copies: 1, ...o,
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

describe("logo scale", () => {
  it("lets a tall logo grow but never past the safe area", () => {
    const base = fitLogo(0.65, LOGO_BOX, 1);
    const big = fitLogo(0.65, LOGO_BOX, 1.6);
    expect(big.h).toBeGreaterThan(base.h);
    expect(big.h).toBeLessThanOrEqual(LOGO_MAX.h + 1e-9);
    expect(big.y).toBeGreaterThanOrEqual(LOGO_MAX.y);
    expect(big.x + big.w / 2).toBeCloseTo(LOGO_BOX.x + LOGO_BOX.w / 2);
  });
  it("reports the scale where growth stops, so the slider never does nothing", () => {
    const k = maxLogoScale(0.65);
    expect(k).toBeGreaterThan(1);
    expect(fitLogo(0.65, LOGO_BOX, k).h).toBeGreaterThan(fitLogo(0.65, LOGO_BOX, k - 0.05).h);
    expect(fitLogo(0.65, LOGO_BOX, k + 0.2).h).toBeCloseTo(fitLogo(0.65, LOGO_BOX, k).h, 0);
  });
  it("a wide logo at max scale stays inside the sign width", () => {
    const r = fitLogo(6, LOGO_BOX, 1.6);
    expect(r.w).toBeLessThanOrEqual(LOGO_MAX.w + 1e-9);
  });
});

describe("price signs", () => {
  it("formats money", () => {
    expect(money(199)).toBe("$199");
    expect(money(1295)).toBe("$1,295");
    expect(money(49.5)).toBe("$49.50");
  });
  it("lays out label, price and a struck was-price", () => {
    const { lines } = layoutSign(sign({ kind: "price", price: 199, wasPrice: 395, priceLabel: "now", footer: "" }), measure);
    expect(lines.map((l) => l.text)).toEqual(["SELECT", "MODELS", "NOW", "$199", "WAS $395"]);
    expect(lines.find((l) => l.role === "was")!.strike).toBe(true);
    expect(lines.find((l) => l.role === "big")!.sizePt).toBe(30);
  });
  it("flags text that shrank too far", () => {
    const l = layoutSign(sign({ collection: "EXTRAORDINARILYLONGCOLLECTIONNAMEWITHOUTSPACES" }), measure);
    expect(smallLines(l).length).toBeGreaterThan(0);
    expect(smallLines(layoutSign(sign(), measure))).toEqual([]);
  });
});

describe("sheet geometry", () => {
  it("centres a 5x2 grid of 47x70 on landscape letter", () => {
    const g = sheetGeometry({ grid: "landscape-5x2", paper: "letter" });
    expect(g.perPage).toBe(10);
    expect(g.left * 2 + 5 * 47).toBeCloseTo(279.4);
    expect(cellRect(g, 6)).toMatchObject({ x: g.left + 47, y: g.top + 70 });
  });
  it("maps printed slots back to batch rows and measures page fill", () => {
    expect(slotOwners([2, 1, 3])).toEqual([0, 0, 1, 2, 2, 2]);
    expect(pageFill(13, 10)).toEqual({ pages: 2, lastUsed: 3, empty: 7 });
    expect(pageFill(20, 10)).toEqual({ pages: 2, lastUsed: 10, empty: 0 });
  });
});

describe("templates", () => {
  const percent = DEFAULT_TEMPLATES.find((t) => t.id === "percent")!;
  const edit = (f: (t: Template) => void) => { const t = structuredClone(percent); f(t); return t; };
  it("resolves unknown or missing templates to the built-in for the kind", () => {
    expect(resolveTemplate({ kind: "price" }, DEFAULT_TEMPLATES).id).toBe("price");
    expect(resolveTemplate({ kind: "percent", templateId: "gone" }, DEFAULT_TEMPLATES).id).toBe("percent");
    expect(resolveTemplate({ kind: "percent", templateId: "bogo" }, DEFAULT_TEMPLATES).id).toBe("bogo");
  });
  it("honours font size, alignment and position from the template", () => {
    const t = edit((t) => { const o = t.objects.find((o) => o.id === "offer")!; Object.assign(o, { size: 20, align: "left", x: 5 }); });
    const big = layoutTemplate(t, sign(), measure).lines.find((l) => l.role === "big")!;
    expect(big.sizePt).toBe(20);
    expect(big.x).toBeCloseTo(5);
  });
  it("shrinks text to its box height, and reports text that can't fit at all", () => {
    const t = edit((t) => { const o = t.objects.find((o) => o.id === "offer")!; Object.assign(o, { h: 6, minSize: 8 }); });
    const big = layoutTemplate(t, sign(), measure).lines.find((l) => l.role === "big")!;
    expect(big.sizePt).toBeLessThan(30);
    const tiny = edit((t) => { const o = t.objects.find((o) => o.id === "offer")!; Object.assign(o, { h: 1, minSize: 20 }); });
    expect(layoutTemplate(tiny, sign(), measure).overflow.map((x) => x.objectId)).toEqual(["offer"]);
  });
  it("re-wraps as it shrinks, so a long name balances over its lines instead of overflowing", () => {
    const placed = layoutTemplate(percent, sign({ collection: "EXTRAORDINARILY LONG COLLECTION NAME DELUXE EDITION" }), measure);
    expect(placed.overflow).toEqual([]);
    const col = placed.lines.filter((l) => l.role === "collection");
    expect(col.length).toBe(2);
    for (const l of col) expect(l.w).toBeLessThanOrEqual(39 + 1e-6);
  });
  it("prints fixed text and lists the fields a template uses", () => {
    const bogo = DEFAULT_TEMPLATES.find((t) => t.id === "bogo")!;
    expect(layoutTemplate(bogo, sign(), measure).lines.map((l) => l.text).slice(0, 3)).toEqual(["BUY ONE", "GET ONE", "50% OFF*"]);
    expect(usedFields(bogo).has("prefix")).toBe(false);
    expect(usedFields(percent).has("prefix")).toBe(true);
  });
  it("flags objects outside the safe margin or off the paper", () => {
    const t = edit((t) => { t.objects[0]!.x = 0.5; t.objects[1]!.x = 60; });
    const issues = templateIssues(t);
    expect(issues.some((i) => i.level === "warn" && i.objectId === "logo")).toBe(true);
    expect(issues.some((i) => i.level === "error" && i.objectId === "heading")).toBe(true);
    expect(templateIssues(percent).filter((i) => i.level !== "info")).toEqual([]);
  });
});
