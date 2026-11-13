import { pageFill } from "../../src/core/geometry";
import { count } from "../../src/core/words";

/**
 * The one-line page meter under the batch table: how many pages print and how full the last one is,
 * plus the one thing worth doing about it (fill the last page with copies of the last row).
 * Pure, so it is tested without a browser (tests/page-meter.test.ts).
 */
export interface PageMeter {
  /** "20 pages · last page 7 of 10 filled" */
  text: string;
  /** the Fill button, when the last page has empty slots */
  fill: { more: number; row: number; label: string; undo: string } | null;
}

/** `signs` = copies in the batch, `rows` = rows in the batch (the last one gets the extra copies). Empty batch = no meter. */
export function pageMeter(signs: number, perPage: number, rows: number): PageMeter | null {
  if (signs <= 0 || rows <= 0) return null;
  const { pages, lastUsed } = pageFill(signs, perPage);
  const more = perPage - lastUsed;
  const full = more === 0;
  const text = pages === 1
    ? `1 page · ${full ? `all ${perPage} slots filled` : `${lastUsed} of ${perPage} slots filled`}`
    : `${count(pages, "page")} · ${full ? "every page full" : `last page ${lastUsed} of ${perPage} filled`}`;
  return {
    text,
    fill: full ? null : {
      more, row: rows,
      label: `Fill the ${pages === 1 ? "page" : "last page"}: ${count(more, "more copy", "more copies")} of row ${rows}`,
      // the Undo toast says what it said before the meter became one line
      undo: `Filled page ${pages} with ${more} more of row ${rows}`,
    },
  };
}
