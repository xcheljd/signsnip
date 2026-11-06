import { z } from "zod";
import { batchPages, pageLimitError } from "./geometry.js";
import { imageOps, prepareLogo, rasterInfo, removeBackground, type LogoInfo } from "./images.js";
import { repo } from "./repo.js";
import {
  BatchSchema, BrandSchema, DEFAULT_OPTIONS, DEFAULT_RULES, PresetSchema, RulesSchema, SavedBatchSchema, TemplateSchema, TemplateSetSchema,
  type Batch, type Brand, type Preset, type Rules, type SavedBatch, type Template, type TemplateSet,
} from "./types.js";
import { DEFAULT_TEMPLATES, isBuiltin } from "./template.js";

export type { LogoBackground, LogoInfo } from "./images.js";

/** Business logic over the storage interface (repo.ts). Runs on Node (files) and in the browser (IndexedDB). */

function readJson<T>(key: string, schema: z.ZodType<T>, fallback: T): T {
  const v = repo().getJson(key);
  return v === undefined ? fallback : schema.parse(v);
}
const writeJson = (key: string, data: unknown) => repo().setJson(key, data);

export const slugify = (s: string) =>
  s.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "brand";

// ---------- brands
const LOGO = (id: string) => `logos/${id}`;
/** Backup taken before an automatic edit (background removal) so it can be restored. */
const ORIG = (id: string) => `logos/originals/${id}`;

export function listBrands(): Brand[] {
  const brands = readJson("brands", z.array(BrandSchema), []);
  return brands.map((b) => ({ ...b, hasLogo: repo().getBlob(LOGO(b.id)) !== null }));
}
export function saveBrands(brands: Brand[]): void {
  writeJson("brands", brands.map((b) => ({ ...b, hasLogo: undefined })));
}
/** exact id/name first; a partial name only counts when it matches exactly one brand */
export function brandMatches(ref: string): Brand[] {
  const r = ref.trim().toLowerCase();
  if (!r) return [];
  const all = listBrands();
  const exact = all.filter((b) => b.id === r || b.name.toLowerCase() === r);
  return exact.length ? exact : all.filter((b) => b.name.toLowerCase().includes(r) || b.id.includes(r));
}
export function findBrand(ref: string): Brand | undefined {
  const m = brandMatches(ref);
  return m.length === 1 ? m[0] : undefined;
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
  return { ...brand, hasLogo: repo().getBlob(LOGO(id)) !== null };
}
export function deleteBrand(id: string): void {
  saveBrands(listBrands().filter((b) => b.id !== id));
  repo().remove(LOGO(id));
  repo().remove(ORIG(id));
  infoCache.delete(id);
}

// ---------- logos
export const readLogo = (brandId: string): Uint8Array | null => repo().getBlob(LOGO(brandId));

/**
 * Accept any PNG/JPG/WebP/SVG/GIF, trim the empty border (so the logo fills its box),
 * cap the size, and store as PNG. Returns the stored aspect ratio.
 */
export async function saveLogo(brandId: string, input: Uint8Array): Promise<{ aspect: number }> {
  if (!listBrands().some((b) => b.id === brandId)) throw new Error(`Unknown brand "${brandId}"`);
  const { png, raster } = await prepareLogo(input);
  repo().setBlob(LOGO(brandId), png);
  repo().remove(ORIG(brandId)); // a fresh upload supersedes any old backup
  infoCache.delete(brandId);
  return { aspect: raster.width / raster.height };
}

const infoCache = new Map<string, { stamp: number; info: Omit<LogoInfo, "hasOriginal"> }>();

/** Pixel size + whether the logo sits on an opaque box. Cached until the logo changes. */
export async function logoInfo(brandId: string): Promise<LogoInfo | null> {
  const r = repo();
  const bytes = r.getBlob(LOGO(brandId));
  if (!bytes) return null;
  const stamp = r.stamp(LOGO(brandId));
  const hasOriginal = r.getBlob(ORIG(brandId)) !== null;
  const hit = infoCache.get(brandId);
  if (hit && hit.stamp === stamp) return { ...hit.info, hasOriginal };
  const info = rasterInfo(await imageOps().decode(bytes));
  infoCache.set(brandId, { stamp, info });
  return { ...info, hasOriginal };
}

/** Make the logo's background transparent (see images.ts). Backs up the original first. */
export async function removeLogoBackground(brandId: string): Promise<LogoInfo> {
  const r = repo();
  const bytes = r.getBlob(LOGO(brandId));
  if (!bytes) throw new Error(`"${brandId}" has no logo`);
  const cleared = removeBackground(await imageOps().decode(bytes));
  if (!r.getBlob(ORIG(brandId))) r.setBlob(ORIG(brandId), bytes);
  r.setBlob(LOGO(brandId), await imageOps().encodePng(cleared));
  infoCache.delete(brandId);
  return (await logoInfo(brandId))!;
}

export async function restoreLogo(brandId: string): Promise<void> {
  const r = repo();
  const orig = r.getBlob(ORIG(brandId));
  if (!orig) throw new Error("No original to restore");
  r.setBlob(LOGO(brandId), orig);
  r.remove(ORIG(brandId));
  infoCache.delete(brandId);
}

// ---------- presets
export const listPresets = (): Preset[] => readJson("presets", z.array(PresetSchema), []);
export function savePresets(p: Preset[]): void { writeJson("presets", p); }

// ---------- batch (shared between web UI and CLI)
export const readBatch = (): Batch => readJson("batch", BatchSchema, { items: [], options: DEFAULT_OPTIONS });
export function writeBatch(b: Batch): Batch {
  const parsed = BatchSchema.parse(b);
  // can't grow past the page limit (an older, bigger batch may still shrink)
  const over = pageLimitError(parsed);
  if (over && batchPages(parsed) > batchPages(readBatch())) throw new Error(over);
  writeJson("batch", parsed);
  return parsed;
}

// ---------- saved batches ("Holiday sale", "Spring clearance")
export function listSavedBatches(): SavedBatch[] {
  return repo().list("batches/")
    .map((id) => SavedBatchSchema.parse(repo().getJson(`batches/${id}`)))
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}
export function findSavedBatch(ref: string): SavedBatch | undefined {
  const r = ref.trim().toLowerCase();
  const all = listSavedBatches();
  return all.find((b) => b.id === r) ?? all.find((b) => b.name.toLowerCase() === r) ?? all.find((b) => b.name.toLowerCase().includes(r));
}
export function saveNamedBatch(name: string, batch: Batch = readBatch()): SavedBatch & { replaced: boolean } {
  const saved = SavedBatchSchema.parse({ id: slugify(name), name: name.trim(), savedAt: new Date().toISOString(), batch });
  const replaced = repo().getJson(`batches/${saved.id}`) !== undefined;
  writeJson(`batches/${saved.id}`, saved);
  return { ...saved, replaced };
}
export function deleteSavedBatch(id: string): void { repo().remove(`batches/${id}`); }

// ---------- templates
/** All templates. Built-ins are always present (restored from defaults if missing). */
export function listTemplates(): Template[] {
  const saved = readJson("templates", z.array(TemplateSchema), DEFAULT_TEMPLATES);
  const missing = DEFAULT_TEMPLATES.filter((d) => isBuiltin(d.id) && !saved.some((t) => t.id === d.id));
  return [...missing, ...saved];
}
function writeTemplates(all: Template[]) { writeJson("templates", all); }

export function findTemplate(ref: string): Template | undefined {
  const r = ref.trim().toLowerCase();
  const all = listTemplates();
  return all.find((t) => t.id === r) ?? all.find((t) => t.name.toLowerCase() === r) ?? all.find((t) => t.name.toLowerCase().includes(r));
}

export function saveTemplate(t: Template): Template {
  const parsed = TemplateSchema.parse({ ...t, updatedAt: new Date().toISOString() });
  const all = listTemplates();
  const i = all.findIndex((x) => x.id === parsed.id);
  if (i >= 0) all[i] = parsed; else all.push(parsed);
  writeTemplates(all);
  return parsed;
}

export function uniqueTemplateId(base: string, taken = listTemplates()): string {
  const root = slugify(base).slice(0, 34) || "template";
  if (!taken.some((t) => t.id === root)) return root;
  let n = 2;
  while (taken.some((t) => t.id === `${root}-${n}`)) n++;
  return `${root}-${n}`;
}

export function duplicateTemplate(id: string, name?: string): Template {
  const src = listTemplates().find((t) => t.id === id);
  if (!src) throw new Error(`No template "${id}"`);
  const newName = name?.trim() || `${src.name} copy`;
  return saveTemplate({ ...structuredClone(src), id: uniqueTemplateId(newName), name: newName });
}

/** Built-ins can't be deleted (signs fall back to them); they can be reset instead. */
export function deleteTemplate(id: string): void {
  if (isBuiltin(id)) throw new Error(`"${id}" is built in - you can reset it, but not delete it`);
  // templates that fell back to this one stop falling back (instead of pointing at nothing)
  writeTemplates(listTemplates().filter((t) => t.id !== id).map((t) => (t.fallbackId === id ? { ...t, fallbackId: undefined } : t)));
}
export function resetTemplate(id: string): Template {
  const d = DEFAULT_TEMPLATES.find((t) => t.id === id);
  if (!d) throw new Error(`"${id}" has no original to reset to`);
  return saveTemplate(structuredClone(d));
}

export function exportTemplateSet(ids?: string[], name?: string): TemplateSet {
  const all = listTemplates();
  const pick = ids?.length ? ids.map((id) => all.find((t) => t.id === id) ?? (() => { throw new Error(`No template "${id}"`); })()) : all;
  return TemplateSetSchema.parse({ format: "sign-snip/template-set", version: 1, name, exportedAt: new Date().toISOString(), templates: pick });
}

const sameLayout = (a: Template, b: Template) =>
  JSON.stringify({ ...a, updatedAt: undefined }) === JSON.stringify({ ...b, updatedAt: undefined });
/** same design regardless of id/name (catches re-importing something already imported as a copy) */
const sameDesign = (a: Template, b: Template) =>
  JSON.stringify([a.kind, a.safeMargin, a.objects]) === JSON.stringify([b.kind, b.safeMargin, b.objects]);

export interface ImportResult { added: string[]; replaced: string[]; renamed: { from: string; to: string }[]; unchanged: string[] }
export interface SetPreview {
  name?: string; exportedAt: string;
  templates: { id: string; name: string; kind: "percent" | "price"; objects: number; status: "new" | "same" | "conflict"; mine?: string }[];
}

/** Parse a template-set file (throws a friendly error if it isn't one). */
export function parseTemplateSet(raw: unknown): TemplateSet {
  if (!raw || typeof raw !== "object" || !["sign-snip/template-set", "sign-o-matic/template-set"].includes(String((raw as { format?: string }).format))) {
    throw new Error("That file isn't a Sign Snip template set");
  }
  const r = TemplateSetSchema.safeParse(raw);
  if (!r.success) throw new Error(`The template set is damaged: ${r.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  return r.data;
}

/** Look inside a set before importing: which templates are new, identical, or would clash. */
export function inspectTemplateSet(set: TemplateSet): SetPreview {
  const mine = listTemplates();
  return {
    name: set.name, exportedAt: set.exportedAt,
    templates: set.templates.map((t) => {
      const m = mine.find((x) => x.id === t.id);
      const copy = mine.find((x) => x.id !== t.id && sameDesign(x, t));
      const status = m && sameLayout(m, t) ? "same" : copy ? "same" : !m ? "new" : "conflict";
      return { id: t.id, name: t.name, kind: t.kind, objects: t.objects.length, status, mine: m?.name };
    }),
  };
}

/**
 * Bring templates in. Same id + same layout = skipped. Same id + different layout =
 * "keep-both" (imported as a copy, renamed) or "replace" (overwrite yours).
 */
export function importTemplateSet(set: TemplateSet, mode: "keep-both" | "replace" = "keep-both", only?: string[]): ImportResult {
  const res: ImportResult = { added: [], replaced: [], renamed: [], unchanged: [] };
  const all = listTemplates();
  for (const t of set.templates) {
    if (only && !only.includes(t.id)) continue;
    const mine = all.find((x) => x.id === t.id);
    if (!mine) { all.push(t); res.added.push(t.id); continue; }
    if (sameLayout(mine, t)) { res.unchanged.push(t.id); continue; }
    if (mode === "replace") { all[all.indexOf(mine)] = t; res.replaced.push(t.id); continue; }
    const copy = all.find((x) => x.id !== t.id && sameDesign(x, t));
    if (copy) { res.unchanged.push(`${t.id} (as ${copy.id})`); continue; }
    const name = `${t.name} (imported)`.slice(0, 60);
    const id = uniqueTemplateId(name, all);
    all.push({ ...t, id, name });
    res.renamed.push({ from: t.id, to: id });
  }
  // a fallback pointing at a template that got imported under a new id follows it
  const imported = new Set([...res.added, ...res.replaced, ...res.renamed.map((r) => r.to)]);
  for (const t of all) {
    const r = res.renamed.find((x) => x.from === t.fallbackId);
    if (r && imported.has(t.id)) t.fallbackId = r.to;
  }
  writeTemplates(all.map((t) => TemplateSchema.parse(t)));
  return res;
}

// ---------- text-fitting rules
export const readRules = (): Rules => readJson("rules", RulesSchema, DEFAULT_RULES);
export function writeRules(r: Rules): Rules {
  const parsed = RulesSchema.parse(r);
  // one entry per word (case-insensitive); last one wins
  const seen = new Map<string, (typeof parsed.abbreviations)[number]>();
  for (const a of parsed.abbreviations) seen.set(a.from.toLowerCase(), a);
  const clean = { ...parsed, abbreviations: [...seen.values()] };
  writeJson("rules", clean);
  return clean;
}
