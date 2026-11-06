import { SIGN_W_MM, type Sign } from "./types.js";

/** Measures text width in millimetres at a given font size (pt). Injected so layout is testable. */
export type Measure = (text: string, sizePt: number) => number;

export interface TextLine {
  text: string;
  sizePt: number;
  /** size the line wanted before shrink-to-fit */
  wantPt: number;
  /** centre x/y in mm from the sign's top-left corner */
  cx: number;
  cy: number;
  strike?: boolean;
  role: "prefix" | "collection" | "big" | "label" | "was" | "footer";
}
export interface SignLayout {
  logoBox: { x: number; y: number; w: number; h: number };
  lines: TextLine[];
}

const PAD = 4; // mm side padding
export const MAX_TEXT_W = SIGN_W_MM - PAD * 2;
export const LOGO_BOX = { x: PAD, y: 5, w: SIGN_W_MM - PAD * 2, h: 15 };
/** Hard limits a scaled-up logo may grow into (keeps clear of the header text). */
export const LOGO_MAX = { x: 2.5, y: 3, w: SIGN_W_MM - 5, h: 18 };

/** Largest size <= want (and >= min) at which `text` fits in maxW. */
export function fitSize(measure: Measure, text: string, want: number, maxW: number, min = 7): number {
  let s = want;
  while (s > min && measure(text, s) > maxW) s -= 0.25;
  return Math.max(s, min);
}

/** Greedy word wrap into at most maxLines lines (last line may overflow -> shrink handles it). */
export function wrapWords(measure: Measure, text: string, size: number, maxW: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  if (measure(text, size) <= maxW) return [text];
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (cur && measure(next, size) > maxW && lines.length < maxLines - 1) {
      lines.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

/**
 * Contain-fit an image of aspect ratio (w/h) into the logo box, centred, then apply the
 * brand's scale. Growth is clamped to LOGO_MAX so it never collides with the text.
 */
export function fitLogo(aspect: number, box = LOGO_BOX, scale = 1) {
  let w = box.w;
  let h = w / aspect;
  if (h > box.h) {
    h = box.h;
    w = h * aspect;
  }
  w *= scale; h *= scale;
  const k = Math.min(1, LOGO_MAX.w / w, LOGO_MAX.h / h);
  w *= k; h *= k;
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  return { x: cx - w / 2, y: Math.max(LOGO_MAX.y, cy - h / 2), w, h };
}

/** Largest useful scale for a logo of this shape (beyond it, LOGO_MAX clamps and nothing changes). */
export function maxLogoScale(aspect: number, box = LOGO_BOX): number {
  const base = fitLogo(aspect, box, 1);
  return Math.max(1, Math.floor(Math.min(1.6, LOGO_MAX.w / base.w, LOGO_MAX.h / base.h) * 20) / 20);
}

export const percentText = (s: Pick<Sign, "percent" | "offLabel">) =>
  `${s.percent}% ${s.offLabel}`.trim().toUpperCase();

/** $1,295 / $199.99 / $49.50 */
export function money(n: number): string {
  const cents = Math.round(n * 100) % 100 !== 0;
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: 2 });
}

const lh = (pt: number) => pt * 0.3528 * 1.18; // pt -> mm line pitch

/** Compute every text line's size and position. Pure. */
export function layoutSign(sign: Sign, measure: Measure): SignLayout {
  const lines: TextLine[] = [];
  const cx = SIGN_W_MM / 2;
  const prefix = sign.prefix.trim().toUpperCase();
  const collection = sign.collection.trim().toUpperCase();
  const kind = sign.kind ?? "percent";

  // --- header block (prefix + collection), vertically centred on y=28mm
  const HEAD = 14;
  const head: Omit<TextLine, "cx" | "cy">[] = [];
  if (prefix) head.push({ text: prefix, sizePt: fitSize(measure, prefix, HEAD, MAX_TEXT_W), wantPt: HEAD, role: "prefix" });
  if (collection) {
    const wrapped = wrapWords(measure, collection, HEAD, MAX_TEXT_W, 2);
    const size = Math.min(...wrapped.map((l) => fitSize(measure, l, HEAD, MAX_TEXT_W)));
    for (const l of wrapped) head.push({ text: l, sizePt: size, wantPt: HEAD, role: "collection" });
  }
  // price signs with a label/was line need the header a touch higher
  const busy = kind === "price" && (sign.priceLabel.trim() || sign.wasPrice);
  const centre = busy ? 27 : 28;
  const total = head.reduce((a, l) => a + lh(l.sizePt), 0);
  let y = centre - total / 2;
  for (const l of head) {
    lines.push({ ...l, cx, cy: y + lh(l.sizePt) / 2 });
    y += lh(l.sizePt);
  }

  if (kind === "price" && sign.price) {
    const label = sign.priceLabel.trim().toUpperCase();
    const big = money(sign.price);
    const was = sign.wasPrice ? `WAS ${money(sign.wasPrice)}` : "";
    if (label) lines.push({ text: label, sizePt: fitSize(measure, label, 11, MAX_TEXT_W), wantPt: 11, cx, cy: 39.5, role: "label" });
    lines.push({ text: big, sizePt: fitSize(measure, big, 30, MAX_TEXT_W, 14), wantPt: 30, cx, cy: label ? 47 : 46, role: "big" });
    if (was) lines.push({ text: was, sizePt: fitSize(measure, was, 11, MAX_TEXT_W), wantPt: 11, cx, cy: 55, strike: true, role: "was" });
  } else {
    const pct = percentText(sign);
    lines.push({ text: pct, sizePt: fitSize(measure, pct, 30, MAX_TEXT_W, 14), wantPt: 30, cx, cy: 46, role: "big" });
  }

  const footer = sign.footer.trim();
  if (footer) lines.push({ text: footer, sizePt: fitSize(measure, footer, 13, MAX_TEXT_W, 8), wantPt: 13, cx, cy: 62, role: "footer" });

  return { logoBox: LOGO_BOX, lines };
}

/** Lines that had to shrink enough to hurt readability across a shop floor. */
export function smallLines(l: SignLayout): TextLine[] {
  return l.lines.filter((t) => (t.role === "big" ? t.sizePt < 22 : t.sizePt < Math.min(10, t.wantPt * 0.72)));
}
