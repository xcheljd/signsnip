import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { z } from "zod";
import { DATA_DIR, SEED_DIR } from "./paths.js";
import {
  BatchSchema, BrandSchema, DEFAULT_OPTIONS, PresetSchema,
  type Batch, type Brand, type Preset,
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
export function upsertBrand(input: { id?: string; name: string; collections?: string[] }): Brand {
  const brands = listBrands();
  const id = input.id ?? slugify(input.name);
  const idx = brands.findIndex((b) => b.id === id);
  const prev = idx >= 0 ? brands[idx] : undefined;
  const brand = BrandSchema.parse({
    id, name: input.name, collections: input.collections ?? prev?.collections ?? [], hasLogo: prev?.hasLogo ?? false,
  });
  if (idx >= 0) brands[idx] = brand; else brands.push(brand);
  saveBrands(brands);
  return { ...brand, hasLogo: fs.existsSync(logoPath(id)) };
}
export function deleteBrand(id: string): void {
  saveBrands(listBrands().filter((b) => b.id !== id));
  fs.rmSync(logoPath(id), { force: true });
}

// ---------- logos
export const logoPath = (brandId: string) => f("logos", `${brandId}.png`);
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
  return { aspect: out.info.width / out.info.height };
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
