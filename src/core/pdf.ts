import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { PDFDocument, PrintScaling, degrees, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { cellRect, sheetGeometry } from "./geometry.js";
import { fitLogo, layoutSign, smallLines, type Measure } from "./layout.js";
import { findBrand, logoInfo, readLogo } from "./store.js";
import { SIGN_H_MM, SIGN_W_MM, type Options, type Sign, type Warning } from "./types.js";

const MM = 72 / 25.4;
const mm = (v: number) => v * MM;

let fontBytes: Buffer | undefined;
function boldFontBytes(): Buffer {
  if (!fontBytes) {
    const req = createRequire(import.meta.url);
    const dir = path.dirname(req.resolve("@fontsource/carlito/package.json"));
    fontBytes = fs.readFileSync(path.join(dir, "files", "carlito-latin-700-normal.woff"));
  }
  return fontBytes;
}

async function newDoc(title: string) {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(title);
  doc.setProducer("Sign-O-Matic");
  // Ask viewers to default the print dialog to "Actual size" (honoured by Acrobat/most PDF viewers).
  doc.catalog.getOrCreateViewerPreferences().setPrintScaling(PrintScaling.None);
  const font = await doc.embedFont(boldFontBytes(), { subset: true });
  const measure: Measure = (t, size) => font.widthOfTextAtSize(t, size) / MM;
  return { doc, font, measure };
}

let measureCache: Measure | undefined;
async function getMeasure(): Promise<Measure> {
  if (!measureCache) measureCache = (await newDoc("measure")).measure;
  return measureCache;
}

export interface PdfInfo { bytes: Uint8Array; pages: number; signs: number }

export function expandCopies(items: Sign[]): Sign[] {
  return items.flatMap((s) => Array.from({ length: s.copies }, () => s));
}

interface Logo { img: PDFImage; aspect: number; scale: number }

/** The single source of truth for what a sign looks like on paper. */
function drawSign(page: PDFPage, font: PDFFont, ox: number, oy: number, sign: Sign, logo: Logo | undefined, measure: Measure) {
  // (ox, oy) = top-left corner of the sign in pt, y measured up from page bottom
  const layout = layoutSign(sign, measure);
  if (logo) {
    const r = fitLogo(logo.aspect, layout.logoBox, logo.scale);
    page.drawImage(logo.img, { x: ox + mm(r.x), y: oy - mm(r.y + r.h), width: mm(r.w), height: mm(r.h) });
  }
  for (const l of layout.lines) {
    const w = font.widthOfTextAtSize(l.text, l.sizePt);
    // cy is the optical centre of the caps; baseline sits ~0.32em below it for caps/digits
    const baseline = oy - mm(l.cy) - l.sizePt * 0.32;
    const x = ox + mm(l.cx) - w / 2;
    page.drawText(l.text, { x, y: baseline, size: l.sizePt, font, color: rgb(0, 0, 0) });
    if (l.strike) {
      const y = baseline + l.sizePt * 0.3;
      page.drawLine({ start: { x: x - 1, y }, end: { x: x + w + 1, y }, thickness: Math.max(0.7, l.sizePt * 0.07), color: rgb(0, 0, 0) });
    }
  }
}

async function embedLogos(doc: PDFDocument, signs: Sign[]) {
  const logos = new Map<string, Logo>();
  for (const id of new Set(signs.map((s) => s.brandId))) {
    const buf = readLogo(id);
    const info = await logoInfo(id);
    if (!buf || !info) continue;
    logos.set(id, { img: await doc.embedPng(buf), aspect: info.aspect, scale: findBrand(id)?.logoScale ?? 1 });
  }
  return logos;
}

export async function renderPdf(signs: Sign[], options: Options, mode: "sheet" | "single" = "sheet"): Promise<PdfInfo> {
  const { doc, font, measure } = await newDoc("Sign-O-Matic");
  const logos = await embedLogos(doc, signs);

  if (mode === "single") {
    const s = signs[0];
    const page = doc.addPage([mm(SIGN_W_MM), mm(SIGN_H_MM)]);
    if (s) drawSign(page, font, 0, mm(SIGN_H_MM), s, logos.get(s.brandId), measure);
    return { bytes: await doc.save(), pages: 1, signs: s ? 1 : 0 };
  }

  const g = sheetGeometry(options);
  const pageCount = Math.max(1, Math.ceil(signs.length / g.perPage));
  for (let p = 0; p < pageCount; p++) {
    const page = doc.addPage([mm(g.pageW), mm(g.pageH)]);
    const chunk = signs.slice(p * g.perPage, (p + 1) * g.perPage);
    chunk.forEach((s, i) => {
      const r = cellRect(g, i);
      drawSign(page, font, mm(r.x), mm(g.pageH - r.y), s, logos.get(s.brandId), measure);
    });
    if (options.cutMarks) {
      // hairline grid over every cell (full grid, so empty slots still show the cut lines)
      const line = { thickness: 0.25, color: rgb(0.55, 0.55, 0.55) };
      const gw = g.cols * SIGN_W_MM, gh = g.rows * SIGN_H_MM;
      for (let c = 0; c <= g.cols; c++) {
        const x = mm(g.left + c * SIGN_W_MM);
        page.drawLine({ start: { x, y: mm(g.pageH - g.top) }, end: { x, y: mm(g.pageH - g.top - gh) }, ...line });
      }
      for (let r = 0; r <= g.rows; r++) {
        const y = mm(g.pageH - g.top - r * SIGN_H_MM);
        page.drawLine({ start: { x: mm(g.left), y }, end: { x: mm(g.left + gw), y }, ...line });
      }
    }
  }
  return { bytes: await doc.save(), pages: pageCount, signs: signs.length };
}

/**
 * One-page printer check: a 47x70 mm box and mm/inch rulers. If the printed box doesn't
 * measure 47 x 70 mm, the print dialog is scaling ("Fit to page") - switch to Actual size / 100%.
 */
export async function renderCalibration(paper: Options["paper"] = "letter"): Promise<Uint8Array> {
  const { doc, font } = await newDoc("Sign-O-Matic printer check");
  const g = sheetGeometry({ grid: "portrait-4x3", paper });
  const page = doc.addPage([mm(g.pageW), mm(g.pageH)]);
  const H = g.pageH;
  const ink = rgb(0, 0, 0), grey = rgb(0.45, 0.45, 0.45);
  const text = (t: string, x: number, yTop: number, size: number, color = ink) =>
    page.drawText(t, { x: mm(x), y: mm(H - yTop) - size * 0.32, size, font, color });

  text("PRINTER CHECK", 20, 22, 22);
  text("Print this page with scaling at 100% / \"Actual size\" (not \"Fit to page\").", 20, 32, 11, grey);
  text("Then measure the box and the ruler. They should match exactly.", 20, 38, 11, grey);

  // the sign box
  const bx = 20, by = 50;
  page.drawRectangle({ x: mm(bx), y: mm(H - by - SIGN_H_MM), width: mm(SIGN_W_MM), height: mm(SIGN_H_MM), borderColor: ink, borderWidth: 0.6 });
  text("47 mm", bx + SIGN_W_MM / 2 - 6, by - 4, 10);
  page.drawText("70 mm", { x: mm(bx - 3), y: mm(H - by - SIGN_H_MM / 2 - 6), size: 10, font, rotate: degrees(90) });
  text("ONE SIGN", bx + 9, by + 33, 12, grey);

  // 150 mm ruler
  const rx = 20, ry = 150;
  page.drawLine({ start: { x: mm(rx), y: mm(H - ry) }, end: { x: mm(rx + 150), y: mm(H - ry) }, thickness: 0.6, color: ink });
  for (let i = 0; i <= 150; i++) {
    const len = i % 10 === 0 ? 6 : i % 5 === 0 ? 4 : 2;
    page.drawLine({ start: { x: mm(rx + i), y: mm(H - ry) }, end: { x: mm(rx + i), y: mm(H - ry - len) }, thickness: 0.3, color: ink });
    if (i % 10 === 0) text(String(i / 10), rx + i - (i >= 100 ? 1.6 : 0.8), ry + 9, 8);
  }
  text("cm", rx + 152, ry + 2, 9, grey);

  // 5 inch ruler
  const iy = 180;
  page.drawLine({ start: { x: mm(rx), y: mm(H - iy) }, end: { x: mm(rx + 127), y: mm(H - iy) }, thickness: 0.6, color: ink });
  for (let i = 0; i <= 5 * 16; i++) {
    const x = rx + (i * 25.4) / 16;
    const len = i % 16 === 0 ? 6 : i % 8 === 0 ? 4.5 : i % 4 === 0 ? 3 : 1.6;
    page.drawLine({ start: { x: mm(x), y: mm(H - iy) }, end: { x: mm(x), y: mm(H - iy - len) }, thickness: 0.3, color: ink });
    if (i % 16 === 0) text(String(i / 16), x - 0.8, iy + 9, 8);
  }
  text("in", rx + 129, iy + 2, 9, grey);

  text("Box too small? Your print dialog shrank the page. Set Scale to 100% or Actual size.", 20, 205, 10, grey);
  text("Box right but off-centre? That's fine - only the size matters for the holders.", 20, 211, 10, grey);
  return doc.save();
}

/** Pre-print checks: low-res logos, opaque logo boxes, text that had to shrink a lot, missing logos. */
export async function checkSigns(items: Sign[]): Promise<Warning[]> {
  const measure = await getMeasure();
  const out: Warning[] = [];
  const byBrand = new Map<string, number[]>();
  items.forEach((s, i) => byBrand.set(s.brandId, [...(byBrand.get(s.brandId) ?? []), i]));
  for (const [brandId, idx] of byBrand) {
    const brand = findBrand(brandId);
    const name = brand?.name ?? brandId;
    const info = await logoInfo(brandId);
    if (!info) {
      out.push({ items: idx, brandId, level: "warn", code: "no-logo", message: `${name} has no logo yet - those signs print without one.` });
      continue;
    }
    const r = fitLogo(info.aspect, undefined, brand?.logoScale ?? 1);
    const dpi = Math.round(info.width / (r.w / 25.4));
    if (dpi < 250) {
      out.push({ items: idx, brandId, level: "warn", code: "low-res-logo", message: `${name}'s logo is low resolution (~${dpi} dpi at print size) and may print soft. Upload a bigger file - 300 dpi or more (at least ${Math.ceil((r.w / 25.4) * 300)} px wide).` });
    }
    if (info.background === "solid") {
      out.push({ items: idx, brandId, level: "warn", code: "logo-background", message: `${name}'s logo sits on a coloured box that will print as a rectangle.` });
    } else if (info.background === "white") {
      out.push({ items: idx, brandId, level: "info", code: "logo-background", message: `${name}'s logo has a white background. Invisible on white paper; remove it if you print on coloured stock.` });
    }
  }
  items.forEach((s, i) => {
    const small = smallLines(layoutSign(s, measure));
    if (small.length) {
      const what = small.map((l) => `"${l.text}" (${l.sizePt.toFixed(1)}pt)`).join(", ");
      out.push({ items: [i], brandId: s.brandId, level: "warn", code: "small-text", message: `Row ${i + 1}: ${what} had to shrink to fit and may be hard to read. Try a shorter name.` });
    }
  });
  return out;
}
