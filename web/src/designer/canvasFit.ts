/**
 * Designer canvas geometry, kept free of the DOM so it can be unit-tested.
 * The canvas SVG shows the 47 x 70 mm sign plus CANVAS_PAD_MM of room on every side (for handles).
 */
import { SIGN_H_MM, SIGN_W_MM } from "../../../src/core/types";

export const CANVAS_PAD_MM = 4;
/** viewBox size in mm */
export const VIEW_W_MM = SIGN_W_MM + CANVAS_PAD_MM * 2;
export const VIEW_H_MM = SIGN_H_MM + CANVAS_PAD_MM * 2;
/** never larger than the old fixed canvas (560 px wide, 794 px tall) */
export const CANVAS_MAX_W = 560;
/** never smaller than this tall, even on a short window (the page scrolls instead) */
export const CANVAS_MIN_H = 300;
/** from this viewport width up the canvas also fits the window's height; narrower (phone) it only fits the width */
export const FIT_HEIGHT_FROM = 768;

export interface CanvasFitInput {
  viewportW: number;
  viewportH: number;
  /** width the canvas may use (its holder, inside the card) */
  holderW: number;
  /** px from the top of the page to the top of the canvas when the page is scrolled to the top
   *  (sticky app header + page padding + everything in the canvas card above the canvas) */
  above: number;
  /** px to keep free under the canvas (holder padding + a small margin) */
  below: number;
  fitHeightFrom?: number;
}

export interface CanvasFit {
  /** SVG size in CSS px */
  width: number;
  height: number;
  /** CSS px per mm */
  scale: number;
  /** what limited the size */
  by: "width" | "height" | "max" | "min";
}

/** Size of the designer canvas: as large as the width and (from tablets up) the height allow, keeping the sign's ratio. */
export function canvasFit({ viewportW, viewportH, holderW, above, below, fitHeightFrom = FIT_HEIGHT_FROM }: CanvasFitInput): CanvasFit {
  const wFromH = (h: number) => (h * VIEW_W_MM) / VIEW_H_MM;
  const byWidth = Math.max(0, holderW);
  const byHeight = viewportW >= fitHeightFrom ? wFromH(viewportH - above - below) : Infinity;
  let width = Math.min(byWidth, byHeight, CANVAS_MAX_W);
  let by: CanvasFit["by"] = width === CANVAS_MAX_W ? "max" : width === byHeight ? "height" : "width";
  const minW = wFromH(CANVAS_MIN_H);
  // the minimum wins over the height, but never makes the canvas wider than its holder (no sideways scroll)
  if (width < minW && byWidth > width) { width = Math.min(minW, byWidth); by = "min"; }
  width = Math.floor(width);
  const scale = width / VIEW_W_MM;
  return { width, height: scale * VIEW_H_MM, scale, by };
}

/** Resize-handle sizes in CSS px for an object drawn wPx x hPx on screen. */
export const HANDLE_FINE = 8;
export const HANDLE_COARSE = 13;
export const TOUCH_HIT = 44;
export function handleSizes(wPx: number, hPx: number, coarse: boolean): { visual: number; hit: number } {
  if (!coarse) return { visual: HANDLE_FINE, hit: HANDLE_FINE };
  // neighbouring handles sit half the shorter side apart: hit areas no bigger than that never overlap,
  // and leave the middle of the object free for dragging it by its body
  const room = Math.min(wPx, hPx) / 2;
  return { visual: Math.min(HANDLE_COARSE, Math.max(6, room)), hit: Math.max(0, Math.min(TOUCH_HIT, room)) };
}
