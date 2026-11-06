import { SIGN_H_MM, SIGN_W_MM, type Sign } from "./types.js";

/** Measures text width in millimetres at a given font size (pt). Injected so layout is testable. */
export type Measure = (text: string, sizePt: number) => number;

export interface TextLine {
  text: string;
  sizePt: number;
  /** centre x/y in mm from the sign's top-left corner */
  cx: number;
  cy: number;
}
export interface SignLayout {
  logoBox: { x: number; y: number; w: number; h: number };
  lines: TextLine[];
}

const PAD = 4; // mm side padding
export const MAX_TEXT_W = SIGN_W_MM - PAD * 2;
export const LOGO_BOX = { x: PAD, y: 5, w: SIGN_W_MM - PAD * 2, h: 15 };

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

/** Contain-fit an image of aspect ratio (w/h) into the logo box, centred. Never upscales past `maxUpscale` x. */
export function fitLogo(aspect: number, box = LOGO_BOX) {
  let w = box.w;
  let h = w / aspect;
  if (h > box.h) {
    h = box.h;
    w = h * aspect;
  }
  return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
}

export const percentText = (s: Pick<Sign, "percent" | "offLabel">) =>
  `${s.percent}% ${s.offLabel}`.trim().toUpperCase();

/** Compute every text line's size and position. Pure. */
export function layoutSign(sign: Sign, measure: Measure): SignLayout {
  const lines: TextLine[] = [];
  const prefix = sign.prefix.trim().toUpperCase();
  const collection = sign.collection.trim().toUpperCase();

  // --- header block (prefix + collection), vertically centred on y=28mm
  const HEAD = 14;
  const headLines: { text: string; sizePt: number }[] = [];
  if (prefix) headLines.push({ text: prefix, sizePt: fitSize(measure, prefix, HEAD, MAX_TEXT_W) });
  if (collection) {
    const wrapped = wrapWords(measure, collection, HEAD, MAX_TEXT_W, 2);
    const size = Math.min(...wrapped.map((l) => fitSize(measure, l, HEAD, MAX_TEXT_W)));
    for (const l of wrapped) headLines.push({ text: l, sizePt: size });
  }
  const lh = (pt: number) => pt * 0.3528 * 1.18; // pt -> mm line pitch
  const total = headLines.reduce((a, l) => a + lh(l.sizePt), 0);
  let y = 28 - total / 2;
  for (const l of headLines) {
    lines.push({ ...l, cx: SIGN_W_MM / 2, cy: y + lh(l.sizePt) / 2 });
    y += lh(l.sizePt);
  }

  // --- big percent
  const pct = percentText(sign);
  lines.push({ text: pct, sizePt: fitSize(measure, pct, 30, MAX_TEXT_W, 14), cx: SIGN_W_MM / 2, cy: 46 });

  // --- footer
  const footer = sign.footer.trim();
  if (footer) lines.push({ text: footer, sizePt: fitSize(measure, footer, 13, MAX_TEXT_W, 8), cx: SIGN_W_MM / 2, cy: 62 });

  return { logoBox: LOGO_BOX, lines };
}
