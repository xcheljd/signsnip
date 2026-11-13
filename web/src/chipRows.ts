/**
 * The preset chips show at most two rows. Chips have different widths, so the cut-off comes from
 * the measured widths: lay them out the way CSS flex-wrap does (an item that doesn't fit on the
 * current row starts the next one) and count. Pure, so it can be tested without a browser.
 */

/** How many rows items of these widths take in a flex-wrap line `line` px wide with `gap` px between them. */
export function rowsFor(widths: number[], line: number, gap: number): number {
  let rows = 0, x = 0;
  for (const w of widths) {
    if (rows === 0) { rows = 1; x = w; continue; }
    if (x + gap + w > line) { rows++; x = w; } else x += gap + w;
  }
  return rows;
}

/**
 * How many chips to show: all of them when `lead` (the "Presets" label) and every chip fit in
 * `rows` rows; otherwise the most that still fit together with the `more` control
 * ("Show all 16 presets") at the end of the last row. Never a chip cut in half: a chip is either
 * shown whole or not at all.
 */
export function chipsThatFit(o: { line: number; gap: number; lead: number; chips: number[]; more: number; rows?: number }): number {
  const rows = o.rows ?? 2;
  // a hair of room for sub-pixel rounding, so the browser never wraps a chip the sum said fits
  const line = o.line - 1;
  if (rowsFor([o.lead, ...o.chips], line, o.gap) <= rows) return o.chips.length;
  for (let k = o.chips.length - 1; k > 0; k--) {
    if (rowsFor([o.lead, ...o.chips.slice(0, k), o.more], line, o.gap) <= rows) return k;
  }
  return 0;
}
