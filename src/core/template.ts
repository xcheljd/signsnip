import { fitLogo, money, percentText, wrapWords, type Measure } from "./layout.js";
import {
  SIGN_H_MM, SIGN_W_MM, type LogoObject, type Sign, type Template, type TemplateObject, type TextField, type TextObject,
} from "./types.js";

// ---------- built-in templates (match the original spreadsheet layout)

const T = (o: Partial<TextObject> & Pick<TextObject, "id" | "field" | "x" | "y" | "w" | "h" | "size">): TextObject => ({
  type: "text", text: "", minSize: 7, weight: "bold", align: "center", vAlign: "middle", maxLines: 1,
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
  /** text that could not fit even at its minimum size */
  overflow: { objectId: string; text: string }[];
}

const ROLE: Record<TextField, PlacedLine["role"]> = {
  heading: "collection", prefix: "prefix", collection: "collection", offer: "big", label: "label", was: "was", footer: "footer", static: "static",
};
export const lineHeight = (pt: number) => pt * 0.3528 * 1.18; // pt -> mm line pitch

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
      budget -= lines.length;
      return { lines, size, role: sg.role };
    });
  };
  const height = (segs: ReturnType<typeof fit>) => segs.reduce((a, s) => a + s.lines.length * lineHeight(s.size), 0);
  // what must fit inside the box: every line's pitch except the trailing leading under the last line
  const inked = (segs: ReturnType<typeof fit>) => height(segs) - 0.18 * 0.3528 * (segs.at(-1)?.size ?? 0);
  let cap = o.size;
  let segs = fit(cap);
  while (inked(segs) > o.h + 1e-6 && cap > min) {
    cap = Math.max(min, cap - 0.25);
    segs = fit(cap);
  }
  const total = height(segs);
  let y = o.vAlign === "top" ? o.y : o.vAlign === "bottom" ? o.y + o.h - total : o.y + (o.h - total) / 2;
  const lines: PlacedLine[] = [];
  let overflow = inked(segs) > o.h + 0.05;
  for (const sg of segs) {
    for (const text of sg.lines) {
      const lh = lineHeight(sg.size);
      const w = m(text, sg.size);
      if (w > o.w + 0.05) overflow = true;
      const x = o.align === "left" ? o.x : o.align === "right" ? o.x + o.w - w : o.x + (o.w - w) / 2;
      lines.push({
        objectId: o.id, text, sizePt: sg.size, wantPt: o.size, x, w, cy: y + lh / 2, cx: x + w / 2,
        weight: o.weight, color: o.color, strike: o.strike, role: sg.role,
      });
      y += lh;
    }
  }
  return { lines, overflow };
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
    if (r.overflow) out.overflow.push({ objectId: o.id, text: segs.map((s) => s.text).join(" ") });
  }
  return out;
}

/** Fit a logo of this aspect into the template's logo box, with the brand's scale. */
export function placeLogo(box: { x: number; y: number; w: number; h: number }, aspect: number, scale = 1) {
  return fitLogo(aspect, box, scale);
}

// ---------- designer checks

export interface TemplateIssue { objectId?: string; level: "error" | "warn" | "info"; message: string }
const label = (o: TemplateObject) => (o.type === "logo" ? "Logo" : o.field === "static" ? `“${o.text || "fixed text"}”` : FIELD_LABELS[o.field]);

export function templateIssues(t: Template, sample?: { sign: Sign; measure: Measure }): TemplateIssue[] {
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
  if (sample) {
    const placed = layoutTemplate(t, sample.sign, sample.measure);
    for (const ov of placed.overflow) out.push({ objectId: ov.objectId, level: "warn", message: `“${ov.text}” doesn't fit its box even at the minimum size.` });
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
