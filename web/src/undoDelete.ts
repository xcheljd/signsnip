import type { Abbreviation } from "../../src/core/types";

/**
 * Undo for one-tap deletes that are not batch edits (presets, saved batches, abbreviations).
 * The toast keeps the deleted value; Undo puts exactly that back and touches nothing else.
 */

/**
 * `item` back at `index` (or at the end if the list got shorter), or null when the list already
 * has one that `same` says is the same thing (it was added again since): then nothing is put back.
 */
export function putBack<T>(list: T[], index: number, item: T, same: (a: T, b: T) => boolean): T[] | null {
  if (list.some((x) => same(x, item))) return null;
  const at = Math.max(0, Math.min(Math.floor(index), list.length));
  return [...list.slice(0, at), item, ...list.slice(at)];
}

/** Abbreviations are one per word, whatever the capitals (writeRules keeps the last one). */
export const sameWord = (a: Abbreviation, b: Abbreviation) => a.from.trim().toLowerCase() === b.from.trim().toLowerCase();
