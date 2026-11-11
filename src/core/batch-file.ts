import { batchPages, MAX_PAGES } from "./geometry.js";
import { fromBase64, imageKind, imageOps, toBase64 } from "./images.js";
import { repo } from "./repo.js";
import {
  idForName, importTemplateSet, inspectTemplateSet, listBrands, listSavedBatches, listTemplates, readBackground, readLogo, sameLayout, upsertBrand,
  type ImportResult, type SetPreview,
} from "./store.js";
import { DEFAULT_TEMPLATES, isBuiltin, resolveTemplate } from "./template.js";
import {
  BATCH_FILE_FORMAT, BatchFileSchema, SavedBatchSchema, SignSchema,
  type Batch, type BatchFile, type Brand, type SavedBatch, type Sign, type Template, type TemplateSet,
} from "./types.js";
import { count } from "./words.js";

/**
 * "Share as a file" / "Open a shared file": one batch, carried to another device or store.
 * Opening a file only ever ADDS: the batch lands as a new saved batch, brands that are already
 * here (same name) keep their logo and settings, templates go through the template-set import
 * in keep-both mode. Text rules, presets and other saved batches are never part of the file.
 */

/** how deep a template's fallback chain goes (fitSign tries at most 3 fallbacks) */
const MAX_FALLBACKS = 3;
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];
/** a built-in the sender never changed prints the same everywhere, so it isn't carried */
const editedBuiltin = (t: Template) => {
  const d = DEFAULT_TEMPLATES.find((x) => x.id === t.id);
  return !d || !sameLayout(d, t);
};

/** Pack a batch and everything it needs to print the same into one file. */
export function exportBatchFile(batch: Batch, name: string): BatchFile {
  const all = listTemplates();
  const brands = listBrands();
  // a sign whose template is missing prints with its kind's built-in: say so in the file,
  // so it can't pick up some other template with that id on the receiving side
  const items: Sign[] = batch.items.map((s) => {
    const t = resolveTemplate(s, all);
    return s.templateId && t.id !== s.templateId ? { ...s, templateId: t.id } : s;
  });
  const pick = new Map<string, Template>();
  for (const s of items) {
    let t: Template | undefined = resolveTemplate(s, all);
    for (let depth = 0; t && depth <= MAX_FALLBACKS && !pick.has(t.id); depth++) {
      pick.set(t.id, t);
      t = t.fallbackId ? all.find((x) => x.id === t!.fallbackId) : undefined;
    }
  }
  const templates = [...pick.values()]
    .filter((t) => !isBuiltin(t.id) || editedBuiltin(t))
    // a fallback the file doesn't carry (missing here, or past the depth fitSign uses) is dropped,
    // except to a built-in, which every workspace has
    .map((t) => (t.fallbackId && !pick.has(t.fallbackId) && !isBuiltin(t.fallbackId) ? { ...t, fallbackId: undefined } : t));
  const images: Record<string, string> = {};
  for (const t of templates) if (t.background) {
    const b = readBackground(t.background.image);
    if (b) images[t.background.image] = toBase64(b);
  }
  const used = new Set(items.map((s) => s.brandId));
  const picked = brands.filter((b) => used.has(b.id)); // a deleted brand's signs go as they are (no logo on either side)
  const logos: Record<string, string> = {};
  for (const b of picked) { const png = readLogo(b.id); if (png) logos[b.id] = toBase64(png); }
  return BatchFileSchema.parse({
    format: BATCH_FILE_FORMAT, version: 1, name: name.trim(), exportedAt: new Date().toISOString(),
    batch: { ...batch, items }, brands: picked.map((b) => ({ ...b, hasLogo: undefined })), logos,
    // a template with a picture this workspace lost prints without it, so the file says the same
    templates: templates.map((t) => (t.background && !images[t.background.image] ? { ...t, background: undefined } : t)),
    images,
  });
}

const damaged = (why: string) => new Error(`The batch file is damaged: ${why}`);
function firstDuplicate(ids: string[]): string | undefined {
  const seen = new Set<string>();
  for (const id of ids) { if (seen.has(id)) return id; seen.add(id); }
  return undefined;
}

/**
 * Read a batch file, with a plain message for the files people mix up (a full backup,
 * a template set) and for a damaged or oversized one. Nothing is stored.
 */
export function parseBatchFile(raw: unknown): BatchFile {
  const fmt = raw && typeof raw === "object" ? (raw as { format?: unknown }).format : undefined;
  if (fmt === "signsnip/workspace" || fmt === "sign-o-matic/workspace") throw new Error("That's a full backup. Use Restore for it.");
  if (fmt === "signsnip/template-set" || fmt === "sign-o-matic/template-set") throw new Error("That's a template set. Import it on the Templates tab.");
  if (fmt !== BATCH_FILE_FORMAT) throw new Error("That file isn't a SignSnip batch");
  const r = BatchFileSchema.safeParse(raw);
  if (!r.success) throw damaged(r.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  const f = r.data;
  const brandIds = new Set(f.brands.map((b) => b.id));
  const strayLogos = Object.keys(f.logos).filter((id) => !brandIds.has(id) || !/^[a-z0-9-]+$/.test(id));
  if (strayLogos.length) throw damaged(`logos for unknown brands (${strayLogos.slice(0, 3).join(", ")})`);
  const notPng = Object.keys(f.logos).find((id) => !PNG_MAGIC.every((b, i) => fromBase64(f.logos[id]!.slice(0, 16))[i] === b));
  if (notPng) throw damaged(`the logo for ${notPng} isn't a PNG image`);
  const imageIds = new Set(f.templates.flatMap((t) => (t.background ? [t.background.image] : [])));
  const strayImages = Object.keys(f.images).filter((id) => !imageIds.has(id));
  if (strayImages.length) throw damaged(`pictures no template uses (${strayImages.slice(0, 3).map((id) => id.slice(0, 8)).join(", ")})`);
  const notPicture = Object.keys(f.images).find((id) => !imageKind(fromBase64(f.images[id]!.slice(0, 16))));
  if (notPicture) throw damaged(`background ${notPicture.slice(0, 8)} isn't a PNG or JPEG`);
  for (const [what, ids] of [["brands", f.brands.map((b) => b.id)], ["templates", f.templates.map((t) => t.id)], ["signs", f.batch.items.map((s) => s.id)]] as const) {
    const dup = firstDuplicate(ids);
    if (dup !== undefined) throw damaged(`two ${what} share the id ${dup}`);
  }
  const pages = batchPages(f.batch);
  if (pages > MAX_PAGES) {
    const signs = f.batch.items.reduce((n, s) => n + s.copies, 0);
    throw new Error(`That batch is too big to open here: ${count(pages, "page")} (${count(signs, "sign")}). The limit is ${count(MAX_PAGES, "page")}. Ask whoever sent it to split it into smaller batches.`);
  }
  return f;
}

/** Decode every picture in the file, so a damaged one is refused before anything is written. */
export async function checkBatchFilePictures(f: BatchFile): Promise<void> {
  const all = [
    ...Object.entries(f.logos).map(([id, b]) => [`the logo for ${id}`, b] as const),
    ...Object.entries(f.images).map(([id, b]) => [`background ${id.slice(0, 8)}`, b] as const),
  ];
  for (const [what, b64] of all) {
    try { await imageOps().decode(fromBase64(b64)); }
    catch { throw damaged(`${what} can't be opened as a picture`); }
  }
}

/** The brand here that a brand in the file stands for: same name (the matching upsertBrand uses), or none. */
function brandHere(b: Brand, mine: Brand[]): Brand | undefined {
  const id = idForName(b.name, mine, "brand");
  return mine.find((x) => x.id === id); // idForName only returns a taken id for the same name
}
const templateSet = (f: BatchFile): TemplateSet =>
  ({ format: "signsnip/template-set", version: 1, name: f.name, exportedAt: f.exportedAt, templates: f.templates, images: f.images });
const usedBrands = (f: BatchFile) => {
  const used = new Set(f.batch.items.map((s) => s.brandId));
  return f.brands.filter((b) => used.has(b.id));
};

export interface BatchFilePreview {
  name: string; exportedAt: string;
  /** rows, printed signs (copies count), printed pages */
  signs: number; copies: number; pages: number;
  /** "yours": a brand with this name is already here, and it stays as it is (its logo is used) */
  brands: { name: string; status: "new" | "yours" }[];
  /** "conflict": a different template has this id here; both are kept (the file's one as a copy) */
  templates: SetPreview["templates"];
}

/** What opening the file would add, before anything is written. */
export function inspectBatchFile(f: BatchFile): BatchFilePreview {
  const mine = listBrands();
  const templates = f.templates.length ? inspectTemplateSet(templateSet(f)).templates : [];
  return {
    name: f.name, exportedAt: f.exportedAt,
    signs: f.batch.items.length, copies: f.batch.items.reduce((n, s) => n + s.copies, 0), pages: batchPages(f.batch),
    brands: usedBrands(f).map((b) => ({ name: b.name, status: brandHere(b, mine) ? "yours" : "new" })),
    // a template whose id isn't here is added as it is, even when a look-alike exists under another id
    templates: templates.map((t) => (t.mine === undefined ? { ...t, status: "new" } : t)),
  };
}

export interface BatchFileResult {
  savedId: string; savedName: string;
  brands: { added: string[]; kept: string[] };
  templates: ImportResult;
}

/** A name for the new saved batch that no saved batch has yet: "Friday sale", then "Friday sale (2)"... */
function freshSaved(name: string, saved: SavedBatch[]): { id: string; name: string } {
  // a saved batch that can't be read still owns its id: never write over it
  const taken = [...saved, ...repo().list("batches/").filter((id) => !saved.some((s) => s.id === id)).map((id) => ({ id, name: "" }))];
  const base = name.trim().slice(0, 60).trim();
  for (let n = 1; ; n++) {
    const suffix = n === 1 ? "" : ` (${n})`;
    const candidate = `${base.slice(0, 60 - suffix.length).trim()}${suffix}`;
    const id = idForName(candidate, taken, "batch");
    if (!taken.some((t) => t.id === id)) return { id, name: candidate };
  }
}

/**
 * Open a shared batch: check everything (pictures decoded) before the first write, then add
 * new brands (logo first), add templates (keep-both), point the signs at what they are called
 * here, and save the batch as a new saved batch. If a write fails part-way, what this import
 * added is taken out again. The current batch is not touched.
 */
export async function importBatchFile(raw: unknown): Promise<BatchFileResult> {
  const f = parseBatchFile(raw);
  await checkBatchFilePictures(f);
  const items = f.batch.items.map((s) => SignSchema.parse(s));
  const r = repo();
  const before = {
    brands: r.getJson("brands"), templates: r.getJson("templates"),
    logos: new Set(r.list("logos/")), backgrounds: new Set(r.list("backgrounds/")), batches: new Set(r.list("batches/")),
  };
  try {
    const brandMap = new Map<string, string>();
    const res: BatchFileResult["brands"] = { added: [], kept: [] };
    for (const b of usedBrands(f)) {
      const mine = listBrands();
      const here = brandHere(b, mine);
      if (here) { brandMap.set(b.id, here.id); res.kept.push(here.name); continue; }
      const id = idForName(b.name, mine, "brand");
      const logo = f.logos[b.id];
      if (logo) r.setBlob(`logos/${id}`, fromBase64(logo)); // logo before the brand, like addBrand
      upsertBrand({ id, name: b.name, collections: b.collections, logoScale: b.logoScale });
      brandMap.set(b.id, id);
      res.added.push(b.name);
    }
    const templates: ImportResult = f.templates.length
      ? importTemplateSet(templateSet(f), "keep-both")
      : { added: [], replaced: [], renamed: [], unchanged: [], idMap: {} };
    if (templates.replaced.length) throw new Error("a template would have been replaced"); // keep-both never does; guard anyway
    const pointed = items.map((s) => {
      const tid = s.templateId ?? s.kind;
      const to = templates.idMap[tid];
      return SignSchema.parse({ ...s, brandId: brandMap.get(s.brandId) ?? s.brandId, templateId: to && to !== tid ? to : s.templateId });
    });
    const target = freshSaved(f.name, listSavedBatches());
    const saved = SavedBatchSchema.parse({ id: target.id, name: target.name, savedAt: new Date().toISOString(), batch: { ...f.batch, items: pointed } });
    r.setJson(`batches/${saved.id}`, saved);
    return { savedId: saved.id, savedName: saved.name, brands: res, templates };
  } catch (e) {
    // take out what this import added; nothing that was here before was changed
    const put = (key: string, v: unknown) => (v === undefined ? r.remove(key) : r.setJson(key, v));
    try {
      put("brands", before.brands);
      put("templates", before.templates);
      for (const id of r.list("logos/")) if (!before.logos.has(id)) r.remove(`logos/${id}`);
      for (const id of r.list("backgrounds/")) if (!before.backgrounds.has(id)) r.remove(`backgrounds/${id}`);
      for (const id of r.list("batches/")) if (!before.batches.has(id)) r.remove(`batches/${id}`);
    } catch {
      throw new Error(`Opening the file stopped part-way: ${(e as Error).message}. Some of its brands or templates may have been added.`);
    }
    throw new Error(`Opening the file failed and nothing was added: ${(e as Error).message}`);
  }
}
