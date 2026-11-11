import boldUrl from "@fontsource/carlito/files/carlito-latin-700-normal.woff?url";
import regularUrl from "@fontsource/carlito/files/carlito-latin-400-normal.woff?url";
import seedBrands from "../../../seed/brands.json";
import seedPresets from "../../../seed/presets.json";
import { setImageOps } from "../../../src/core/images";
import { checkSigns, expandCopies, renderCalibration, renderPdf, setFontSource } from "../../../src/core/pdf";
import { repo, setRepo } from "../../../src/core/repo";
import * as store from "../../../src/core/store";
import { BatchSchema, RulesSchema, TemplateSchema, type Brand, type Preset } from "../../../src/core/types";
import { checkWorkspacePictures, exportWorkspace, parseWorkspace, restoreWorkspace, startFromScratch, startWithSamples, summarizeWorkspace, workspaceMeta } from "../../../src/core/workspace";
import { exportBatchFile, importBatchFile, inspectBatchFile, parseBatchFile } from "../../../src/core/batch-file";
import { toast } from "sonner";
import type { Backend, State } from "../api";
import { canvasImages } from "./canvas-images";
import { BACKUP_KEYS, BrowserRepo, markBackedUp, quietly } from "./idb-repo";

const seedLogos = import.meta.glob("../../../seed/logos/*.png", { query: "?url", import: "default", eager: true }) as Record<string, string>;

const bytesOf = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Couldn't load ${url}`);
  return new Uint8Array(await res.arrayBuffer());
};
/** run in a microtask so callers get the same promise-shaped errors as the server backend */
const run = async <T>(fn: () => T | Promise<T>): Promise<T> => fn();

/**
 * The no-server backend: the exact same store / PDF / check code as the local app,
 * on IndexedDB storage, canvas images and bundled fonts.
 */
export async function createBrowserBackend(): Promise<Backend> {
  const r = await BrowserRepo.open();
  setRepo(r);
  r.onError = (e) => toast.error("Couldn't save to this browser's storage", { id: "signsnip-storage", duration: Infinity, description: `${e.message}. Your changes are only in this tab for now - use Back up to keep a copy.` });
  setImageOps(canvasImages);
  setFontSource((w) => bytesOf(w === "bold" ? boldUrl : regularUrl));
  // ask the browser not to evict our data under storage pressure (best effort)
  void navigator.storage?.persist?.().catch(() => {});

  // object URLs for logos, rebuilt whenever a logo changes
  const urls = new Map<string, { stamp: number; url: string }>();
  const logoUrl = (id: string) => {
    const key = `logos/${id}`;
    const stamp = repo().stamp(key);
    const hit = urls.get(id);
    if (hit && hit.stamp === stamp) return hit.url;
    if (hit) URL.revokeObjectURL(hit.url);
    const bytes = store.readLogo(id);
    if (!bytes) return "";
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "image/png" }));
    urls.set(id, { stamp, url });
    return url;
  };

  const getState = async (): Promise<State> => {
    const brands = await Promise.all(store.listBrands().map(async (b) => ({ ...b, logo: await store.logoInfo(b.id) })));
    const saved = store.listSavedBatches().map((s) => ({ id: s.id, name: s.name, savedAt: s.savedAt, signs: s.batch.items.reduce((a, i) => a + i.copies, 0) }));
    const state = { brands, presets: store.listPresets(), batch: store.readBatch(), saved, templates: store.listTemplates(), rules: store.readRules() };
    return { ...state, problems: store.dataProblems() };
  };
  const json = (data: unknown, name: string) => ({ blob: new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }), filename: name });
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  return {
    getState,
    putBatch: (b) => run(() => store.writeBatch(BatchSchema.parse(b))),
    saveBrand: (b) => run(() => store.upsertBrand(b)),
    removeBrand: (id) => run(() => store.deleteBrand(id)),
    uploadLogo: async (id, file) => {
      if (!file.size) throw new Error("Empty upload");
      return store.saveLogo(id, new Uint8Array(await file.arrayBuffer()));
    },
    removeLogoBg: (id) => run(() => store.removeLogoBackground(id)),
    restoreLogo: (id) => run(() => store.restoreLogo(id)),
    logoUrl: (id) => logoUrl(id),
    uploadBackground: async (file) => {
      if (!file.size) throw new Error("Empty upload");
      return store.saveBackground(new Uint8Array(await file.arrayBuffer()));
    },
    backgroundUrl: (image) => {
      // pictures never change under the same id (content hash), so one URL each is enough
      const hit = urls.get(`bg:${image}`);
      if (hit) return hit.url;
      const bytes = store.readBackground(image);
      if (!bytes) return "";
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: bytes[0] === 0xff ? "image/jpeg" : "image/png" }));
      urls.set(`bg:${image}`, { stamp: 0, url });
      return url;
    },
    savePreset: (p) => run(() => { const { name, sign } = store.PresetInputSchema.parse(p); return store.upsertPreset(name, sign); }),
    removePreset: (id) => run(() => store.savePresets(store.listPresets().filter((x) => x.id !== id))),
    check: (items) => checkSigns(items),
    saveBatchAs: (name, batch) => run(() => store.saveNamedBatch(name, BatchSchema.parse(batch))),
    loadSaved: (id) => run(() => {
      const b = store.listSavedBatches().find((x) => x.id === id);
      if (!b) throw new Error("not found");
      return b;
    }),
    deleteSaved: (id) => run(() => store.deleteSavedBatch(id)),
    saveRules: (x) => run(() => store.writeRules(RulesSchema.parse(x))),
    saveTemplate: (t) => run(() => store.saveTemplate(TemplateSchema.parse(t))),
    duplicateTemplate: (id, name) => run(() => store.duplicateTemplate(id, name)),
    resetTemplate: (id) => run(() => store.resetTemplate(id)),
    deleteTemplate: (id) => run(() => store.deleteTemplate(id)),
    exportTemplates: (ids, name) => run(() => json(store.exportTemplateSet(ids, name.trim() || undefined), `${slug(name) || "sign-templates"}.signsnip.json`)),
    inspectSet: (set) => run(() => store.inspectTemplateSet(store.parseTemplateSet(set))),
    importSet: (set, mode, only) => run(() => store.importTemplateSet(store.parseTemplateSet(set), mode, only)),
    fetchPdf: async (items, options, mode, templates) => {
      const signs = mode === "single" ? items.slice(0, 1) : expandCopies(items);
      return renderPdf(signs, options, mode, templates);
    },
    fetchCalibration: (paper) => renderCalibration(paper),
    backup: async () => {
      // A backup is the way out after a storage failure, so it never fails because of one:
      // wait for pending writes, then export this tab's in-memory copy (the full, current work).
      await r.settled();
      markBackedUp();
      return { blob: new Blob([JSON.stringify(exportWorkspace())], { type: "application/json" }), filename: `signsnip-backup-${new Date().toISOString().slice(0, 10)}.signsnip-backup.json` };
    },
    inspectBackup: (raw) => run(() => summarizeWorkspace(parseWorkspace(raw))),
    restoreBackup: (raw) => quietly(async () => {
      await checkWorkspacePictures(raw); // a damaged picture is refused before anything is replaced
      await r.clearFailure(); // report only this restore's own writes
      const s = restoreWorkspace(raw);
      await r.flush();
      markBackedUp(); // what's here now is exactly what's in that file
      localStorage.setItem(BACKUP_KEYS.changed, String(Date.now() - 1));
      return s;
    }),
    start: (from) => quietly(async () => {
      await r.clearFailure();
      if (from === "scratch") startFromScratch();
      else {
        const logos: Record<string, Uint8Array> = {};
        for (const [p, url] of Object.entries(seedLogos)) logos[p.split("/").pop()!.replace(/\.png$/, "")] = await bytesOf(url);
        startWithSamples({ brands: seedBrands as Brand[], presets: seedPresets as Preset[], logos });
      }
      await r.flush();
      // a fresh start has nothing worth backing up yet
      localStorage.removeItem(BACKUP_KEYS.backup);
      localStorage.removeItem(BACKUP_KEYS.changed);
    }),
    shareBatch: (batch, name) => run(() => json(exportBatchFile(BatchSchema.parse(batch), name), `${slug(name) || "batch"}.signsnip-batch.json`)),
    inspectBatchFile: (raw) => run(() => inspectBatchFile(parseBatchFile(raw))),
    importBatchFile: async (raw) => {
      await r.clearFailure(); // report only this import's own writes
      const res = await importBatchFile(raw);
      await r.flush(); // like a restore: say so now if this browser couldn't store it
      return res;
    },
    needsStart: () => workspaceMeta() === undefined,
  };
}
