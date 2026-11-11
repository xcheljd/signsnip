import { z } from "zod";
import { csvToSigns } from "./batch.js";
import { fromBase64, imageKind, imageOps, toBase64 } from "./images.js";
import { DamagedData, repo } from "./repo.js";
import { count } from "./words.js";
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
 * Used by "Back up" / "Restore" in the app and by the start page.
 */
export const WORKSPACE_FORMAT = "signsnip/workspace";
/** backups made before the rename */
export const LEGACY_WORKSPACE_FORMAT = "sign-o-matic/workspace";
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];
const b64Png = z.string().max(8_000_000).refine((s) => {
  const head = fromBase64(s.slice(0, 16));
  return PNG_MAGIC.every((b, i) => head[i] === b);
}, "not a PNG image");

const b64Picture = z.string().max(12_000_000).refine((s) => imageKind(fromBase64(s.slice(0, 16))) !== null, "not a PNG or JPEG image");

export const WorkspaceSchema = z.object({
  format: z.enum([WORKSPACE_FORMAT, LEGACY_WORKSPACE_FORMAT]),
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
  /** template background pictures: image id -> PNG/JPEG (base64) */
  backgrounds: z.record(z.string().regex(/^[a-f0-9]{8,64}$/), b64Picture).default({}),
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
  const templates = listTemplates();
  const backgrounds: Record<string, string> = {};
  for (const t of templates) if (t.background) {
    const b = repo().getBlob(`backgrounds/${t.background.image}`);
    if (b) backgrounds[t.background.image] = toBase64(b);
  }
  return WorkspaceSchema.parse({
    format: WORKSPACE_FORMAT, version: 1, exportedAt: new Date().toISOString(),
    brands: brands.map((b) => ({ ...b, hasLogo: undefined })), presets: listPresets(), batch: readBatch(),
    saved: listSavedBatches(), templates, rules: readRules(), logos, originals, backgrounds,
  });
}

/** Parse a backup file, with a friendly error when it isn't one (or is a template set). */
export function parseWorkspace(raw: unknown): Workspace {
  const fmt = raw && typeof raw === "object" ? (raw as { format?: unknown }).format : undefined;
  if (fmt === "signsnip/template-set" || fmt === "sign-o-matic/template-set") throw new Error("That's a template set, not a full backup. Import it on the Templates tab instead.");
  if (fmt !== WORKSPACE_FORMAT && fmt !== LEGACY_WORKSPACE_FORMAT) throw new Error("That file isn't a SignSnip backup");
  const r = WorkspaceSchema.safeParse(raw);
  if (!r.success) throw new Error(`The backup is damaged: ${r.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  return r.data;
}

export function summarizeWorkspace(w: Workspace) {
  return {
    exportedAt: w.exportedAt, brands: w.brands.length, logos: Object.keys(w.logos).length, presets: w.presets.length,
    templates: w.templates.length, saved: w.saved.length, signs: w.batch.items.reduce((n, s) => n + s.copies, 0),
    abbreviations: w.rules.abbreviations.length, backgrounds: Object.keys(w.backgrounds).length,
  };
}

/** What a backup holds, in words (the restore dialog shows this before replacing anything). */
export function describeSummary(s: { brands: number; logos: number; templates: number; presets: number; saved: number; signs: number }): string {
  return [count(s.brands, "brand"), count(s.logos, "logo"), count(s.templates, "template"), count(s.presets, "preset"), count(s.saved, "saved batch"), `${count(s.signs, "sign")} in the batch`].join(" · ");
}

/** Remove everything (brands, logos, batches, templates, rules). */
function wipe(): void {
  const r = repo();
  for (const id of r.list("logos/originals/")) r.remove(`logos/originals/${id}`);
  for (const id of r.list("logos/")) r.remove(`logos/${id}`);
  for (const id of r.list("batches/")) r.remove(`batches/${id}`);
  for (const id of r.list("backgrounds/")) r.remove(`backgrounds/${id}`);
  for (const k of ["brands", "presets", "batch", "templates", "rules", "meta"]) r.remove(k);
}

/** Decode every picture in a backup, so a damaged one is refused before a restore starts. */
export async function checkWorkspacePictures(raw: unknown): Promise<void> {
  const w = parseWorkspace(raw);
  const all = [
    ...Object.entries(w.logos).map(([id, b]) => [`the logo for ${id}`, b] as const),
    ...Object.entries(w.originals).map(([id, b]) => [`the original logo for ${id}`, b] as const),
    ...Object.entries(w.backgrounds).map(([id, b]) => [`background ${id.slice(0, 8)}`, b] as const),
  ];
  for (const [what, b64] of all) {
    try { await imageOps().decode(fromBase64(b64)); }
    catch { throw new Error(`The backup is damaged: ${what} can't be opened as a picture`); }
  }
}

/** The first id that appears twice, if any. */
function firstDuplicate(ids: string[]): string | undefined {
  const seen = new Set<string>();
  for (const id of ids) { if (seen.has(id)) return id; seen.add(id); }
  return undefined;
}

/** Everything wipe() removes, exactly as stored (raw values, no parsing), so a failed restore can put it back. */
interface Snapshot { json: [string, unknown][]; blobs: [string, Uint8Array][]; complete: boolean }
function snapshot(): Snapshot {
  const r = repo();
  const s: Snapshot = { json: [], blobs: [], complete: true };
  const json = (key: string) => {
    try { const v = r.getJson(key); if (v !== undefined) s.json.push([key, v]); }
    // a value that can't be read (a broken file) can't be put back: keep a copy aside, and say so if the restore fails
    catch (e) { if (!(e instanceof DamagedData)) throw e; r.setAside?.(key); s.complete = false; }
  };
  const blob = (key: string) => { const b = r.getBlob(key); if (b) s.blobs.push([key, b]); };
  for (const k of ["brands", "presets", "batch", "templates", "rules", "meta"]) json(k);
  for (const id of r.list("batches/")) json(`batches/${id}`);
  for (const id of r.list("logos/")) blob(`logos/${id}`);
  for (const id of r.list("logos/originals/")) blob(`logos/originals/${id}`);
  for (const id of r.list("backgrounds/")) blob(`backgrounds/${id}`);
  return s;
}
function putBack(s: Snapshot): void {
  wipe();
  const r = repo();
  for (const [k, v] of s.json) r.setJson(k, v);
  for (const [k, b] of s.blobs) r.setBlob(k, b);
}

/**
 * Replace the whole workspace with a backup. Every check that needs no pictures runs before
 * anything is touched (callers decode the pictures first with checkWorkspacePictures). If a
 * write fails part-way, what was stored before is written back and the error says
 * "nothing was changed"; if that rollback fails too, the error says the restore stopped part-way.
 */
export function restoreWorkspace(raw: unknown): ReturnType<typeof summarizeWorkspace> {
  const w = parseWorkspace(raw);
  const known = new Set(w.brands.map((b) => b.id));
  const stray = Object.keys({ ...w.logos, ...w.originals }).filter((id) => !known.has(id) || !/^[a-z0-9-]+$/.test(id));
  if (stray.length) throw new Error(`The backup is damaged: logos for unknown brands (${stray.slice(0, 3).join(", ")})`);
  for (const [what, ids] of [
    ["brands", w.brands.map((b) => b.id)], ["templates", w.templates.map((t) => t.id)],
    ["presets", w.presets.map((p) => p.id)], ["saved batches", w.saved.map((s) => s.id)],
  ] as const) {
    const dup = firstDuplicate(ids);
    if (dup !== undefined) throw new Error(`The backup is damaged: two ${what} share the id ${dup}`);
  }
  const before = snapshot();
  try {
    writeAll(w);
  } catch (e) {
    const why = (e as Error).message;
    let back = before.complete;
    try { putBack(before); } catch { back = false; }
    if (!back) throw new Error(`Restore failed part-way: ${why}. Restore your last backup file again once the problem is fixed.`);
    throw new Error(`Restore failed and nothing was changed: ${why}`);
  }
  return summarizeWorkspace(w);
}

function writeAll(w: Workspace): void {
  wipe();
  const r = repo();
  saveBrands(w.brands);
  for (const [id, b64] of Object.entries(w.logos)) r.setBlob(`logos/${id}`, fromBase64(b64));
  for (const [id, b64] of Object.entries(w.originals)) r.setBlob(`logos/originals/${id}`, fromBase64(b64));
  for (const [id, b64] of Object.entries(w.backgrounds)) r.setBlob(`backgrounds/${id}`, fromBase64(b64));
  savePresets(w.presets);
  // a template whose picture isn't in the backup keeps its layout, without the background
  r.setJson("templates", w.templates.map((t) => (t.background && !w.backgrounds[t.background.image] ? { ...t, background: undefined } : t)));
  writeRules(w.rules);
  for (const s of w.saved) r.setJson(`batches/${s.id}`, s);
  r.setJson("batch", w.batch); // straight write: an old backup may predate the page cap
  markStarted("backup");
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
  writeBatch({ items: csvToSigns(SAMPLE_BATCH_CSV), options: DEFAULT_OPTIONS });
  markStarted("samples");
}
