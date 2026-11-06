import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { z } from "zod";
import { DATA_DIR, SEED_DIR } from "./paths.js";
import {
  BatchSchema, BrandSchema, DEFAULT_OPTIONS, PresetSchema, SavedBatchSchema,
  type Batch, type Brand, type Preset, type SavedBatch,
} from "./types.js";

const f = (...p: string[]) => path.join(DATA_DIR, ...p);

/** Copy seed data into the working data dir the first time we run. */
export function ensureData(): void {
  if (fs.existsSync(f("brands.json")) || DATA_DIR === SEED_DIR || !fs.existsSync(SEED_DIR)) return;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.cpSync(SEED_DIR, DATA_DIR, { recursive: true });
}

function readJson<T>(file: string, schema: z.ZodType<T>, fallback: T): T {
  ensureData();
  if (!fs.existsSync(file)) return fallback;
  return schema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
}
function writeJson(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n");
  fs.renameSync(tmp, file); // atomic: CLI and server can both write safely
}

export const slugify = (s: string) =>
  s.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "brand";

// ---------- brands
export function listBrands(): Brand[] {
  const brands = readJson(f("brands.json"), z.array(BrandSchema), []);
  return brands.map((b) => ({ ...b, hasLogo: fs.existsSync(logoPath(b.id)) }));
}
export function saveBrands(brands: Brand[]): void {
  writeJson(f("brands.json"), brands.map((b) => ({ ...b, hasLogo: undefined })));
}
export function findBrand(ref: string): Brand | undefined {
  const r = ref.trim().toLowerCase();
  const all = listBrands();
  return all.find((b) => b.id === r) ?? all.find((b) => b.name.toLowerCase() === r)
    ?? all.find((b) => b.name.toLowerCase().includes(r));
}
export function upsertBrand(input: { id?: string; name: string; collections?: string[]; logoScale?: number }): Brand {
  const brands = listBrands();
  const id = input.id ?? slugify(input.name);
  const idx = brands.findIndex((b) => b.id === id);
  const prev = idx >= 0 ? brands[idx] : undefined;
  const brand = BrandSchema.parse({
    id, name: input.name, collections: input.collections ?? prev?.collections ?? [],
    logoScale: input.logoScale ?? prev?.logoScale ?? 1, hasLogo: prev?.hasLogo ?? false,
  });
  if (idx >= 0) brands[idx] = brand; else brands.push(brand);
  saveBrands(brands);
  return { ...brand, hasLogo: fs.existsSync(logoPath(id)) };
}
export function deleteBrand(id: string): void {
  saveBrands(listBrands().filter((b) => b.id !== id));
  fs.rmSync(logoPath(id), { force: true });
  fs.rmSync(origLogoPath(id), { force: true });
}

// ---------- logos
export const logoPath = (brandId: string) => f("logos", `${brandId}.png`);
/** Backup taken before an automatic edit (background removal) so it can be restored. */
export const origLogoPath = (brandId: string) => f("logos", "originals", `${brandId}.png`);
export const readLogo = (brandId: string): Buffer | null =>
  fs.existsSync(logoPath(brandId)) ? fs.readFileSync(logoPath(brandId)) : null;

/**
 * Accept any PNG/JPG/WebP/SVG/GIF, trim the empty border (so the logo fills its box),
 * cap the size, and store as PNG. Returns the stored aspect ratio.
 */
export async function saveLogo(brandId: string, input: Buffer): Promise<{ aspect: number }> {
  if (!listBrands().some((b) => b.id === brandId)) throw new Error(`Unknown brand "${brandId}"`);
  let img = sharp(input, { density: 300 }).rotate();
  try {
    img = sharp(await img.trim({ threshold: 12 }).toBuffer());
  } catch {
    img = sharp(input, { density: 300 }).rotate(); // fully uniform image: keep as is
  }
  const out = await img.resize({ width: 1400, height: 700, fit: "inside", withoutEnlargement: true })
    .png().toBuffer({ resolveWithObject: true });
  fs.mkdirSync(f("logos"), { recursive: true });
  fs.writeFileSync(logoPath(brandId), out.data);
  fs.rmSync(origLogoPath(brandId), { force: true }); // a fresh upload supersedes any old backup
  infoCache.delete(brandId);
  return { aspect: out.info.width / out.info.height };
}

export type LogoBackground = "transparent" | "white" | "solid";
export interface LogoInfo { width: number; height: number; aspect: number; background: LogoBackground; hasOriginal: boolean }
const infoCache = new Map<string, { mtime: number; info: LogoInfo }>();

/** Pixel size + whether the logo sits on an opaque box (sampled from the border). Cached by mtime. */
export async function logoInfo(brandId: string): Promise<LogoInfo | null> {
  const file = logoPath(brandId);
  if (!fs.existsSync(file)) return null;
  const mtime = fs.statSync(file).mtimeMs;
  const hit = infoCache.get(brandId);
  if (hit && hit.mtime === mtime) return { ...hit.info, hasOriginal: fs.existsSync(origLogoPath(brandId)) };
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
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
  const out: LogoInfo = { width: w, height: h, aspect: w / h, background, hasOriginal: fs.existsSync(origLogoPath(brandId)) };
  infoCache.set(brandId, { mtime, info: out });
  return out;
}

/**
 * Make the logo's background transparent: flood-fill from the border through pixels close to
 * the border colour, with a soft edge so anti-aliased outlines don't get a halo. Backs up first.
 */
export async function removeLogoBackground(brandId: string): Promise<LogoInfo> {
  const file = logoPath(brandId);
  if (!fs.existsSync(file)) throw new Error(`"${brandId}" has no logo`);
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  // background colour = average of opaque border pixels
  let r = 0, g = 0, b = 0, c = 0;
  const border: number[] = [];
  for (let x = 0; x < w; x++) border.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) border.push(y * w, y * w + w - 1);
  for (const p of border) { const i = p * 4; if (data[i + 3]! > 200) { r += data[i]!; g += data[i + 1]!; b += data[i + 2]!; c++; } }
  if (!c) throw new Error("The logo already has a transparent background");
  r /= c; g /= c; b /= c;
  const HARD = 22, SOFT = 70; // max channel distance: <=HARD fully clear, up to SOFT partially
  const dist = (i: number) => Math.max(Math.abs(data[i]! - r), Math.abs(data[i + 1]! - g), Math.abs(data[i + 2]! - b));
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
  fs.mkdirSync(path.dirname(origLogoPath(brandId)), { recursive: true });
  if (!fs.existsSync(origLogoPath(brandId))) fs.copyFileSync(file, origLogoPath(brandId));
  const png = await sharp(data, { raw: { width: w, height: h, channels: 4 } }).trim({ threshold: 1 }).png().toBuffer();
  fs.writeFileSync(file, png);
  infoCache.delete(brandId);
  return (await logoInfo(brandId))!;
}

export async function restoreLogo(brandId: string): Promise<void> {
  const orig = origLogoPath(brandId);
  if (!fs.existsSync(orig)) throw new Error("No original to restore");
  fs.copyFileSync(orig, logoPath(brandId));
  fs.rmSync(orig);
  infoCache.delete(brandId);
}

// ---------- presets
export const listPresets = (): Preset[] => readJson(f("presets.json"), z.array(PresetSchema), []);
export function savePresets(p: Preset[]): void { writeJson(f("presets.json"), p); }

// ---------- batch (shared between web UI and CLI)
export const readBatch = (): Batch => readJson(f("batch.json"), BatchSchema, { items: [], options: DEFAULT_OPTIONS });
export function writeBatch(b: Batch): Batch {
  const parsed = BatchSchema.parse(b);
  writeJson(f("batch.json"), parsed);
  return parsed;
}

// ---------- saved batches ("Holiday sale", "Spring clearance")
const batchFile = (id: string) => f("batches", `${id}.json`);
export function listSavedBatches(): SavedBatch[] {
  ensureData();
  const dir = f("batches");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((n) => n.endsWith(".json"))
    .map((n) => SavedBatchSchema.parse(JSON.parse(fs.readFileSync(path.join(dir, n), "utf8"))))
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}
export function findSavedBatch(ref: string): SavedBatch | undefined {
  const r = ref.trim().toLowerCase();
  const all = listSavedBatches();
  return all.find((b) => b.id === r) ?? all.find((b) => b.name.toLowerCase() === r) ?? all.find((b) => b.name.toLowerCase().includes(r));
}
export function saveNamedBatch(name: string, batch: Batch = readBatch()): SavedBatch {
  const saved = SavedBatchSchema.parse({ id: slugify(name), name: name.trim(), savedAt: new Date().toISOString(), batch });
  writeJson(batchFile(saved.id), saved);
  return saved;
}
export function deleteSavedBatch(id: string): void { fs.rmSync(batchFile(id), { force: true }); }
