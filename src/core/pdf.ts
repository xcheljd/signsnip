import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { PDFDocument, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import sharp from "sharp";
import { fitLogo, layoutSign, type Measure } from "./layout.js";
import { readLogo } from "./store.js";
import { SIGN_H_MM, SIGN_W_MM, type Options, type Sign } from "./types.js";

const MM = 72 / 25.4;
const mm = (v: number) => v * MM;

const PAPER_MM = { letter: [215.9, 279.4], a4: [210, 297] } as const;
const GRIDS = {
  "landscape-5x2": { cols: 5, rows: 2, landscape: true },
  "portrait-4x3": { cols: 4, rows: 3, landscape: false },
} as const;

let fontBytes: Buffer | undefined;
function boldFontBytes(): Buffer {
  if (!fontBytes) {
    const req = createRequire(import.meta.url);
    const dir = path.dirname(req.resolve("@fontsource/carlito/package.json"));
    fontBytes = fs.readFileSync(path.join(dir, "files", "carlito-latin-700-normal.woff"));
  }
  return fontBytes;
}

export interface PdfInfo { bytes: Uint8Array; pages: number; signs: number }

export function expandCopies(items: Sign[]): Sign[] {
  return items.flatMap((s) => Array.from({ length: s.copies }, () => s));
}

/** The single source of truth for what a sign looks like on paper. */
function drawSign(page: PDFPage, font: PDFFont, ox: number, oy: number, sign: Sign, logo: { img: PDFImage; aspect: number } | undefined, measure: Measure) {
  // (ox, oy) = top-left corner of the sign in pt, y measured up from page bottom
  const layout = layoutSign(sign, measure);
  if (logo) {
    const r = fitLogo(logo.aspect, layout.logoBox);
    page.drawImage(logo.img, { x: ox + mm(r.x), y: oy - mm(r.y + r.h), width: mm(r.w), height: mm(r.h) });
  }
  for (const l of layout.lines) {
    const w = font.widthOfTextAtSize(l.text, l.sizePt);
    // cy is the optical centre of the caps; baseline sits ~0.32em below it for caps/digits
    const baseline = oy - mm(l.cy) - l.sizePt * 0.32;
    page.drawText(l.text, { x: ox + mm(l.cx) - w / 2, y: baseline, size: l.sizePt, font, color: rgb(0, 0, 0) });
  }
}

export async function renderPdf(
  signs: Sign[],
  options: Options,
  mode: "sheet" | "single" = "sheet",
): Promise<PdfInfo> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle("Sign-O-Matic");
  doc.setProducer("Sign-O-Matic");
  const font = await doc.embedFont(boldFontBytes(), { subset: true });
  const measure: Measure = (t, size) => font.widthOfTextAtSize(t, size) / MM;

  // embed each distinct brand logo once
  const logos = new Map<string, { img: PDFImage; aspect: number }>();
  for (const id of new Set(signs.map((s) => s.brandId))) {
    const buf = readLogo(id);
    if (!buf) continue;
    const meta = await sharp(buf).metadata();
    logos.set(id, { img: await doc.embedPng(buf), aspect: (meta.width ?? 1) / (meta.height ?? 1) });
  }

  if (mode === "single") {
    const s = signs[0];
    const page = doc.addPage([mm(SIGN_W_MM), mm(SIGN_H_MM)]);
    if (s) drawSign(page, font, 0, mm(SIGN_H_MM), s, logos.get(s.brandId), measure);
    return { bytes: await doc.save(), pages: 1, signs: s ? 1 : 0 };
  }

  const grid = GRIDS[options.grid];
  const [pw0, ph0] = PAPER_MM[options.paper];
  const [pw, ph] = grid.landscape ? [ph0, pw0] : [pw0, ph0];
  const perPage = grid.cols * grid.rows;
  const gridW = grid.cols * SIGN_W_MM, gridH = grid.rows * SIGN_H_MM;
  const left = (pw - gridW) / 2, top = (ph - gridH) / 2;

  const pageCount = Math.max(1, Math.ceil(signs.length / perPage));
  for (let p = 0; p < pageCount; p++) {
    const page = doc.addPage([mm(pw), mm(ph)]);
    const chunk = signs.slice(p * perPage, (p + 1) * perPage);
    chunk.forEach((s, i) => {
      const col = i % grid.cols, row = Math.floor(i / grid.cols);
      const ox = mm(left + col * SIGN_W_MM);
      const oy = mm(ph - (top + row * SIGN_H_MM));
      drawSign(page, font, ox, oy, s, logos.get(s.brandId), measure);
    });
    if (options.cutMarks) {
      // hairline grid over every cell (full grid, so empty slots still show the cut lines)
      const line = { thickness: 0.25, color: rgb(0.55, 0.55, 0.55) };
      for (let c = 0; c <= grid.cols; c++)
        page.drawLine({ start: { x: mm(left + c * SIGN_W_MM), y: mm(ph - top) }, end: { x: mm(left + c * SIGN_W_MM), y: mm(ph - top - gridH) }, ...line });
      for (let r = 0; r <= grid.rows; r++)
        page.drawLine({ start: { x: mm(left), y: mm(ph - top - r * SIGN_H_MM) }, end: { x: mm(left + gridW), y: mm(ph - top - r * SIGN_H_MM) }, ...line });
    }
  }
  return { bytes: await doc.save(), pages: pageCount, signs: signs.length };
}
