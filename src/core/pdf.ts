import { PDFDocument, PrintScaling, degrees, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { cellRect, sheetGeometry, MAX_PAGES } from "./geometry.js";
import { fitLogo, type Measure } from "./layout.js";
import { findBrand, listTemplates, logoInfo, readLogo, readRules } from "./store.js";
import { describeOverflow, fitSign, overflowDetails, type FittedSign } from "./template.js";
import { SIGN_H_MM, SIGN_W_MM, type Options, type Rules, type Sign, type Template, type Warning } from "./types.js";

const MM = 72 / 25.4;
const mm = (v: number) => v * MM;

/** Where the Carlito font files come from: node_modules on Node, bundled assets in the browser. */
export type FontSource = (weight: "bold" | "regular") => Promise<Uint8Array>;
let fontSource: FontSource | null = null;
const fontCache = new Map<string, Promise<Uint8Array>>();
export function setFontSource(src: FontSource): void { fontSource = src; fontCache.clear(); }
function fontBytes(weight: "bold" | "regular"): Promise<Uint8Array> {
  if (!fontSource) throw new Error("No font source configured (call setFontSource first)");
  let b = fontCache.get(weight);
  if (!b) { b = fontSource(weight); fontCache.set(weight, b); }
  return b;
}
type Fonts = Record<"bold" | "regular", PDFFont>;
const hex = (c: string) => rgb(parseInt(c.slice(1, 3), 16) / 255, parseInt(c.slice(3, 5), 16) / 255, parseInt(c.slice(5, 7), 16) / 255);

async function newDoc(title: string) {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(title);
  doc.setProducer("SignSnip");
  // Ask viewers to default the print dialog to "Actual size" (honoured by Acrobat/most PDF viewers).
  doc.catalog.getOrCreateViewerPreferences().setPrintScaling(PrintScaling.None);
  const fonts: Fonts = {
    bold: await doc.embedFont(await fontBytes("bold"), { subset: true }),
    regular: await doc.embedFont(await fontBytes("regular"), { subset: true }),
  };
  const font = fonts.bold;
  const measure: Measure = (t, size, weight = "bold") => fonts[weight].widthOfTextAtSize(t, size) / MM;
  return { doc, font, fonts, measure };
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
function drawSign(page: PDFPage, fonts: Fonts, ox: number, oy: number, fitted: FittedSign, logo: Logo | undefined) {
  // (ox, oy) = top-left corner of the sign in pt, y measured up from page bottom
  const placed = fitted.placed;
  if (logo && placed.logo) {
    const r = fitLogo(logo.aspect, placed.logo.box, logo.scale);
    page.drawImage(logo.img, { x: ox + mm(r.x), y: oy - mm(r.y + r.h), width: mm(r.w), height: mm(r.h) });
  }
  for (const l of placed.lines) {
    const font = fonts[l.weight];
    const color = hex(l.color);
    // cy is the optical centre of the caps; baseline sits ~0.32em below it for caps/digits
    const baseline = oy - mm(l.cy) - l.sizePt * 0.32;
    const x = ox + mm(l.x);
    page.drawText(l.text, { x, y: baseline, size: l.sizePt, font, color });
    if (l.strike) {
      const w = mm(l.w);
      const y = baseline + l.sizePt * 0.3;
      page.drawLine({ start: { x: x - 1, y }, end: { x: x + w + 1, y }, thickness: Math.max(0.7, l.sizePt * 0.07), color });
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

/** `templates` overrides the saved ones (the designer previews unsaved edits this way). */
export async function renderPdf(signs: Sign[], options: Options, mode: "sheet" | "single" = "sheet", templates?: Template[], rules: Rules = readRules()): Promise<PdfInfo> {
  const { doc, fonts, measure } = await newDoc("SignSnip");
  const logos = await embedLogos(doc, signs);
  const saved = listTemplates();
  const all = templates ? [...templates, ...saved.filter((t) => !templates.some((o) => o.id === t.id))] : saved;
  const fit = (s: Sign) => fitSign(s, all, measure, rules);

  if (mode === "single") {
    const s = signs[0];
    const page = doc.addPage([mm(SIGN_W_MM), mm(SIGN_H_MM)]);
    if (s) drawSign(page, fonts, 0, mm(SIGN_H_MM), fit(s), logos.get(s.brandId));
    return { bytes: await doc.save(), pages: 1, signs: s ? 1 : 0 };
  }

  const g = sheetGeometry(options);
  const pageCount = Math.max(1, Math.ceil(signs.length / g.perPage));
  if (pageCount > MAX_PAGES) throw new Error(`That's ${pageCount} pages. One PDF can have at most ${MAX_PAGES}. Split the batch into separate saved batches.`);
  for (let p = 0; p < pageCount; p++) {
    const page = doc.addPage([mm(g.pageW), mm(g.pageH)]);
    const chunk = signs.slice(p * g.perPage, (p + 1) * g.perPage);
    chunk.forEach((s, i) => {
      const r = cellRect(g, i);
      drawSign(page, fonts, mm(r.x), mm(g.pageH - r.y), fit(s), logos.get(s.brandId));
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
  const { doc, font } = await newDoc("SignSnip printer check");
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
  const templates = listTemplates();
  const rules = readRules();
  const fitted = items.map((s) => fitSign(s, templates, measure, rules));
  const out: Warning[] = [];
  const byBrand = new Map<string, number[]>();
  items.forEach((s, i) => byBrand.set(s.brandId, [...(byBrand.get(s.brandId) ?? []), i]));
  for (const [brandId, idx] of byBrand) {
    const brand = findBrand(brandId);
    const name = brand?.name ?? brandId;
    const info = await logoInfo(brandId);
    if (!brand) {
      out.push({ items: idx, brandId, level: "warn", code: "no-logo", message: `${idx.length === 1 ? `Row ${idx[0]! + 1} uses` : `${idx.length} rows use`} a brand that was deleted (“${brandId}”) - they print without a logo. Change the brand with bulk edit.` });
      continue;
    }
    if (!info) {
      out.push({ items: idx, brandId, level: "warn", code: "no-logo", message: `${name} has no logo yet - those signs print without one.` });
      continue;
    }
    const box = fitted[idx[0]!]!.placed.logo?.box;
    if (!box) continue; // this brand's signs use templates without a logo
    const r = fitLogo(info.aspect, box, brand?.logoScale ?? 1);
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
  const logos = new Map<string, Awaited<ReturnType<typeof logoInfo>>>();
  for (const id of new Set(items.map((s) => s.brandId))) logos.set(id, await logoInfo(id));
  fitted.forEach((f, i) => {
    const s = items[i]!;
    const row = `Row ${i + 1}`;
    if (f.placed.overflow.length) {
      const info = logos.get(s.brandId);
      const logo = info && f.placed.logo ? fitLogo(info.aspect, f.placed.logo.box, findBrand(s.brandId)?.logoScale ?? 1) : null;
      for (const d of overflowDetails(f.template, f.placed, logo)) {
        out.push({ items: [i], brandId: s.brandId, level: d.harmless ? "info" : "warn", code: d.harmless ? "spill" : "small-text", message: `${row}: ${describeOverflow(d, `the “${f.template.name}” template`)}` });
      }
    }
    if (f.belowMin.length && !f.placed.overflow.length) {
      const what = f.belowMin.map((l) => `"${l.text}" (${l.sizePt.toFixed(1)}pt)`).join(", ");
      out.push({ items: [i], brandId: s.brandId, level: "warn", code: "small-text", message: `${row}: ${what} ${f.belowMin.length === 1 ? "is" : "are"} below your ${f.min}pt readable minimum. Add an abbreviation, shorten the name, or give the template a long-name fallback.` });
    }
    if (s.kind === "price" && s.price && s.wasPrice && s.wasPrice <= s.price) {
      out.push({ items: [i], brandId: s.brandId, level: "warn", code: "was-price", message: `${row}: the “was” price (${s.wasPrice}) isn't higher than the sale price (${s.price}).` });
    }
    if (f.abbreviations.length) {
      out.push({ items: [i], brandId: s.brandId, level: "info", code: "auto-abbrev", message: `${row}: shortened to fit (${f.abbreviations.map((a) => `${a.from} → ${a.to}`).join(", ")}).` });
    }
    if (f.switchedFrom) {
      out.push({ items: [i], brandId: s.brandId, level: "info", code: "auto-template", message: `${row}: prints with “${f.template.name}” instead of “${f.switchedFrom.name}” so the text stays readable.` });
    }
  });
  return out;
}
