import { useEffect, useState } from "react";
import "@fontsource/carlito/400.css";
import "@fontsource/carlito/700.css";
import type { Measure } from "../../../src/core/layout";

/**
 * Text measuring in the browser with the same Carlito font the PDF embeds, so the designer's
 * live canvas wraps and shrinks text exactly like the printed sign.
 */
const ctx = typeof document !== "undefined" ? document.createElement("canvas").getContext("2d") : null;
export const browserMeasure: Measure = (text, pt, weight = "bold") => {
  if (!ctx) return text.length * pt * 0.2;
  ctx.font = `${weight === "bold" ? 700 : 400} ${pt}pt Carlito`;
  return (ctx.measureText(text).width * 25.4) / 96;
};

let ready: Promise<void> | null = null;
export function loadSignFonts(): Promise<void> {
  ready ??= Promise.all([document.fonts.load("700 12pt Carlito"), document.fonts.load("400 12pt Carlito")]).then(() => undefined);
  return ready;
}
/** true once Carlito is loaded (measuring before that would use a fallback font's widths) */
export function useSignFonts(): boolean {
  const [ok, setOk] = useState(false);
  useEffect(() => { let live = true; loadSignFonts().then(() => live && setOk(true)); return () => { live = false; }; }, []);
  return ok;
}
