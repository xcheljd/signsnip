import { SIGN_H_MM, SIGN_W_MM, type Grid, type Options, type Paper } from "./types.js";

/** Pure sheet geometry, shared by the PDF renderer and the web UI's click/drag overlay. */
export const PAPER_MM: Record<Paper, readonly [number, number]> = { letter: [215.9, 279.4], a4: [210, 297] };
export const GRIDS: Record<Grid, { cols: number; rows: number; landscape: boolean }> = {
  "landscape-5x2": { cols: 5, rows: 2, landscape: true },
  "portrait-4x3": { cols: 4, rows: 3, landscape: false },
};

export interface SheetGeometry {
  pageW: number; pageH: number; // mm
  cols: number; rows: number; perPage: number;
  left: number; top: number; // grid origin, mm from page top-left
}

export function sheetGeometry(o: Pick<Options, "grid" | "paper">): SheetGeometry {
  const g = GRIDS[o.grid];
  const [pw0, ph0] = PAPER_MM[o.paper];
  const [pageW, pageH] = g.landscape ? [ph0, pw0] : [pw0, ph0];
  return {
    pageW, pageH, cols: g.cols, rows: g.rows, perPage: g.cols * g.rows,
    left: (pageW - g.cols * SIGN_W_MM) / 2, top: (pageH - g.rows * SIGN_H_MM) / 2,
  };
}

/** Cell rectangle (mm, page top-left origin) for slot i on a page. */
export function cellRect(g: SheetGeometry, slot: number) {
  const col = slot % g.cols, row = Math.floor(slot / g.cols);
  return { x: g.left + col * SIGN_W_MM, y: g.top + row * SIGN_H_MM, w: SIGN_W_MM, h: SIGN_H_MM };
}

/** For each printed slot, which batch item it came from (copies expanded, in order). */
export function slotOwners(copies: number[]): number[] {
  return copies.flatMap((n, i) => Array.from({ length: n }, () => i));
}

/** The most pages one batch can print. Past this, split into separate saved batches. */
export const MAX_PAGES = 20;

/** printed pages for a batch (copies count) */
export function batchPages(b: { items: { copies: number }[]; options: Pick<Options, "grid" | "paper"> }): number {
  const signs = b.items.reduce((n, s) => n + s.copies, 0);
  return Math.ceil(signs / sheetGeometry(b.options).perPage);
}

/** null when the batch fits in MAX_PAGES, otherwise a message saying what to do */
export function pageLimitError(b: Parameters<typeof batchPages>[0]): string | null {
  const pages = batchPages(b);
  if (pages <= MAX_PAGES) return null;
  const per = sheetGeometry(b.options).perPage;
  const signs = b.items.reduce((n, s) => n + s.copies, 0);
  return `That would be ${pages} pages (${signs} signs). The limit is ${MAX_PAGES} pages, ${MAX_PAGES * per} signs on this sheet layout. Remove some signs or copies, or save part of it as a separate batch.`;
}

export function pageFill(totalSigns: number, perPage: number) {
  const pages = Math.max(1, Math.ceil(totalSigns / perPage));
  const lastUsed = totalSigns === 0 ? 0 : totalSigns - (pages - 1) * perPage;
  return { pages, lastUsed, empty: totalSigns === 0 ? perPage : perPage - lastUsed };
}
