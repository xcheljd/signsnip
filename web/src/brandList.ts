import { fitLogo } from "../../src/core/layout";
import type { BrandWithLogo } from "./api";

/**
 * The Brands & logos tab is a compact list with at most one brand editor open. These decide,
 * without the DOM, which brands the list shows, which editor is open after a tap, and which
 * problem badges a row carries. Tested in tests/brand-list.test.ts.
 */

/** the search box appears once the list is longer than this */
export const SEARCH_AFTER = 6;
export const showBrandSearch = (brands: number) => brands > SEARCH_AFTER;

/**
 * Brands whose name contains `query` (any capitals, spaces around it ignored); an empty query
 * shows them all. `keepId` (the open editor while it holds text that isn't stored: typed and
 * not saved yet, or refused) is never filtered away, so an edit can't vanish behind a search.
 */
export function filterBrands<T extends { id: string; name: string }>(brands: T[], query: string, keepId: string | null): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return brands;
  return brands.filter((b) => b.id === keepId || b.name.toLowerCase().includes(q));
}

/** What the open editor said when asked to save before it closes. */
export interface EditorFlush {
  /** it still holds text that isn't stored (a save failed, e.g. a name another brand has) */
  pending: boolean;
  /** an edit was refused (an empty name, or a failed save) by this switch, or just before it (refusedJustNow) */
  refused: boolean;
}

/**
 * Which brand is open after asking for `want` (null = close the open one). The open editor has
 * saved first (`flush`; null when no editor is open). It stays open while it holds unsaved text or
 * has just refused an edit, so the person sees the error instead of losing the edit.
 */
export function nextOpen(open: string | null, want: string | null, flush: EditorFlush | null): string | null {
  if (open && flush && (flush.pending || flush.refused)) return open;
  return want;
}

/**
 * A refusal belongs to the tap that is switching rows when it happened during that switch or just
 * before it (the name box loses focus a moment before the tap lands). An older one was already on
 * screen: the editor showed its error, so the next tap may close it. A refusal that moved the page (the
 * error line appeared) can make the browser drop the tap itself; the next tap then still gets through.
 */
export const REFUSAL_WINDOW_MS = 1000;
export const refusedJustNow = (refusedAt: number, now: number) => refusedAt > 0 && now - refusedAt < REFUSAL_WINDOW_MS;

/** A tap on a row: opens it, or closes it when it is the open one. */
export const tapTarget = (open: string | null, row: string): string | null => (open === row ? null : row);

/** below this a logo may print soft (the same line the brand editor and the checks draw) */
export const LOW_DPI = 250;

/** How sharp the logo prints at the brand's size on the sign (0 without a logo). */
export function printedDpi(b: Pick<BrandWithLogo, "logo" | "logoScale">, scale = b.logoScale): number {
  const logo = b.logo;
  return logo ? Math.round(logo.width / (fitLogo(logo.aspect, undefined, scale).w / 25.4)) : 0;
}

/** The problem badges a brand row shows: the same words the open editor shows for them. */
export function brandProblems(b: Pick<BrandWithLogo, "logo" | "logoScale">): string[] {
  if (!b.logo) return ["no logo"];
  const out: string[] = [];
  const dpi = printedDpi(b);
  if (dpi < LOW_DPI) out.push(`~${dpi} dpi printed`);
  if (b.logo.background === "solid") out.push("solid background");
  return out;
}
