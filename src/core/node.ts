import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import sharp, { type OutputInfo } from "sharp";
import { setImageOps, type Raster } from "./images.js";
import { DATA_DIR, SEED_DIR } from "./paths.js";
import { setFontSource } from "./pdf.js";
import { setRepo } from "./repo.js";
import { FsRepo } from "./repo-fs.js";
import type { SampleData } from "./workspace.js";

/**
 * Node backends: data/ on disk (shared by the local server and the CLI), sharp for images,
 * Carlito from node_modules. Imported first by the CLI, the server and tests.
 */
const raw = (r: Raster) => sharp(Buffer.from(r.data.buffer, r.data.byteOffset, r.data.byteLength), { raw: { width: r.width, height: r.height, channels: 4 } });
const out = ({ data, info }: { data: Buffer; info: OutputInfo }): Raster =>
  ({ data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength), width: info.width, height: info.height });
setImageOps({
  decode: async (bytes) => out(await sharp(bytes, { density: 300 }).rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true })),
  encodePng: async (r) => new Uint8Array(await raw(r).png().toBuffer()),
  resize: async (r, width, height) => out(await raw(r).resize({ width, height, fit: "fill" }).raw().toBuffer({ resolveWithObject: true })),
});

setFontSource(async (weight) => {
  const dir = path.dirname(createRequire(import.meta.url).resolve("@fontsource/carlito/package.json"));
  return new Uint8Array(fs.readFileSync(path.join(dir, "files", `carlito-latin-${weight === "bold" ? 700 : 400}-normal.woff`)));
});

setRepo(new FsRepo(DATA_DIR, SEED_DIR));

/** The seed folder as sample data (the CLI's "start with samples"). */
export function seedSamples(): SampleData {
  const brands = JSON.parse(fs.readFileSync(path.join(SEED_DIR, "brands.json"), "utf8"));
  const presets = JSON.parse(fs.readFileSync(path.join(SEED_DIR, "presets.json"), "utf8"));
  const logos: Record<string, Uint8Array> = {};
  const dir = path.join(SEED_DIR, "logos");
  for (const f of fs.readdirSync(dir)) if (f.endsWith(".png")) logos[f.slice(0, -4)] = new Uint8Array(fs.readFileSync(path.join(dir, f)));
  return { brands, presets, logos };
}
