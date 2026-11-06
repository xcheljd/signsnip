import { z } from "zod";
import { csvToSigns } from "./batch.js";
import { fromBase64, toBase64 } from "./images.js";
import { repo } from "./repo.js";
import {
  listBrands, listPresets, listSavedBatches, listTemplates, readBatch, readLogo, readRules,
  saveBrands, savePresets, writeBatch, writeRules,
} from "./store.js";
import {
  BatchSchema, BrandSchema, DEFAULT_OPTIONS, DEFAULT_RULES, PresetSchema, RulesSchema, SavedBatchSchema, TemplateSchema,
  type Brand, type Preset,
} from "./types.js";

/**
 * A workspace backup: everything you made, in one file (logos embedded as base64 PNG).
 * Used by "Back up" / "Restore" in the app, the start page, and `signo backup` / `signo restore`.
 */
export const WORKSPACE_FORMAT = "sign-o-matic/workspace";
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];
const b64Png = z.string().max(8_000_000).refine((s) => {
  const head = fromBase64(s.slice(0, 16));
  return PNG_MAGIC.every((b, i) => head[i] === b);
}, "not a PNG image");

export const WorkspaceSchema = z.object({
  format: z.literal(WORKSPACE_FORMAT),
  version: z.literal(1),
  exportedAt: z.string(),
  brands: z.array(BrandSchema).max(500),
  presets: z.array(PresetSchema).max(500),
  batch: BatchSchema,
  saved: z.array(SavedBatchSchema).max(500),
  templates: z.array(TemplateSchema).max(200),
  rules: RulesSchema,
  /** brand id -> PNG (base64) */
  logos: z.record(z.string(), b64Png),
  /** brand id -> original PNG kept for "Restore original" after background removal */
  originals: z.record(z.string(), b64Png).default({}),
});
export type Workspace = z.infer<typeof WorkspaceSchema>;

/** Marker that this workspace has been set up (the hosted app shows its start page until then). */
export type StartedFrom = "scratch" | "samples" | "backup" | "existing";
export const workspaceMeta = (): { startedFrom: StartedFrom; at: string } | undefined =>
  repo().getJson("meta") as { startedFrom: StartedFrom; at: string } | undefined;
const markStarted = (startedFrom: StartedFrom) => repo().setJson("meta", { startedFrom, at: new Date().toISOString() });

export function exportWorkspace(): Workspace {
  const brands = listBrands();
  const logos: Record<string, string> = {}, originals: Record<string, string> = {};
  for (const b of brands) {
    const png = readLogo(b.id);
    if (png) logos[b.id] = toBase64(png);
    const orig = repo().getBlob(`logos/originals/${b.id}`);
    if (orig) originals[b.id] = toBase64(orig);
  }
  return WorkspaceSchema.parse({
    format: WORKSPACE_FORMAT, version: 1, exportedAt: new Date().toISOString(),
    brands: brands.map((b) => ({ ...b, hasLogo: undefined })), presets: listPresets(), batch: readBatch(),
    saved: listSavedBatches(), templates: listTemplates(), rules: readRules(), logos, originals,
  });
}

/** Parse a backup file, with a friendly error when it isn't one (or is a template set). */
export function parseWorkspace(raw: unknown): Workspace {
  const fmt = raw && typeof raw === "object" ? (raw as { format?: unknown }).format : undefined;
  if (fmt === "sign-o-matic/template-set") throw new Error("That's a template set, not a full backup. Import it on the Templates tab instead.");
  if (fmt !== WORKSPACE_FORMAT) throw new Error("That file isn't a Sign-O-Matic backup");
  const r = WorkspaceSchema.safeParse(raw);
  if (!r.success) throw new Error(`The backup is damaged: ${r.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  return r.data;
}

export function summarizeWorkspace(w: Workspace) {
  return {
    exportedAt: w.exportedAt, brands: w.brands.length, logos: Object.keys(w.logos).length, presets: w.presets.length,
    templates: w.templates.length, saved: w.saved.length, signs: w.batch.items.reduce((n, s) => n + s.copies, 0),
    abbreviations: w.rules.abbreviations.length,
  };
}

/** Remove everything (brands, logos, batches, templates, rules). */
function wipe(): void {
  const r = repo();
  for (const id of r.list("logos/originals/")) r.remove(`logos/originals/${id}`);
  for (const id of r.list("logos/")) r.remove(`logos/${id}`);
  for (const id of r.list("batches/")) r.remove(`batches/${id}`);
  for (const k of ["brands", "presets", "batch", "templates", "rules", "meta"]) r.remove(k);
}

/** Replace the whole workspace with a backup. Validates everything before touching anything. */
export function restoreWorkspace(raw: unknown): ReturnType<typeof summarizeWorkspace> {
  const w = parseWorkspace(raw);
  const known = new Set(w.brands.map((b) => b.id));
  const stray = Object.keys({ ...w.logos, ...w.originals }).filter((id) => !known.has(id) || !/^[a-z0-9-]+$/.test(id));
  if (stray.length) throw new Error(`The backup is damaged: logos for unknown brands (${stray.slice(0, 3).join(", ")})`);
  wipe();
  const r = repo();
  saveBrands(w.brands);
  for (const [id, b64] of Object.entries(w.logos)) r.setBlob(`logos/${id}`, fromBase64(b64));
  for (const [id, b64] of Object.entries(w.originals)) r.setBlob(`logos/originals/${id}`, fromBase64(b64));
  savePresets(w.presets);
  r.setJson("templates", w.templates);
  writeRules(w.rules);
  for (const s of w.saved) r.setJson(`batches/${s.id}`, s);
  r.setJson("batch", w.batch); // straight write: an old backup may predate the page cap
  markStarted("backup");
  return summarizeWorkspace(w);
}

/** Empty workspace: no brands, built-in + example templates, default text rules. */
export function startFromScratch(): void {
  wipe();
  saveBrands([]);
  savePresets([]);
  writeBatch({ items: [], options: DEFAULT_OPTIONS });
  writeRules(DEFAULT_RULES);
  markStarted("scratch");
}

/** The made-up sample brands (fake logos), a few presets and a small batch to play with. */
export interface SampleData { brands: Brand[]; presets: Preset[]; logos: Record<string, Uint8Array> }
export const SAMPLE_BATCH_CSV = `brand,collection,percent,copies
Northwind,Harbor Line,50,2
Kestrel & Vale,Field Master Automatic,60,2
tidemark,MODELS,40,2
orbital,Deep Field Chronograph,80,2
lumen,Dusk,30,2`;
export function startWithSamples(seed: SampleData): void {
  wipe();
  saveBrands(seed.brands.map((b) => BrandSchema.parse(b)));
  for (const [id, png] of Object.entries(seed.logos)) repo().setBlob(`logos/${id}`, png);
  savePresets(seed.presets.map((p) => PresetSchema.parse(p)));
  writeRules(DEFAULT_RULES);
  writeBatch({ items: [], options: DEFAULT_OPTIONS });
  writeBatch({ items: csvToSigns(SAMPLE_BATCH_CSV), options: DEFAULT_OPTIONS });
  markStarted("samples");
}
