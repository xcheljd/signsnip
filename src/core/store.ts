import { z } from "zod";
import { batchPages, pageLimitError } from "./geometry.js";
import { fromBase64, hashBytes, imageKind, imageOps, prepareBackground, prepareLogo, rasterInfo, removeBackground, toBase64, type LogoInfo } from "./images.js";
import { DamagedData, repo } from "./repo.js";
import {
  BatchSchema, BrandSchema, DEFAULT_OPTIONS, DEFAULT_RULES, PresetSchema, RulesSchema, SavedBatchSchema, TemplateSchema, TemplateSetSchema,
  type Batch, type Brand, type Preset, type Rules, type SavedBatch, type Template, type TemplateSet,
} from "./types.js";
import { DEFAULT_TEMPLATES, isBuiltin } from "./template.js";

export type { LogoBackground, LogoInfo } from "./images.js";

/** Business logic over the storage interface (repo.ts). Runs on Node (files) and in the browser (IndexedDB). */

/**
 * A stored value that couldn't be read. The app carries on with the default for that part
 * (no brands, an empty batch...), so one damaged file never stops it; the damaged value is
 * copied aside first (FsRepo: data/damaged/), before anything can save the default over it.
 */
export interface DataProblem { key: string; message: string; keptAt?: string }
const problems = new Map<string, DataProblem>();
export const dataProblems = (): DataProblem[] => [...problems.values()];

const unreadable = (e: unknown) => e instanceof z.ZodError || e instanceof DamagedData;
/** Record a problem once per key per process, so polling doesn't make a copy every time. */
function noteProblem(key: string, e: unknown) {
  if (!problems.has(key)) problems.set(key, { key, message: (e as Error).message.slice(0, 200), keptAt: repo().setAside?.(key) });
}

function readJson<T>(key: string, schema: z.ZodType<T>, fallback: T): T {
  try {
    const v = repo().getJson(key);
    if (v === undefined) { problems.delete(key); return fallback; }
    const parsed = schema.parse(v);
    problems.delete(key);
    return parsed;
  } catch (e) {
    if (!unreadable(e)) throw e; // disk errors stay errors
    noteProblem(key, e);
    return fallback;
  }
}
const writeJson = (key: string, data: unknown) => repo().setJson(key, data);

const slugify = (s: string, fallback = "brand") =>
  s.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || fallback;

/** Longest id the local server accepts for a brand ("&" -> "and" can make a slug longer than its name). */
export const MAX_ID = 80;
const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
/**
 * The id for a new thing called `name`. Reuses the id of an existing thing with the same name
 * (saving it again updates it); a *different* name that happens to slug the same ("Tom & Co" /
 * "Tom and Co", or two names with no latin letters) gets -2, -3 ... instead of overwriting.
 * New ids are cut to fit MAX_ID with room for the suffix; ids already on disk are never changed.
 */
function idForName(name: string, taken: { id: string; name: string }[], fallback: string): string {
  const same = taken.find((t) => sameName(t.name, name));
  if (same) return same.id;
  const root = slugify(name, fallback).slice(0, MAX_ID - 8).replace(/-+$/, "") || fallback;
  if (!taken.some((t) => t.id === root)) return root;
  let n = 2;
  while (taken.some((t) => t.id === `${root}-${n}`)) n++;
  return `${root}-${n}`;
}

/**
 * Look something up by what a person typed (CSV cells): an exact id wins, then an exact
 * name; otherwise every name that contains it. Nothing typed matches nothing. Callers act only on a
 * single match, so a vague name can never pick (or delete) the wrong thing.
 */
function matchRef<T extends { id: string; name: string }>(all: T[], ref: string, partialId = false): T[] {
  const r = ref.trim().toLowerCase();
  if (!r) return [];
  const byId = all.filter((x) => x.id === r);
  if (byId.length) return byId;
  const exact = all.filter((x) => x.name.toLowerCase() === r);
  return exact.length ? exact : all.filter((x) => x.name.toLowerCase().includes(r) || (partialId && x.id.includes(r)));
}

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
/** what a typed brand could mean (see matchRef) */
export const brandMatches = (ref: string): Brand[] => matchRef(listBrands(), ref, true);
/** the brand with exactly this id (for ids stored on signs: never a partial match) */
export const getBrand = (id: string): Brand | undefined => listBrands().find((b) => b.id === id);
/**
 * Save a brand: by `id`, or else by name (see idForName). This is the one place that decides
 * whether a brand is new; `created` says which it was, so callers never have to guess.
 */
export function upsertBrand(input: { id?: string; name: string; collections?: string[]; logoScale?: number }): Brand & { created: boolean } {
  const brands = listBrands();
  const typed = input.name.trim();
  if (!typed) throw new Error("A brand needs a name");
  const id = input.id ?? idForName(typed, brands, "brand");
  const idx = brands.findIndex((b) => b.id === id);
  const prev = idx >= 0 ? brands[idx] : undefined;
  // Saving by id is an edit, so the name may change. Adding a name that already exists
  // ("tom & co " for "Tom & Co") updates that brand but keeps the name it already has.
  const name = input.id || !prev ? typed : prev.name;
  const brand = BrandSchema.parse({
    id, name, collections: input.collections ?? prev?.collections ?? [],
    logoScale: input.logoScale ?? prev?.logoScale ?? 1, hasLogo: prev?.hasLogo ?? false,
  });
  if (idx >= 0) brands[idx] = brand; else brands.push(brand);
  saveBrands(brands);
  return { ...brand, hasLogo: repo().getBlob(LOGO(id)) !== null, created: !prev };
}
/**
 * Add a brand by name (or update the one with that name), optionally with a logo. The logo is
 * read and converted *before* anything is written, so a file that isn't a picture changes nothing.
 */
export async function addBrand(input: { name: string; collections?: string[] }, logo?: Uint8Array): Promise<Brand & { created: boolean }> {
  const png = logo
    ? await prepareLogo(logo).then((r) => r.png, (e: Error) => { throw new Error(`that file isn't a picture SignSnip can read (${e.message})`); })
    : undefined;
  const brand = upsertBrand(input);
  if (png) storeLogo(brand.id, png);
  return { ...brand, hasLogo: brand.hasLogo || !!png };
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
  storeLogo(brandId, png);
  return { aspect: raster.width / raster.height };
}
function storeLogo(brandId: string, png: Uint8Array) {
  repo().setBlob(LOGO(brandId), png);
  repo().remove(ORIG(brandId)); // a fresh upload supersedes any old backup
  infoCache.delete(brandId);
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

// ---------- background pictures (shared by templates; stored once per distinct picture)
const BG = (id: string) => `backgrounds/${id}`;
export const readBackground = (id: string): Uint8Array | null => repo().getBlob(BG(id));
/** Store a picture for a template background. Returns what goes in template.background. */
export async function saveBackground(input: Uint8Array): Promise<{ image: string; aspect: number }> {
  const { bytes, aspect } = await prepareBackground(input);
  const image = hashBytes(bytes);
  if (!repo().getBlob(BG(image))) repo().setBlob(BG(image), bytes);
  recentUploads.set(image, Date.now()); // also when it was already stored: the user just picked it again
  return { image, aspect };
}
/**
 * Pictures picked in the designer in this process (the local server, or the hosted tab), by time.
 * A picture is stored as soon as it's picked but its template only when the user presses Save,
 * so saving some other template in between must not delete it. Once a saved template uses the
 * picture it's no longer a draft's, and the usual rule applies again (unused = deleted).
 */
const RECENT_MS = 24 * 60 * 60 * 1000;
const recentUploads = new Map<string, number>();
/** Delete stored pictures no template uses any more (a draft's picture picked in the last 24 hours counts as used). */
export function pruneBackgrounds(keep: Iterable<string> = []): void {
  const templateImages = listTemplates().flatMap((t) => (t.background ? [t.background.image] : []));
  const now = Date.now();
  for (const id of templateImages) recentUploads.delete(id);
  for (const [id, at] of recentUploads) if (now - at > RECENT_MS) recentUploads.delete(id);
  const used = new Set([...templateImages, ...keep, ...recentUploads.keys()]);
  for (const id of repo().list("backgrounds/")) if (!used.has(id)) repo().remove(BG(id));
}
function writeImages(images: Record<string, string>, ids: Set<string>): void {
  for (const [id, b64] of Object.entries(images)) {
    if (!ids.has(id) || repo().getBlob(BG(id))) continue;
    const bytes = fromBase64(b64);
    if (!imageKind(bytes)) throw new Error(`The file is damaged: background ${id} isn't a PNG or JPEG`);
    repo().setBlob(BG(id), bytes);
  }
}

// ---------- presets
export const listPresets = (): Preset[] => readJson("presets", z.array(PresetSchema), []);
export function savePresets(p: Preset[]): void { writeJson("presets", p); }

// ---------- batch (shared by every window on the local server)
export const readBatch = (): Batch => readJson("batch", BatchSchema, { items: [], options: DEFAULT_OPTIONS });
export function writeBatch(b: Batch): Batch {
  const parsed = BatchSchema.parse(b);
  // can't grow past the page limit (an older, bigger batch may still shrink)
  const over = pageLimitError(parsed);
  // read first even when not needed: a damaged batch.json is copied aside before this write replaces it
  const before = readBatch();
  if (over && batchPages(parsed) > batchPages(before)) throw new Error(over);
  writeJson("batch", parsed);
  return parsed;
}

// ---------- saved batches ("Holiday sale", "Spring clearance")
/** Saved batches that can be read; a damaged one is skipped and reported (see dataProblems). */
export function listSavedBatches(): SavedBatch[] {
  const bad = new Set<string>();
  const out = repo().list("batches/").flatMap((id) => {
    const key = `batches/${id}`;
    try { return [SavedBatchSchema.parse(repo().getJson(key))]; } catch (e) {
      if (!unreadable(e)) throw e;
      bad.add(key); noteProblem(key, e);
      return [];
    }
  });
  // a saved batch that was fixed or deleted stops being reported
  for (const key of [...problems.keys()]) if (key.startsWith("batches/") && !bad.has(key)) problems.delete(key);
  return out.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}
export const savedBatchMatches = (ref: string): SavedBatch[] => matchRef(listSavedBatches(), ref);
export function saveNamedBatch(name: string, batch: Batch = readBatch()): SavedBatch & { replaced: boolean } {
  const saved = SavedBatchSchema.parse({ id: idForName(name, listSavedBatches(), "batch"), name: name.trim(), savedAt: new Date().toISOString(), batch });
  // list, not getJson: a damaged file under this id (already set aside by listSavedBatches) must not throw
  const replaced = repo().list("batches/").includes(saved.id);
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

export const templateMatches = (ref: string): Template[] => matchRef(listTemplates(), ref);

export function saveTemplate(t: Template): Template {
  const parsed = TemplateSchema.parse({ ...t, updatedAt: new Date().toISOString() });
  if (parsed.background && !readBackground(parsed.background.image)) throw new Error("The background picture is missing. Add it again.");
  const all = listTemplates();
  const i = all.findIndex((x) => x.id === parsed.id);
  if (i >= 0) all[i] = parsed; else all.push(parsed);
  writeTemplates(all);
  pruneBackgrounds();
  return parsed;
}

export function uniqueTemplateId(base: string, taken = listTemplates()): string {
  const root = slugify(base, "template").slice(0, 34);
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
  pruneBackgrounds();
}
export function resetTemplate(id: string): Template {
  const d = DEFAULT_TEMPLATES.find((t) => t.id === id);
  if (!d) throw new Error(`"${id}" has no original to reset to`);
  const t = saveTemplate(structuredClone(d));
  pruneBackgrounds();
  return t;
}

export function exportTemplateSet(ids?: string[], name?: string): TemplateSet {
  const all = listTemplates();
  const pick = ids?.length ? ids.map((id) => all.find((t) => t.id === id) ?? (() => { throw new Error(`No template "${id}"`); })()) : all;
  const images: Record<string, string> = {};
  for (const t of pick) if (t.background) {
    const b = readBackground(t.background.image);
    if (b) images[t.background.image] = toBase64(b);
  }
  return TemplateSetSchema.parse({ format: "signsnip/template-set", version: 1, name, exportedAt: new Date().toISOString(), templates: pick, images });
}

const sameLayout = (a: Template, b: Template) =>
  JSON.stringify({ ...a, updatedAt: undefined }) === JSON.stringify({ ...b, updatedAt: undefined });
/** same design regardless of id/name (catches re-importing something already imported as a copy) */
const sameDesign = (a: Template, b: Template) =>
  JSON.stringify([a.kind, a.safeMargin, a.objects, a.background ?? null]) === JSON.stringify([b.kind, b.safeMargin, b.objects, b.background ?? null]);

export interface ImportResult { added: string[]; replaced: string[]; renamed: { from: string; to: string }[]; unchanged: string[] }
export interface SetPreview {
  name?: string; exportedAt: string;
  templates: { id: string; name: string; kind: "percent" | "price"; objects: number; status: "new" | "same" | "conflict"; mine?: string }[];
}

/** Parse a template-set file (throws a friendly error if it isn't one). */
export function parseTemplateSet(raw: unknown): TemplateSet {
  if (!raw || typeof raw !== "object" || !["signsnip/template-set", "sign-o-matic/template-set"].includes(String((raw as { format?: string }).format))) {
    throw new Error("That file isn't a SignSnip template set");
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
  const imported2 = all.filter((t) => imported.has(t.id));
  writeImages(set.images ?? {}, new Set(imported2.flatMap((t) => (t.background ? [t.background.image] : []))));
  // a picture missing from the file: keep the template, drop the background it can't show
  const fixed = all.map((t) => (t.background && !readBackground(t.background.image) ? { ...t, background: undefined } : t));
  writeTemplates(fixed.map((t) => TemplateSchema.parse(t)));
  pruneBackgrounds();
  return res;
}

// ---------- text-fitting rules
export const readRules = (): Rules => readJson("rules", RulesSchema, DEFAULT_RULES);
export function writeRules(r: Rules): Rules {
  const parsed = RulesSchema.parse(r);
  readRules(); // a damaged rules.json is copied aside before this write replaces it
  // one entry per word (case-insensitive); last one wins
  const seen = new Map<string, (typeof parsed.abbreviations)[number]>();
  for (const a of parsed.abbreviations) seen.set(a.from.toLowerCase(), a);
  const clean = { ...parsed, abbreviations: [...seen.values()] };
  writeJson("rules", clean);
  return clean;
}
