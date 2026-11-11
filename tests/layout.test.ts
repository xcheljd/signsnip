import { describe, expect, it } from "vitest";
import { fitLogo, growArea, LOGO_BOX, maxLogoScale, money, wrapWords, type Measure } from "../src/core/layout";
import { cellRect, pageFill, sheetGeometry, slotOwners } from "../src/core/geometry";
import type { Sign, Template } from "../src/core/types";
import { tmpWorkspace, useNodeWorkspace } from "./helpers";
import { applyAbbreviation, balanceLines, belowMin, DEFAULT_TEMPLATES, defaultTemplate, describeOverflow, fitSign, layoutTemplate, overflowDetails, resolveTemplate, templateIssues, usedFields, withKind, withTemplate } from "../src/core/template";

// fake metric: 0.5 em per char, em = size pt -> mm
const measure = (t: string, s: number) => t.length * 0.45 * s * 0.3528;
const sign = (o: Partial<Sign> = {}): Sign => ({
  id: "x", brandId: "b", kind: "percent", prefix: "SELECT", collection: "MODELS", percent: 50, offLabel: "OFF*", priceLabel: "", footer: "*MSRP", copies: 1, ...o,
});

const MAX_TEXT_W = LOGO_BOX.w; // the default templates keep text inside the same 4 mm side padding
const LOGO_MAX = growArea(LOGO_BOX);
/** a sign laid out with its kind's built-in template */
const layoutSign = (s: Sign, m: Measure) => layoutTemplate(defaultTemplate(s.kind ?? "percent"), s, m);

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
  it("flags text that shrank below the readable minimum, not text designed small", () => {
    const l = layoutTemplate(DEFAULT_TEMPLATES[0]!, sign({ collection: "EXTRAORDINARILYLONGCOLLECTIONNAMEWITHOUTSPACES" }), measure);
    expect(belowMin(l, 10).length).toBeGreaterThan(0);
    expect(belowMin(layoutTemplate(DEFAULT_TEMPLATES[0]!, sign(), measure), 10)).toEqual([]);
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
  it("balance is off by default and evens out lines without changing the size", () => {
    const off = layoutTemplate(percent, sign({ collection: "SEABIRD CHRONO GMT DIVER" }), measure).lines.filter((l) => l.role === "collection");
    const on = layoutTemplate(edit((t) => { (t.objects.find((o) => o.id === "heading") as { balance: boolean }).balance = true; }),
      sign({ collection: "SEABIRD CHRONO GMT DIVER" }), measure).lines.filter((l) => l.role === "collection");
    expect(off.length).toBe(on.length);
    expect(on[0]!.sizePt).toBe(off[0]!.sizePt);
    const spread = (ls: typeof on) => Math.max(...ls.map((l) => l.w)) - Math.min(...ls.map((l) => l.w));
    expect(spread(on)).toBeLessThanOrEqual(spread(off));
    expect(on.map((l) => l.text).join(" ")).toBe("SEABIRD CHRONO GMT DIVER");
  });
  it("balanceLines minimises the widest line", () => {
    const m = (t: string) => t.length;
    expect(balanceLines(m, "SEABIRD CHRONO GMT", 1, 2)).toEqual(["SEABIRD", "CHRONO GMT"]);
    expect(balanceLines(m, "HARBOR LINE DIVE COLLECTION", 1, 2)).toEqual(["HARBOR LINE", "DIVE COLLECTION"]);
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

describe("auto-fit (readable minimum)", () => {
  const T = structuredClone(DEFAULT_TEMPLATES);
  const percent = T.find((t) => t.id === "percent")!;
  const long = T.find((t) => t.id === "percent-long")!;
  const name = "Deep Field Chronograph Automatic Collection Edition";
  const rules = (min: number, abbreviations: { from: string; to: string }[] = []) => ({ readableMin: min, abbreviations });
  const col = (f: ReturnType<typeof fitSign>) => f.placed.lines.filter((l) => l.role === "collection");

  it("abbreviates whole words only, case-insensitively", () => {
    expect(applyAbbreviation("Deep Field Chronograph", { from: "chronograph", to: "Chrono" })).toBe("Deep Field Chrono");
    expect(applyAbbreviation("Chronographs", { from: "Chronograph", to: "C" })).toBe("Chronographs");
    expect(applyAbbreviation("Ltd. Edition", { from: "Ltd.", to: "L" })).toBe("L Edition");
  });
  it("leaves text alone when it is already readable", () => {
    const f = fitSign(sign({ collection: "Dusk" }), T, measure, rules(10, [{ from: "Dusk", to: "D" }]));
    expect(f.abbreviations).toEqual([]);
    expect(f.sign.collection).toBe("Dusk");
  });
  it("uses abbreviations only until the text is readable, biggest savings first", () => {
    const ab = [{ from: "Edition", to: "Ed." }, { from: "Chronograph", to: "Chrono" }, { from: "Automatic", to: "Auto" }, { from: "Collection", to: "Coll." }];
    const none = fitSign(sign({ collection: name }), T, measure, rules(10));
    const f = fitSign(sign({ collection: name }), T, measure, rules(10, ab));
    expect(none.belowMin.length).toBeGreaterThan(0);
    expect(f.abbreviations.length).toBeGreaterThan(0);
    expect(f.abbreviations[0]!.from).toBe("Chronograph");
    expect(Math.min(...col(f).map((l) => l.sizePt))).toBeGreaterThan(Math.min(...col(none).map((l) => l.sizePt)));
  });
  it("switches to the fallback template when abbreviations aren't enough", () => {
    const withFb = T.map((t) => (t.id === "percent" ? { ...t, fallbackId: "percent-long" } : t));
    const f = fitSign(sign({ collection: "Field Master Automatic Moonphase" }), withFb, measure, rules(12));
    expect(f.switchedFrom?.id).toBe("percent");
    expect(f.template.id).toBe(long.id);
    expect(f.belowMin).toEqual([]);
    // no fallback set -> stays on its own template and is flagged
    const g = fitSign(sign({ collection: "Field Master Automatic Moonphase" }), T, measure, rules(12));
    expect(g.template.id).toBe(percent.id);
    expect(g.belowMin.length).toBeGreaterThan(0);
  });
  it("ignores fallbacks of the other kind and fallback loops", () => {
    const bad = T.map((t) => (t.id === "percent" ? { ...t, fallbackId: "price" } : t.id === "percent-long" ? { ...t, fallbackId: "percent" } : t));
    expect(fitSign(sign({ collection: name }), bad, measure, rules(12)).template.id).toBe("percent");
  });
  it("a template's own minimum overrides the store setting", () => {
    const strict = T.map((t) => (t.id === "percent" ? { ...t, readableMin: 13.5 } : t));
    expect(fitSign(sign({ collection: "Field Master Automatic" }), strict, measure, rules(6)).min).toBe(13.5);
  });
});

describe("line spacing and spill checks", () => {
  const base = () => structuredClone(DEFAULT_TEMPLATES.find((t) => t.id === "percent")!);
  const heading = (t: Template) => t.objects.find((o) => o.id === "heading")! as Extract<Template["objects"][number], { type: "text" }>;
  const lines = (t: Template, s = sign({ collection: "NORTHWIND SKYLINE" })) => layoutTemplate(t, s, measure).lines.filter((l) => l.objectId === "heading");

  it("line spacing changes the gap between wrapped lines, not the font size", () => {
    const t = base(); const normal = lines(t);
    heading(t).lineSpacing = 1.4; const wide = lines(t);
    expect(wide.length).toBe(normal.length);
    expect(wide.map((l) => l.sizePt)).toEqual(normal.map((l) => l.sizePt));
    const gap = (ls: typeof normal) => ls[1]!.cy - ls[0]!.cy;
    expect(gap(wide) / gap(normal)).toBeCloseTo(1.4, 2);
  });
  it("tighter spacing lets more text fit before it has to shrink", () => {
    const t = base(); const h = heading(t); h.h = 9;
    const s = sign({ collection: "HARBOR LINE" });
    const normal = layoutTemplate(t, s, measure).lines.filter((l) => l.objectId === "heading")[0]!.sizePt;
    h.lineSpacing = 0.8;
    const tight = layoutTemplate(t, s, measure).lines.filter((l) => l.objectId === "heading")[0]!.sizePt;
    expect(tight).toBeGreaterThan(normal);
  });
  it("text spilling into empty space is a harmless note; spilling onto other text is a warning", () => {
    const t = base(); const h = heading(t); h.h = 6; h.minSize = 11;
    const s = sign({ collection: "NORTHWIND SKYLINE" });
    let d = overflowDetails(t, layoutTemplate(t, s, measure), null);
    expect(d).toHaveLength(1);
    expect(d[0]!.by).toBeGreaterThan(0);
    expect(d[0]!.harmless).toBe(true);
    expect(describeOverflow(d[0]!, "this template")).toMatch(/prints fine/);
    const offer = t.objects.find((o) => o.id === "offer")!; offer.y = h.y + 2; // pull the offer up into it
    d = overflowDetails(t, layoutTemplate(t, s, measure), null);
    expect(d[0]!.harmless).toBe(false);
    expect(d[0]!.hits).toContain("the offer");
    expect(describeOverflow(d[0]!, "this template")).toMatch(/prints over the offer/);
  });
  it("old templates without lineSpacing load as normal spacing", () => {
    const t = base(); delete (heading(t) as { lineSpacing?: number }).lineSpacing;
    const a = lines(t); const b = lines(base());
    expect(a.map((l) => l.cy)).toEqual(b.map((l) => l.cy));
  });
});

describe("withKind (bulk Percent/Price keeps the template in step)", () => {
  const harborPrice: Template = { ...defaultTemplate("price"), id: "harbor-price", name: "Harbor price" };
  const templates = [...DEFAULT_TEMPLATES, harborPrice];

  it("moves a percent sign on the percent template to the built-in price template", () => {
    const s = withKind(sign({ templateId: "percent" }), "price", templates);
    expect(s.kind).toBe("price");
    expect(s.templateId).toBe("price");
    expect(s.footer).toBe("");
    expect(resolveTemplate(s, templates).kind).toBe("price");
  });
  it("keeps a template that already prints the new kind", () => {
    const s = withKind(sign({ templateId: "harbor-price" }), "price", templates);
    expect(s.templateId).toBe("harbor-price");
    expect(s.kind).toBe("price");
  });
  it("leaves a sign of the same kind unchanged (new object)", () => {
    const before = sign({ templateId: "percent", footer: "Harbor only" });
    const after = withKind(before, "percent", templates);
    expect(after).toEqual(before);
    expect(after).not.toBe(before);
  });
  it("going back to percent restores the default footer and fixes an old mismatch", () => {
    const s = withKind(sign({ kind: "price", price: 120, templateId: "price", footer: "" }), "percent", templates);
    expect(s).toMatchObject({ kind: "percent", templateId: "percent", footer: "*MSRP" });
    const stale = withKind(sign({ kind: "percent", templateId: "harbor-price" }), "percent", templates);
    expect(stale.templateId).toBe("percent");
  });
});

describe("withTemplate (editor and bulk Template select: the default footer follows the kind)", () => {
  const harborPrice: Template = { ...defaultTemplate("price"), id: "harbor-price", name: "Harbor price" };
  const harborPercent: Template = { ...defaultTemplate("percent"), id: "harbor-percent", name: "Harbor percent" };
  const priceTpl = defaultTemplate("price");
  const percentTpl = defaultTemplate("percent");

  it("a percent sign with *MSRP going to a price template loses the default footer", () => {
    const s = withTemplate(sign({ templateId: "percent", footer: "*MSRP" }), priceTpl);
    expect(s).toMatchObject({ kind: "price", templateId: "price", footer: "" });
  });
  it("a price sign with no footer going to a percent template gets *MSRP", () => {
    const s = withTemplate(sign({ kind: "price", price: 120, templateId: "price", footer: "" }), percentTpl);
    expect(s).toMatchObject({ kind: "percent", templateId: "percent", footer: "*MSRP", price: 120 });
  });
  it("keeps a footer the user typed, both ways", () => {
    expect(withTemplate(sign({ templateId: "percent", footer: "Harbor only" }), priceTpl).footer).toBe("Harbor only");
    expect(withTemplate(sign({ kind: "price", price: 120, templateId: "price", footer: "Harbor only" }), percentTpl).footer).toBe("Harbor only");
  });
  it("a template of the same kind changes only the template id", () => {
    const before = sign({ templateId: "percent", footer: "" });
    expect(withTemplate(before, harborPercent)).toEqual({ ...before, templateId: "harbor-percent" });
    expect(withTemplate(sign({ kind: "price", price: 120, templateId: "price", footer: "*MSRP" }), harborPrice).footer).toBe("*MSRP");
  });
  it("sets a custom price template's id, not the built-in one", () => {
    const s = withTemplate(sign({ templateId: "percent", footer: "*MSRP" }), harborPrice);
    expect(s).toMatchObject({ kind: "price", templateId: "harbor-price", footer: "" });
  });
});

describe("checkSigns kind-mismatch warning", () => {
  it("flags a sign whose template prints the other kind, and nothing after withKind", async () => {
    // fonts + images (node.ts loaded with a temp data dir, never the real one); storage is swapped for memory below
    await useNodeWorkspace(tmpWorkspace("signsnip-layout-"));
    const { MemoryRepo, setRepo } = await import("../src/core/repo");
    setRepo(new MemoryRepo());
    const { checkSigns } = await import("../src/core/pdf");
    const bad = sign({ brandId: "northwind", collection: "HARBOR", kind: "price", price: 120, templateId: "percent", footer: "" });
    const mismatch = (await checkSigns([bad])).filter((w) => w.code === "kind-mismatch");
    expect(mismatch).toHaveLength(1);
    expect(mismatch[0]).toMatchObject({ items: [0], level: "warn" });
    expect(mismatch[0]!.message).toContain("set as a price sign");
    const fixed = { ...withKind(sign({ brandId: "northwind", collection: "HARBOR", templateId: "percent" }), "price", DEFAULT_TEMPLATES), price: 120 };
    expect((await checkSigns([fixed])).filter((w) => w.code === "kind-mismatch")).toHaveLength(0);
  });
});
