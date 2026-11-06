import { SIGN_W_MM, type Sign } from "./types.js";
import { defaultTemplate, layoutTemplate, type PlacedLine, type PlacedSign } from "./template.js";

/** Measures text width in millimetres at a given font size (pt). Injected so layout is testable. */
export type Measure = (text: string, sizePt: number, weight?: "bold" | "regular") => number;

const PAD = 4; // mm side padding
export const MAX_TEXT_W = SIGN_W_MM - PAD * 2;
export const LOGO_BOX = { x: PAD, y: 5, w: SIGN_W_MM - PAD * 2, h: 15 };
/** How far a scaled-up logo may grow past its box (mm): 1.5 each side, 3 in height. */
export const growArea = (box: { x: number; y: number; w: number; h: number }) => {
  const x = Math.max(0, box.x - 1.5), y = Math.max(0, box.y - 2);
  return { x, y, w: Math.min(SIGN_W_MM - x, box.w + 3), h: box.h + 3 };
};
/** Hard limits a scaled-up logo in the default box may grow into (keeps clear of the header text). */
export const LOGO_MAX = growArea(LOGO_BOX);

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
  const max = growArea(box);
  const k = Math.min(1, max.w / w, max.h / h);
  w *= k; h *= k;
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  return { x: cx - w / 2, y: Math.max(max.y, cy - h / 2), w, h };
}

/** Largest useful scale for a logo of this shape (beyond it, LOGO_MAX clamps and nothing changes). */
export function maxLogoScale(aspect: number, box = LOGO_BOX): number {
  const base = fitLogo(aspect, box, 1);
  const max = growArea(box);
  return Math.max(1, Math.floor(Math.min(1.6, max.w / base.w, max.h / base.h) * 20) / 20);
}

export const percentText = (s: Pick<Sign, "percent" | "offLabel">) =>
  `${s.percent}% ${s.offLabel}`.trim().toUpperCase();

/** $1,295 / $199.99 / $49.50 */
export function money(n: number): string {
  const cents = Math.round(n * 100) % 100 !== 0;
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: 2 });
}

/** Lay out a sign with its kind's built-in template (kept for callers that don't pass templates). */
export function layoutSign(sign: Sign, measure: Measure) {
  return layoutTemplate(defaultTemplate(sign.kind ?? "percent"), sign, measure);
}

/** Lines that had to shrink enough to hurt readability across a shop floor. */
export function smallLines(l: PlacedSign): PlacedLine[] {
  return l.lines.filter((t) => t.sizePt < t.wantPt * 0.72);
}
