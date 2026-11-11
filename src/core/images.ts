/**
 * Logo pixel work, shared by both backends. Decoding/encoding is platform-specific
 * (sharp on Node, canvas in the browser) and plugs in through ImageOps; everything
 * else here is plain math on RGBA pixels, so both backends produce the same logo.
 */
export interface Raster { data: Uint8Array | Uint8ClampedArray; width: number; height: number }
export interface ImageOps {
  /** any common format (PNG/JPG/WebP/GIF/SVG), EXIF orientation applied, as RGBA */
  decode(bytes: Uint8Array): Promise<Raster>;
  encodePng(r: Raster): Promise<Uint8Array>;
  /** opaque photos (backgrounds) are far smaller as JPEG; alpha is dropped onto white */
  encodeJpeg(r: Raster, quality: number): Promise<Uint8Array>;
  resize(r: Raster, width: number, height: number): Promise<Raster>;
}

let ops: ImageOps | null = null;
export function setImageOps(o: ImageOps): void { ops = o; }
export function imageOps(): ImageOps {
  if (!ops) throw new Error("No image backend configured (call setImageOps first)");
  return ops;
}

export const MAX_LOGO_W = 1400, MAX_LOGO_H = 700;

/** Crop away a uniform border (the colour of the top-left pixel, within `threshold`). */
export function trimRaster(r: Raster, threshold: number): Raster {
  const { data, width: w, height: h } = r;
  const [br, bg, bb, ba] = [data[0]!, data[1]!, data[2]!, data[3]!];
  const isBg = (i: number) => {
    const a = data[i + 3]!;
    if (ba < 8) return a <= 8 + threshold; // transparent border: anything nearly transparent counts
    return Math.max(Math.abs(data[i]! - br), Math.abs(data[i + 1]! - bg), Math.abs(data[i + 2]! - bb), Math.abs(a - ba)) <= threshold;
  };
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!isBg((y * w + x) * 4)) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
  }
  if (x1 < 0) return r; // fully uniform: keep as is
  if (x0 === 0 && y0 === 0 && x1 === w - 1 && y1 === h - 1) return r;
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
  const out = new Uint8Array(cw * ch * 4);
  for (let y = 0; y < ch; y++) out.set(data.subarray(((y + y0) * w + x0) * 4, ((y + y0) * w + x0 + cw) * 4), y * cw * 4);
  return { data: out, width: cw, height: ch };
}

/** Size that fits inside max w x h without enlarging. */
export function fitInside(w: number, h: number, maxW = MAX_LOGO_W, maxH = MAX_LOGO_H) {
  const s = Math.min(1, maxW / w, maxH / h);
  return { width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)) };
}

export function visiblePixels(r: Raster, stopAt = Infinity): number {
  let n = 0;
  for (let i = 3; i < r.data.length; i += 4) if (r.data[i]! > 16 && ++n >= stopAt) break;
  return n;
}

export type LogoBackground = "transparent" | "white" | "solid";
export interface LogoInfo {
  width: number; height: number; aspect: number; background: LogoBackground; hasOriginal: boolean;
  /** hash of the stored logo bytes: changes whenever the picture does, even at the same size (computed on read, never stored) */
  version: string;
}

/** Pixel size + whether the logo sits on an opaque box (sampled from the border). */
export function rasterInfo(r: Raster): Omit<LogoInfo, "hasOriginal" | "version"> {
  const { data, width: w, height: h } = r;
  let opaque = 0, n = 0, minSum = 0;
  const sample = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    n++;
    if (data[i + 3]! > 200) { opaque++; minSum += Math.min(data[i]!, data[i + 1]!, data[i + 2]!); }
  };
  for (let x = 0; x < w; x += Math.max(1, Math.floor(w / 60))) { sample(x, 0); sample(x, h - 1); }
  for (let y = 0; y < h; y += Math.max(1, Math.floor(h / 30))) { sample(0, y); sample(w - 1, y); }
  let background: LogoBackground = "transparent";
  if (opaque / n > 0.9) background = minSum / opaque >= 248 ? "white" : "solid";
  return { width: w, height: h, aspect: w / h, background };
}

/**
 * Make the background transparent: flood-fill from the border through pixels close to the
 * border colour, with a soft edge so anti-aliased outlines don't get a halo. Then trim.
 */
export function removeBackground(r: Raster): Raster {
  const { width: w, height: h } = r;
  const data = new Uint8Array(r.data); // copy
  let cr = 0, cg = 0, cb = 0, c = 0;
  const border: number[] = [];
  for (let x = 0; x < w; x++) border.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) border.push(y * w, y * w + w - 1);
  for (const p of border) { const i = p * 4; if (data[i + 3]! > 200) { cr += data[i]!; cg += data[i + 1]!; cb += data[i + 2]!; c++; } }
  if (!c) throw new Error("The logo already has a transparent background");
  cr /= c; cg /= c; cb /= c;
  const HARD = 22, SOFT = 70; // max channel distance: <=HARD fully clear, up to SOFT partially
  const dist = (i: number) => Math.max(Math.abs(data[i]! - cr), Math.abs(data[i + 1]! - cg), Math.abs(data[i + 2]! - cb));
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  for (const p of border) if (!seen[p] && dist(p * 4) <= SOFT) { seen[p] = 1; stack.push(p); }
  while (stack.length) {
    const p = stack.pop()!;
    const i = p * 4;
    const d = dist(i);
    data[i + 3] = d <= HARD ? 0 : Math.round(data[i + 3]! * ((d - HARD) / (SOFT - HARD)));
    if (d > HARD) continue; // soft pixels are the edge: don't spread through them
    const x = p % w, y = (p - x) / w;
    for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) {
      if (q >= 0 && !seen[q] && dist(q * 4) <= SOFT) { seen[q] = 1; stack.push(q); }
    }
  }
  const out = { data, width: w, height: h };
  if (visiblePixels(out) < w * h * 0.02) {
    throw new Error("Removing the background would erase the whole logo (it's one solid colour). Upload a version with a transparent or white background instead.");
  }
  return trimRaster(out, 1);
}

/** The whole upload pipeline: decode, trim the empty border, cap the size, check it isn't blank. */
export async function prepareLogo(bytes: Uint8Array): Promise<{ png: Uint8Array; raster: Raster }> {
  const o = imageOps();
  let r = trimRaster(await o.decode(bytes), 12);
  const size = fitInside(r.width, r.height);
  if (size.width !== r.width || size.height !== r.height) r = await o.resize(r, size.width, size.height);
  if (visiblePixels(r, 21) <= 20) throw new Error("That image is empty (fully transparent) - nothing would print");
  return { png: await o.encodePng(r), raster: r };
}

// ---------- background pictures
/** Big enough for a sharp 47x70 mm print (~550x830 px at 300 dpi) with room to crop. */
export const MAX_BG = 1600;
export function hasTransparency(r: Raster): boolean {
  for (let i = 3; i < r.data.length; i += 4) if (r.data[i]! < 250) return true;
  return false;
}
/** FNV-1a 64-bit as hex: a stable id for identical pictures (no crypto needed). */
export function hashBytes(bytes: Uint8Array): string {
  let h1 = 0x811c9dc5, h2 = 0x01000193 ^ bytes.length;
  for (let i = 0; i < bytes.length; i++) {
    h1 = Math.imul(h1 ^ bytes[i]!, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ bytes[(bytes.length - 1 - i)]!, 0x01000193) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}
export type ImageKind = "png" | "jpeg";
export function imageKind(bytes: Uint8Array): ImageKind | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  return null;
}
/** Decode any picture, cap its size, store photos as JPEG (PNG only if it has see-through parts). */
export async function prepareBackground(bytes: Uint8Array): Promise<{ bytes: Uint8Array; aspect: number; kind: ImageKind }> {
  const o = imageOps();
  let r = await o.decode(bytes);
  const size = fitInside(r.width, r.height, MAX_BG, MAX_BG);
  if (size.width !== r.width || size.height !== r.height) r = await o.resize(r, size.width, size.height);
  if (visiblePixels(r, 21) <= 20) throw new Error("That image is empty (fully transparent) - nothing would print");
  const alpha = hasTransparency(r);
  return { bytes: alpha ? await o.encodePng(r) : await o.encodeJpeg(r, 86), aspect: r.width / r.height, kind: alpha ? "png" : "jpeg" };
}

// ---------- base64 (backups embed logos; no Buffer in the browser)
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!, b = bytes[i + 1], c = bytes[i + 2];
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    s += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + (b === undefined ? "=" : B64[(n >> 6) & 63]!) + (c === undefined ? "=" : B64[n & 63]!);
  }
  return s;
}
export function fromBase64(s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9+/]/g, "");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n = (B64.indexOf(clean[i]!) << 18) | (B64.indexOf(clean[i + 1]!) << 12) | ((B64.indexOf(clean[i + 2] ?? "A") & 63) << 6) | (B64.indexOf(clean[i + 3] ?? "A") & 63);
    out[o++] = (n >> 16) & 255;
    if (i + 2 < clean.length) out[o++] = (n >> 8) & 255;
    if (i + 3 < clean.length) out[o++] = n & 255;
  }
  return out.subarray(0, o);
}
