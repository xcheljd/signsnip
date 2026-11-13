/**
 * The print-sheet preview shows one page at a time once the batch has more than two pages
 * (Previous / Next, "Page 3 of 20"), unless "Show all pages" is on. These decide, without the DOM,
 * whether it pages and which page shows. Tested in tests/sheet-pager.test.ts.
 */

/** localStorage key: "Show all pages" was switched on */
export const ALL_PAGES_KEY = "signsnip.sheetAllPages";

/** One page at a time only for 3 pages or more; 1-2 pages always show as before. */
export const pagesOneAtATime = (pages: number, showAll: boolean) => pages > 2 && !showAll;

/** A page index that exists (0 for an empty sheet). */
export const clampPage = (page: number, pages: number) => Math.max(0, Math.min(Math.floor(page), pages - 1));

/**
 * The page a batch row's first copy prints on (rows fill the sheet in order, each copy one slot).
 * A row past the end (e.g. one about to be added) gets the page its first copy would land on.
 */
export function pageOfRow(copies: number[], row: number, perPage: number): number {
  let slot = 0;
  for (let i = 0; i < Math.min(row, copies.length); i++) slot += Math.max(0, copies[i]!);
  return Math.floor(slot / perPage);
}
