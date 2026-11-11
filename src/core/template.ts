import { fitLogo, money, percentText, wrapWords, type Measure } from "./layout.js";
import {
  DEFAULT_RULES, SIGN_H_MM, SIGN_W_MM, type Abbreviation, type LogoObject, type Rules, type Sign, type Template,
  type TemplateObject, type TextField, type TextObject,
} from "./types.js";

// ---------- built-in templates (match the original spreadsheet layout)

const T = (o: Partial<TextObject> & Pick<TextObject, "id" | "field" | "x" | "y" | "w" | "h" | "size">): TextObject => ({
  type: "text", text: "", minSize: 7, weight: "bold", align: "center", vAlign: "middle", maxLines: 1, balance: false, lineSpacing: 1,
  uppercase: true, strike: false, color: "#000000", ...o,
});
const LOGO: LogoObject = { id: "logo", type: "logo", x: 4, y: 5, w: 39, h: 15 };

export const BUILTIN_IDS = ["percent", "price"] as const;
export const isBuiltin = (id: string) => (BUILTIN_IDS as readonly string[]).includes(id);

export const DEFAULT_TEMPLATES: Template[] = [
  {
    id: "percent", name: "Percent off", kind: "percent", safeMargin: 2,
    objects: [
      LOGO,
      T({ id: "heading", field: "heading", x: 4, y: 21, w: 39, h: 14, size: 14, maxLines: 3 }),
      T({ id: "offer", field: "offer", x: 3, y: 39.5, w: 41, h: 13, size: 30, minSize: 14 }),
      T({ id: "footer", field: "footer", x: 4, y: 58.5, w: 39, h: 7, size: 13, minSize: 8 }),
    ],
  },
  {
    id: "price", name: "Price", kind: "price", safeMargin: 2,
    objects: [
      LOGO,
      T({ id: "heading", field: "heading", x: 4, y: 20, w: 39, h: 14, size: 14, maxLines: 3 }),
      T({ id: "label", field: "label", x: 4, y: 36.5, w: 39, h: 6, size: 11 }),
      T({ id: "offer", field: "offer", x: 3, y: 41, w: 41, h: 12, size: 30, minSize: 14 }),
      T({ id: "was", field: "was", x: 4, y: 52, w: 39, h: 6, size: 11, strike: true }),
      T({ id: "footer", field: "footer", x: 4, y: 58.5, w: 39, h: 7, size: 13, minSize: 8 }),
    ],
  },
  // two examples of what the designer can do (fake, deletable)
  {
    id: "bogo", name: "Buy one get one", kind: "percent", safeMargin: 2,
    objects: [
      { ...LOGO, y: 4, h: 12 },
      T({ id: "static-1", field: "static", text: "BUY ONE", x: 4, y: 18, w: 39, h: 7, size: 15 }),
      T({ id: "static-2", field: "static", text: "GET ONE", x: 4, y: 25, w: 39, h: 7, size: 15 }),
      T({ id: "offer", field: "offer", x: 3, y: 33, w: 41, h: 13, size: 30, minSize: 14 }),
      T({ id: "collection", field: "collection", x: 4, y: 47, w: 39, h: 9, size: 11, maxLines: 2, weight: "regular" }),
      T({ id: "footer", field: "footer", x: 4, y: 59, w: 39, h: 6, size: 11, minSize: 8 }),
    ],
  },
  {
    // a roomier layout for long names: taller heading box (4 lines, balanced), offer moved down.
    // Not wired up by default: set it as "Percent off"'s fallback in the designer to use it.
    id: "percent-long", name: "Percent off · long name", kind: "percent", safeMargin: 2,
    objects: [
      { ...LOGO, y: 4, h: 12 },
      T({ id: "heading", field: "heading", x: 3.5, y: 17.5, w: 40, h: 23, size: 14, maxLines: 4, balance: true }),
      T({ id: "offer", field: "offer", x: 3, y: 42, w: 41, h: 13, size: 28, minSize: 14 }),
      T({ id: "footer", field: "footer", x: 4, y: 58.5, w: 39, h: 7, size: 12, minSize: 8 }),
    ],
  },
  {
    id: "final-sale", name: "Final sale", kind: "percent", safeMargin: 2,
    objects: [
      T({ id: "static-1", field: "static", text: "FINAL SALE", x: 3, y: 4, w: 41, h: 8, size: 18, color: "#b42318" }),
      { ...LOGO, y: 14, h: 11 },
      T({ id: "heading", field: "heading", x: 4, y: 27, w: 39, h: 12, size: 12, maxLines: 3 }),
      T({ id: "offer", field: "offer", x: 3, y: 41, w: 41, h: 13, size: 32, minSize: 14 }),
      T({ id: "footer", field: "footer", x: 4, y: 58.5, w: 39, h: 7, size: 12, minSize: 8 }),
    ],
  },
];

export const defaultTemplate = (kind: Sign["kind"]) => DEFAULT_TEMPLATES.find((t) => t.id === kind)!;

/** The template a sign prints with (missing/unknown -> built-in for its kind). */
export function resolveTemplate(sign: Pick<Sign, "templateId" | "kind">, templates: Template[]): Template {
  const id = sign.templateId ?? sign.kind ?? "percent";
  return templates.find((t) => t.id === id) ?? templates.find((t) => t.id === (sign.kind ?? "percent")) ?? defaultTemplate(sign.kind ?? "percent");
}

/**
 * Change a sign's kind and keep its template in step: a sign whose template is of the other
 * kind moves to the built-in template for the new kind (the template decides what prints).
 * The default footer follows the kind, like the sign editor does.
 */
export function withKind<S extends Sign>(sign: S, kind: Sign["kind"], templates: Template[]): S {
  const same = resolveTemplate(sign, templates).kind === kind;
  return { ...sign, kind, templateId: same ? sign.templateId : kind, footer: footerForKind(sign, kind) };
}

/**
 * Put a sign on a template (sign editor and bulk Template select): templateId and kind become
 * the template's, the default footer follows a change of kind, everything else is kept.
 */
export function withTemplate<S extends Sign>(sign: S, template: Template): S {
  return { ...sign, templateId: template.id, kind: template.kind, footer: footerForKind(sign, template.kind) };
}

/**
 * The footer a sign gets when it changes kind: the default footer follows the kind (percent
 * "*MSRP", price empty); any other footer the user typed is kept, and a sign that keeps its
 * kind keeps its footer untouched. The only copy of this rule.
 */
function footerForKind(sign: Sign, kind: Sign["kind"]): string {
  if (sign.kind === kind) return sign.footer;
  if (kind === "price") return sign.footer === "*MSRP" ? "" : sign.footer;
  return sign.footer === "" ? "*MSRP" : sign.footer;
}

/** Which sign fields a template actually prints (drives which inputs the editor shows). */
export function usedFields(t: Template): Set<TextField | "logo" | "prefix" | "collection"> {
  const out = new Set<TextField | "logo">();
  for (const o of t.objects) {
    if (o.type === "logo") out.add("logo");
    else if (o.field === "heading") { out.add("prefix"); out.add("collection"); }
    else out.add(o.field);
  }
  return out;
}

export const FIELD_LABELS: Record<TextField, string> = {
  heading: "Lead word + collection", prefix: "Lead word", collection: "Collection", offer: "Offer (percent / price)",
  label: "Above the price", was: "Was price", footer: "Footer", static: "Fixed text",
};

// ---------- layout

export interface PlacedLine {
  objectId: string;
  text: string;
  sizePt: number;
  /** size the object asked for (before shrink-to-fit) */
  wantPt: number;
  /** left edge and width of the line, in mm from the sign's top-left */
  x: number; w: number;
  /** vertical centre of the caps, mm */
  cy: number;
  cx: number;
  weight: "bold" | "regular";
  color: string;
  strike: boolean;
  role: "prefix" | "collection" | "big" | "label" | "was" | "footer" | "static";
}
export interface PlacedSign {
  logo?: { box: { x: number; y: number; w: number; h: number }; objectId: string };
  lines: PlacedLine[];
  /** text that could not fit even at its minimum size; `by` = how far (mm) it runs past the box */
  overflow: { objectId: string; text: string; by: number }[];
}

const ROLE: Record<TextField, PlacedLine["role"]> = {
  heading: "collection", prefix: "prefix", collection: "collection", offer: "big", label: "label", was: "was", footer: "footer", static: "static",
};
export const lineHeight = (pt: number) => pt * 0.3528 * 1.18; // pt -> mm line pitch at normal spacing
const PT = 0.3528; // mm per pt
/** half the height of capital letters (mm): the "ink" of a line, for collision checks */
const capHalf = (pt: number) => pt * PT * 0.36;

/** The text a field prints for this sign, as separately-wrapped segments. */
export function fieldSegments(o: TextObject, sign: Sign, kind: Sign["kind"]): { text: string; role: PlacedLine["role"] }[] {
  const up = (s: string) => (o.uppercase ? s.toUpperCase() : s).trim();
  const seg = (text: string, role = ROLE[o.field]) => (up(text) ? [{ text: up(text), role }] : []);
  switch (o.field) {
    case "heading": return [...seg(sign.prefix, "prefix"), ...seg(sign.collection, "collection")];
    case "prefix": return seg(sign.prefix);
    case "collection": return seg(sign.collection);
    case "offer":
      if (kind === "price") return sign.price ? seg(money(sign.price)) : [];
      return seg(percentText(sign));
    case "label": return kind === "price" ? seg(sign.priceLabel) : [];
    case "was": return kind === "price" && sign.wasPrice ? seg(`WAS ${money(sign.wasPrice)}`) : [];
    case "footer": return seg(sign.footer);
    case "static": return seg(o.text);
  }
}

/**
 * Re-split words into exactly `count` lines so the widest line is as narrow as possible.
 * Greedy wrapping already found the largest size that fits, so this never changes the size,
 * only evens out the shape. Tiny DP: sign text is a handful of words.
 */
export function balanceLines(m: Measure, text: string, size: number, count: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const n = words.length;
  if (count <= 1 || n <= count) return count <= 1 ? [words.join(" ")] : words.slice(0, n);
  const width = (i: number, j: number) => m(words.slice(i, j).join(" "), size);
  // best[k][i] = minimal max-width splitting words[i..] into k lines; cut[k][i] = end of first line
  const best: number[][] = Array.from({ length: count + 1 }, () => new Array(n + 1).fill(Infinity));
  const cut: number[][] = Array.from({ length: count + 1 }, () => new Array(n + 1).fill(n));
  for (let i = 0; i < n; i++) best[1]![i] = width(i, n);
  for (let k = 2; k <= count; k++) {
    for (let i = 0; i <= n - k; i++) {
      for (let j = i + 1; j <= n - k + 1; j++) {
        const v = Math.max(width(i, j), best[k - 1]![j]!);
        // prefer the later cut on ties so the top line is the longer one (reads better)
        if (v < best[k]![i]! - 1e-9 || (Math.abs(v - best[k]![i]!) < 1e-9 && j > cut[k]![i]!)) { best[k]![i] = v; cut[k]![i] = j; }
      }
    }
  }
  const out: string[] = [];
  let i = 0;
  for (let k = count; k >= 1; k--) {
    const j = k === 1 ? n : cut[k]![i]!;
    out.push(words.slice(i, j).join(" "));
    i = j;
  }
  return out;
}

function layoutText(o: TextObject, segments: { text: string; role: PlacedLine["role"] }[], measure: Measure) {
  const m: Measure = (t, s) => measure(t, s, o.weight);
  const min = Math.min(o.minSize, o.size);
  const fit = (cap: number) => {
    let budget = o.maxLines;
    return segments.map((sg, i) => {
      const left = segments.length - i - 1;
      const maxL = Math.max(1, budget - left);
      // largest size at which the words, re-wrapped at that size, fit the width (so lines rebalance as it shrinks)
      let size = cap;
      let lines = wrapWords(m, sg.text, size, o.w, maxL);
      while (size > min && lines.some((l) => m(l, size) > o.w)) {
        size = Math.max(min, size - 0.25);
        lines = wrapWords(m, sg.text, size, o.w, maxL);
      }
      if (o.balance && lines.length > 1) lines = balanceLines(m, sg.text, size, lines.length);
      budget -= lines.length;
      return { lines, size, role: sg.role };
    });
  };
  const ls = o.lineSpacing ?? 1;
  const pitch = (pt: number) => lineHeight(pt) * ls;
  const height = (segs: ReturnType<typeof fit>) => segs.reduce((a, s) => a + s.lines.length * pitch(s.size), 0);
  // what must fit inside the box: every line's pitch, but the last line only counts its own height
  const inked = (segs: ReturnType<typeof fit>) => { const last = segs.at(-1)?.size ?? 0; return height(segs) - (pitch(last) - last * PT); };
  let cap = o.size;
  let segs = fit(cap);
  while (inked(segs) > o.h + 1e-6 && cap > min) {
    cap = Math.max(min, cap - 0.25);
    segs = fit(cap);
  }
  const total = height(segs);
  let y = o.vAlign === "top" ? o.y : o.vAlign === "bottom" ? o.y + o.h - total : o.y + (o.h - total) / 2;
  const lines: PlacedLine[] = [];
  let by = Math.max(0, inked(segs) - o.h);
  for (const sg of segs) {
    for (const text of sg.lines) {
      const lh = pitch(sg.size);
      const w = m(text, sg.size);
      by = Math.max(by, w - o.w);
      const x = o.align === "left" ? o.x : o.align === "right" ? o.x + o.w - w : o.x + (o.w - w) / 2;
      lines.push({
        objectId: o.id, text, sizePt: sg.size, wantPt: o.size, x, w, cy: y + lh / 2, cx: x + w / 2,
        weight: o.weight, color: o.color, strike: o.strike, role: sg.role,
      });
      y += lh;
    }
  }
  return { lines, overflow: by > 0.05, by };
}

/** Place every object of a template for one sign. Pure; `measure(text, pt, weight)` returns mm. */
export function layoutTemplate(t: Template, sign: Sign, measure: Measure): PlacedSign {
  const out: PlacedSign = { lines: [], overflow: [] };
  for (const o of t.objects) {
    if (o.type === "logo") {
      if (!out.logo) out.logo = { box: { x: o.x, y: o.y, w: o.w, h: o.h }, objectId: o.id };
      continue;
    }
    const segs = fieldSegments(o, sign, t.kind);
    if (!segs.length) continue;
    const r = layoutText(o, segs, measure);
    out.lines.push(...r.lines);
    if (r.overflow) out.overflow.push({ objectId: o.id, text: segs.map((s) => s.text).join(" "), by: r.by });
  }
  return out;
}

type Rect = { x: number; y: number; w: number; h: number };
const meets = (a: Rect, b: Rect) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 0.1 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 0.1;
const inkOf = (l: PlacedLine): Rect => ({ x: l.x, y: l.cy - capHalf(l.sizePt), w: l.w, h: capHalf(l.sizePt) * 2 });
/** a little breathing room: text closer than this to something else counts as touching it */
const CLEAR = 0.25;
const grow = (r: Rect): Rect => ({ x: r.x - CLEAR, y: r.y - CLEAR, w: r.w + CLEAR * 2, h: r.h + CLEAR * 2 });

export interface OverflowDetail {
  objectId: string; text: string;
  /** mm past its box */ by: number;
  /** the smallest size it was allowed to shrink to (pt) */ minSize: number;
  /** what the spilled text would print on top of (object labels) */ hits: string[];
  offEdge: boolean; pastMargin: boolean;
  /** it only spills into empty space: prints fine */ harmless: boolean;
}

/**
 * For text that doesn't fit its box: how far it spills, and whether the spill lands on
 * other text, the logo, the sign edge or the holder's margin (harmful) or just on empty space.
 * `logo` = the actually drawn logo rectangle (pass it when the logo is known; otherwise the logo box is used).
 */
export function overflowDetails(t: Template, placed: PlacedSign, logo?: Rect | null): OverflowDetail[] {
  return placed.overflow.map((ov) => {
    const o = t.objects.find((x) => x.id === ov.objectId);
    const mine = placed.lines.filter((l) => l.objectId === ov.objectId).map(inkOf);
    const near = mine.map(grow);
    const hits = new Set<string>();
    for (const l of placed.lines) if (l.objectId !== ov.objectId && near.some((r) => meets(r, inkOf(l)))) {
      const other = t.objects.find((x) => x.id === l.objectId);
      if (other) hits.add(other.type === "text" && other.field === "static" ? label(other) : `the ${label(other).replace(/ \(.*\)$/, "").toLowerCase()}`);
    }
    const logoRect = logo === undefined ? placed.logo?.box : logo;
    if (logoRect && near.some((r) => meets(r, logoRect))) hits.add("the logo");
    const m = t.safeMargin;
    const offEdge = mine.some((r) => r.x < -0.05 || r.y < -0.05 || r.x + r.w > SIGN_W_MM + 0.05 || r.y + r.h > SIGN_H_MM + 0.05);
    const pastMargin = !offEdge && mine.some((r) => r.x < m - 0.05 || r.y < m - 0.05 || r.x + r.w > SIGN_W_MM - m + 0.05 || r.y + r.h > SIGN_H_MM - m + 0.05);
    const minSize = o && o.type === "text" ? Math.min(o.minSize, o.size) : 0;
    return { objectId: ov.objectId, text: ov.text, by: ov.by, minSize, hits: [...hits], offEdge, pastMargin, harmless: !hits.size && !offEdge && !pastMargin };
  });
}

/** Plain-language "what's wrong and what to change" for a spill. `where` names the template. */
export function describeOverflow(d: OverflowDetail, where: string): string {
  const lead = `“${d.text}” is ${d.by.toFixed(1)} mm too big for its box, even at its smallest size (${d.minSize}pt)`;
  if (d.harmless) return `${lead}. The extra only spills into empty space, so it prints fine. To clear this note, make the box taller or wider, or lower its "Smallest" size, in ${where}.`;
  const into = d.offEdge ? "runs off the edge of the sign" : d.hits.length ? `prints over ${d.hits.join(" and ")}` : "goes under the holder's edge (past the safe margin)";
  return `${lead}, and it ${into}. Shorten it, add an abbreviation, or make the box bigger (or its "Smallest" size lower) in ${where}.`;
}

/** Where a background picture lands on the 47x70 mm sign (it may extend past the edge for "cover"; the edge clips it). */
export function backgroundRect(bg: { aspect: number; fit: "cover" | "contain" }): { x: number; y: number; w: number; h: number } {
  const signAspect = SIGN_W_MM / SIGN_H_MM;
  const wide = bg.aspect > signAspect;
  const fillWidth = bg.fit === "cover" ? !wide : wide;
  const w = fillWidth ? SIGN_W_MM : SIGN_H_MM * bg.aspect;
  const h = fillWidth ? SIGN_W_MM / bg.aspect : SIGN_H_MM;
  return { x: (SIGN_W_MM - w) / 2, y: (SIGN_H_MM - h) / 2, w, h };
}

/** Fit a logo of this aspect into the template's logo box, with the brand's scale. */
export function placeLogo(box: { x: number; y: number; w: number; h: number }, aspect: number, scale = 1) {
  return fitLogo(aspect, box, scale);
}

// ---------- designer checks

export interface TemplateIssue { objectId?: string; level: "error" | "warn" | "info"; message: string }
const label = (o: TemplateObject) => (o.type === "logo" ? "Logo" : o.field === "static" ? `“${o.text || "fixed text"}”` : FIELD_LABELS[o.field]);

export function templateIssues(t: Template, sample?: { sign: Sign; measure: Measure; rules?: Rules; templates?: Template[]; logo?: { aspect: number; scale: number } | null }): TemplateIssue[] {
  const out: TemplateIssue[] = [];
  const m = t.safeMargin;
  const ids = new Set<string>();
  for (const o of t.objects) {
    if (ids.has(o.id)) out.push({ objectId: o.id, level: "error", message: `Two objects share the id "${o.id}".` });
    ids.add(o.id);
    const off = o.x + o.w <= 0 || o.y + o.h <= 0 || o.x >= SIGN_W_MM || o.y >= SIGN_H_MM;
    if (off) out.push({ objectId: o.id, level: "error", message: `${label(o)} is off the paper.` });
    else if (o.x < m - 0.01 || o.y < m - 0.01 || o.x + o.w > SIGN_W_MM - m + 0.01 || o.y + o.h > SIGN_H_MM - m + 0.01) {
      out.push({ objectId: o.id, level: "warn", message: `${label(o)} goes past the ${m} mm safe margin; the holder may cover it.` });
    }
    if (o.type === "text" && o.field === "static" && !o.text.trim()) out.push({ objectId: o.id, level: "warn", message: "A fixed-text object has no text." });
  }
  if (t.objects.filter((o) => o.type === "logo").length > 1) out.push({ level: "warn", message: "Only the first logo box is used." });
  if (!t.objects.some((o) => o.type === "text" && o.field === "offer")) out.push({ level: "info", message: `No offer object: these signs won't show the ${t.kind === "price" ? "price" : "percent"}.` });
  for (let i = 0; i < t.objects.length; i++) {
    for (let j = i + 1; j < t.objects.length; j++) {
      const a = t.objects[i]!, b = t.objects[j]!;
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (ox > 0.5 && oy > 0.5) out.push({ objectId: b.id, level: "info", message: `${label(a)} and ${label(b)} overlap.` });
    }
  }
  if (t.fallbackId === t.id) out.push({ level: "warn", message: "A template can't fall back to itself." });
  if (t.background && t.background.opacity > 0.5) {
    out.push({ level: "warn", message: `The background prints at ${Math.round(t.background.opacity * 100)}% strength. Above about 40% the text gets hard to read; try 20-35%.` });
  }
  if (sample) {
    const rules = sample.rules ?? DEFAULT_RULES;
    const here = fitSign(sample.sign, [t], sample.measure, rules, { template: t, noFallback: true });
    const placed = here.placed;
    if (here.abbreviations.length) out.push({ level: "info", message: `Shortened to stay at ${here.min}pt+: ${here.abbreviations.map((a) => `${a.from} → ${a.to}`).join(", ")}.` });
    if (here.belowMin.length) {
      const all = fitSign(sample.sign, [t, ...(sample.templates ?? []).filter((x) => x.id !== t.id)], sample.measure, rules, { template: t });
      if (all.switchedFrom && !all.belowMin.length) out.push({ level: "info", message: `Too small here, so these signs print with “${all.template.name}” instead.` });
      else for (const l of here.belowMin) out.push({ objectId: l.objectId, level: "warn", message: `“${l.text}” prints at ${l.sizePt.toFixed(1)}pt, below the ${here.min}pt readable minimum.` });
    }
    const logo = sample.logo && placed.logo ? fitLogo(sample.logo.aspect, placed.logo.box, sample.logo.scale) : undefined;
    for (const d of overflowDetails(t, placed, logo)) out.push({ objectId: d.objectId, level: d.harmless ? "info" : "warn", message: describeOverflow(d, "this template") });
    const shrunk = new Set(placed.lines.filter((l) => l.sizePt < l.wantPt - 0.01).map((l) => l.objectId));
    for (const id of shrunk) {
      const o = t.objects.find((x) => x.id === id);
      if (o && !placed.overflow.some((x) => x.objectId === id)) out.push({ objectId: id, level: "info", message: `${label(o)} shrinks to fit this sample text.` });
    }
  }
  return out;
}

export const newObjectId = (t: Template, base: string) => {
  let n = 1;
  while (t.objects.some((o) => o.id === `${base}-${n}`)) n++;
  return `${base}-${n}`;
};

// ---------- auto-fit: readable minimum -> abbreviations -> fallback template

export const effectiveMin = (t: Template, rules: Rules) => t.readableMin ?? rules.readableMin;

/** Lines that shrank below the readable minimum. Text designed smaller on purpose (e.g. an 8pt footer) isn't flagged. */
export function belowMin(placed: PlacedSign, min: number): PlacedLine[] {
  return placed.lines.filter((l) => l.sizePt < min - 1e-6 && l.sizePt < l.wantPt - 1e-6);
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Replace `from` as a whole word/phrase, case-insensitively. Returns the text unchanged if absent. */
export function applyAbbreviation(text: string, a: Abbreviation): string {
  const re = new RegExp(`(^|[^\\p{L}\\p{N}])${esc(a.from.trim())}(?=$|[^\\p{L}\\p{N}])`, "giu");
  return text.replace(re, (_m, pre: string) => pre + a.to).replace(/\s{2,}/g, " ").trim();
}

export interface FittedSign {
  template: Template;
  /** the sign as printed (collection / lead word may be abbreviated) */
  sign: Sign;
  placed: PlacedSign;
  abbreviations: Abbreviation[];
  /** set when the sign moved to a fallback template */
  switchedFrom?: Template;
  belowMin: PlacedLine[];
  min: number;
}

function tryTemplate(t: Template, sign: Sign, measure: Measure, rules: Rules): FittedSign {
  const min = effectiveMin(t, rules);
  let s = sign;
  let placed = layoutTemplate(t, s, measure);
  const used: Abbreviation[] = [];
  if (belowMin(placed, min).length) {
    // biggest savings first, one at a time, stop as soon as everything is readable
    const ordered = [...rules.abbreviations].filter((a) => a.from.trim()).sort((a, b) => (b.from.length - b.to.length) - (a.from.length - a.to.length));
    for (const a of ordered) {
      const next = { ...s, collection: applyAbbreviation(s.collection, a), prefix: applyAbbreviation(s.prefix, a) };
      if (next.collection === s.collection && next.prefix === s.prefix) continue;
      s = next; used.push(a);
      placed = layoutTemplate(t, s, measure);
      if (!belowMin(placed, min).length) break;
    }
  }
  return { template: t, sign: s, placed, abbreviations: used, belowMin: belowMin(placed, min), min };
}
const worst = (f: FittedSign) => (f.belowMin.length ? Math.min(...f.belowMin.map((l) => l.sizePt)) : Infinity);

/**
 * Decide how a sign prints: its template as-is; else with abbreviations; else its fallback
 * template(s) (same kind, up to 3 deep), each with abbreviations. If nothing reaches the
 * readable minimum, the attempt with the largest smallest-line wins (and gets flagged).
 */
export function fitSign(
  sign: Sign, templates: Template[], measure: Measure, rules: Rules = DEFAULT_RULES,
  opts: { template?: Template; noFallback?: boolean } = {},
): FittedSign {
  const primary = opts.template ?? resolveTemplate(sign, templates);
  const chain = [primary];
  if (!opts.noFallback) {
    let t = primary;
    while (t.fallbackId && chain.length < 4) {
      const n = templates.find((x) => x.id === t.fallbackId);
      if (!n || n.kind !== primary.kind || chain.some((c) => c.id === n.id)) break;
      chain.push(n); t = n;
    }
  }
  let best: FittedSign | null = null;
  for (const [i, t] of chain.entries()) {
    const r = tryTemplate(t, sign, measure, rules);
    if (i > 0) r.switchedFrom = primary;
    if (!r.belowMin.length) return r;
    if (!best || worst(r) > worst(best) + 0.01) best = r;
  }
  return best!;
}
