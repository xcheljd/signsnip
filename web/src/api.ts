import type { Batch, Brand, Options, Preset, Rules, SavedBatch, Sign, Template, Warning } from "../../src/core/types";
import type { ImportResult, LogoInfo, SetPreview } from "../../src/core/store";
import type { BatchFilePreview, BatchFileResult } from "../../src/core/batch-file";

export type { BatchFilePreview, BatchFileResult, ImportResult, LogoInfo, SetPreview };
export type BrandWithLogo = Brand & { logo: LogoInfo | null };
export interface SavedSummary { id: string; name: string; savedAt: string; signs: number }
export interface State {
  brands: BrandWithLogo[]; presets: Preset[]; batch: Batch; saved: SavedSummary[]; templates: Template[]; rules: Rules;
  /** stored parts that couldn't be read; the app started without them (keptAt = where a copy was kept) */
  problems?: { key: string; message: string; keptAt?: string }[];
}
export interface Pdf { bytes: Uint8Array; pages: number; signs: number }
export interface Download { blob: Blob; filename: string }
export interface BackupSummary { exportedAt: string; brands: number; logos: number; presets: number; templates: number; saved: number; signs: number; abbreviations: number; backgrounds?: number }

/**
 * Everything the UI can ask for. Two implementations:
 *  - "server" (default): the local hono server, data/ on disk, shared by every window
 *  - "browser": no server; data in this browser's IndexedDB (the hosted, static build)
 */
export interface Backend {
  getState(): Promise<State>;
  /** `closing`: the page is being hidden or closed, so the save must outlive it */
  putBatch(b: Batch, closing?: boolean): Promise<Batch>;
  /** `created`: false when a brand with this name already existed and was updated; `closing`: the page is being hidden or closed */
  saveBrand(b: { id?: string; name: string; collections?: string[]; logoScale?: number }, closing?: boolean): Promise<Brand & { created: boolean }>;
  removeBrand(id: string): Promise<unknown>;
  uploadLogo(id: string, file: File): Promise<{ aspect: number }>;
  removeLogoBg(id: string): Promise<LogoInfo>;
  restoreLogo(id: string): Promise<unknown>;
  /** an <img src> for the brand's logo; `version` busts caches when the logo changes */
  logoUrl(id: string, version: string): string;
  /** store a picture for a template background */
  uploadBackground(file: File): Promise<{ image: string; aspect: number }>;
  backgroundUrl(image: string): string;
  savePreset(p: { name: string; sign: Preset["sign"] }): Promise<Preset>;
  removePreset(id: string): Promise<unknown>;
  /** undo a delete: the preset back at `index`; one made since under its name or id is kept and this one comes back renamed */
  restorePreset(p: Preset, index: number): Promise<Preset & { renamed: boolean }>;
  check(items: Sign[]): Promise<Warning[]>;
  saveBatchAs(name: string, batch: Batch): Promise<SavedBatch>;
  loadSaved(id: string): Promise<SavedBatch>;
  deleteSaved(id: string): Promise<unknown>;
  /** undo a delete: the saved batch as it was; one saved under its name since is kept and this one comes back renamed */
  restoreSaved(s: SavedBatch): Promise<SavedBatch & { renamed: boolean }>;
  /** closing: the page is being hidden or closed, so the save must outlive it (keepalive, like putBatch) */
  saveRules(r: Rules, closing?: boolean): Promise<Rules>;
  saveTemplate(t: Template): Promise<Template>;
  duplicateTemplate(id: string, name?: string): Promise<Template>;
  resetTemplate(id: string): Promise<Template>;
  deleteTemplate(id: string): Promise<unknown>;
  exportTemplates(ids: string[], name: string): Promise<Download>;
  inspectSet(set: unknown): Promise<SetPreview>;
  importSet(set: unknown, mode: "keep-both" | "replace", only: string[]): Promise<ImportResult>;
  fetchPdf(items: Sign[], options: Options, mode: "sheet" | "single", templates?: Template[]): Promise<Pdf>;
  fetchCalibration(paper: Options["paper"]): Promise<Uint8Array>;
  backup(): Promise<Download>;
  inspectBackup(raw: unknown): Promise<BackupSummary>;
  restoreBackup(raw: unknown): Promise<BackupSummary>;
  start(from: "scratch" | "samples"): Promise<unknown>;
  /** one batch plus the brands, logos and templates it uses, as a file to send to someone */
  shareBatch(batch: Batch, name: string): Promise<Download>;
  /** what opening a shared batch file would add (nothing is stored) */
  inspectBatchFile(raw: unknown): Promise<BatchFilePreview>;
  /** add a shared batch file as a new saved batch (never replaces anything) */
  importBatchFile(raw: unknown): Promise<BatchFileResult>;
  /** true until the user has picked how to start (browser build only) */
  needsStart(): boolean;
}

export const MODE: "server" | "browser" = import.meta.env.VITE_SIGNO_MODE === "browser" ? "browser" : "server";

// ---------- server implementation (fetch)
async function j<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? res.statusText);
  return body as T;
}
/** keepalive bodies share a 64 KB budget per page; stay under it with room for one small request */
const KEEPALIVE_MAX = 60_000;
const send = (url: string, body?: unknown, method = "POST", keepalive = false) => {
  const text = body === undefined ? undefined : JSON.stringify(body);
  // keepalive lets a request finish after the tab closes. The cap counts bytes, so measure UTF-8,
  // not string length. A bigger body goes out as an ordinary request: fine while the tab is only
  // hidden, but if the tab is closing the browser may cancel it, and the last edit (made in the
  // 300 ms before closing) is then lost without a message.
  const bytes = text === undefined ? 0 : new TextEncoder().encode(text).length;
  return fetch(url, { method, headers: text === undefined ? {} : { "content-type": "application/json" }, body: text, keepalive: keepalive && bytes < KEEPALIVE_MAX });
};
const filename = (res: Response, fallback: string) => /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? fallback;

const server: Backend = {
  getState: () => fetch("/api/state", { cache: "no-store" }).then((r) => j<State>(r)),
  putBatch: (b, closing) => send("/api/batch", b, "PUT", closing).then((r) => j<Batch>(r)),
  saveBrand: (b, closing) => send("/api/brands", b, "POST", closing).then((r) => j<Brand & { created: boolean }>(r)),
  removeBrand: (id) => send(`/api/brands/${id}`, undefined, "DELETE").then((r) => j(r)),
  uploadLogo: (id, file) => fetch(`/api/brands/${id}/logo`, { method: "POST", body: file }).then((r) => j<{ aspect: number }>(r)),
  removeLogoBg: (id) => send(`/api/brands/${id}/logo/remove-bg`).then((r) => j<LogoInfo>(r)),
  restoreLogo: (id) => send(`/api/brands/${id}/logo/restore`).then((r) => j(r)),
  logoUrl: (id, version) => `/api/logos/${id}?v=${encodeURIComponent(version)}`,
  uploadBackground: (file) => fetch("/api/backgrounds", { method: "POST", body: file }).then((r) => j<{ image: string; aspect: number }>(r)),
  backgroundUrl: (image) => `/api/backgrounds/${image}`,
  savePreset: (p) => send("/api/presets", p).then((r) => j<Preset>(r)),
  removePreset: (id) => send(`/api/presets/${id}`, undefined, "DELETE").then((r) => j(r)),
  restorePreset: (p, index) => send("/api/presets/restore", { preset: p, index }).then((r) => j<Preset & { renamed: boolean }>(r)),
  check: (items) => send("/api/check", { items }).then((r) => j<Warning[]>(r)),
  saveBatchAs: (name, batch) => send("/api/batches", { name, batch }).then((r) => j<SavedBatch>(r)),
  loadSaved: (id) => fetch(`/api/batches/${id}`).then((r) => j<SavedBatch>(r)),
  deleteSaved: (id) => send(`/api/batches/${id}`, undefined, "DELETE").then((r) => j(r)),
  restoreSaved: (s) => send("/api/batches/restore", s).then((r) => j<SavedBatch & { renamed: boolean }>(r)),
  saveRules: (r, closing) => send("/api/rules", r, "PUT", closing).then((res) => j<Rules>(res)),
  saveTemplate: (t) => send(`/api/templates/${t.id}`, t, "PUT").then((r) => j<Template>(r)),
  duplicateTemplate: (id, name) => send(`/api/templates/${id}/duplicate`, { name }).then((r) => j<Template>(r)),
  resetTemplate: (id) => send(`/api/templates/${id}/reset`).then((r) => j<Template>(r)),
  deleteTemplate: (id) => send(`/api/templates/${id}`, undefined, "DELETE").then((r) => j(r)),
  async exportTemplates(ids, name) {
    const res = await fetch(`/api/templates/export?ids=${encodeURIComponent(ids.join(","))}${name.trim() ? `&name=${encodeURIComponent(name.trim())}` : ""}`);
    if (!res.ok) throw new Error("Export failed");
    return { blob: await res.blob(), filename: filename(res, "sign-templates.signsnip.json") };
  },
  inspectSet: (set) => send("/api/templates/inspect", set).then((r) => j<SetPreview>(r)),
  importSet: (set, mode, only) => send("/api/templates/import", { set, mode, only }).then((r) => j<ImportResult>(r)),
  async fetchPdf(items, options, mode, templates) {
    const res = await send("/api/pdf", { items, options, mode, templates });
    if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "PDF failed");
    return { bytes: new Uint8Array(await res.arrayBuffer()), pages: Number(res.headers.get("x-pages")), signs: Number(res.headers.get("x-signs")) };
  },
  async fetchCalibration(paper) {
    const res = await fetch(`/api/calibration?paper=${paper}`);
    if (!res.ok) throw new Error("Could not build the printer check page");
    return new Uint8Array(await res.arrayBuffer());
  },
  async backup() {
    const res = await fetch("/api/workspace");
    if (!res.ok) throw new Error("Backup failed");
    return { blob: await res.blob(), filename: filename(res, "signsnip-backup.signsnip-backup.json") };
  },
  inspectBackup: (raw) => send("/api/workspace/inspect", raw).then((r) => j<BackupSummary>(r)),
  restoreBackup: (raw) => send("/api/workspace/restore", raw).then((r) => j<BackupSummary>(r)),
  start: (from) => send("/api/workspace/start", { from }).then((r) => j(r)),
  async shareBatch(batch, name) {
    const res = await send("/api/batch-file/export", { batch, name });
    if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Couldn't make the file");
    return { blob: await res.blob(), filename: filename(res, "batch.signsnip-batch.json") };
  },
  inspectBatchFile: (raw) => send("/api/batch-file/inspect", raw).then((r) => j<BatchFilePreview>(r)),
  importBatchFile: (raw) => send("/api/batch-file/import", raw).then((r) => j<BatchFileResult>(r)),
  needsStart: () => false,
};

let impl: Backend = server;
/** Pick and initialise the backend. Must finish before the app renders. */
export async function init(): Promise<void> {
  if (MODE === "browser") impl = await (await import("./local/backend")).createBrowserBackend();
}
const be = () => impl;

export const getState = () => be().getState();
export const putBatch = (b: Batch, closing?: boolean) => be().putBatch(b, closing);
export const saveBrand: Backend["saveBrand"] = (b, closing) => be().saveBrand(b, closing);
export const removeBrand = (id: string) => be().removeBrand(id);
export const uploadLogo = (id: string, file: File) => be().uploadLogo(id, file);
export const removeLogoBg = (id: string) => be().removeLogoBg(id);
export const restoreLogo = (id: string) => be().restoreLogo(id);
export const logoUrl = (id: string, version: string) => be().logoUrl(id, version);
export const uploadBackground = (file: File) => be().uploadBackground(file);
export const backgroundUrl = (image: string) => be().backgroundUrl(image);
export const savePreset = (p: { name: string; sign: Preset["sign"] }) => be().savePreset(p);
export const removePreset = (id: string) => be().removePreset(id);
export const restorePreset = (p: Preset, index: number) => be().restorePreset(p, index);
export const check = (items: Sign[]) => be().check(items);
export const saveBatchAs = (name: string, batch: Batch) => be().saveBatchAs(name, batch);
export const loadSaved = (id: string) => be().loadSaved(id);
export const deleteSaved = (id: string) => be().deleteSaved(id);
export const restoreSaved = (s: SavedBatch) => be().restoreSaved(s);
export const saveRules = (r: Rules, closing?: boolean) => be().saveRules(r, closing);
export const saveTemplate = (t: Template) => be().saveTemplate(t);
export const duplicateTemplate = (id: string, name?: string) => be().duplicateTemplate(id, name);
export const resetTemplate = (id: string) => be().resetTemplate(id);
export const deleteTemplate = (id: string) => be().deleteTemplate(id);
export const exportTemplates = (ids: string[], name: string) => be().exportTemplates(ids, name);
export const inspectSet = (set: unknown) => be().inspectSet(set);
export const importSet = (set: unknown, mode: "keep-both" | "replace", only: string[]) => be().importSet(set, mode, only);
export const fetchPdf: Backend["fetchPdf"] = (...a) => be().fetchPdf(...a);
export const fetchCalibration = (paper: Options["paper"]) => be().fetchCalibration(paper);
export const backup = () => be().backup();
export const inspectBackup = (raw: unknown) => be().inspectBackup(raw);
export const restoreBackup = (raw: unknown) => be().restoreBackup(raw);
export const start = (from: "scratch" | "samples") => be().start(from);
export const needsStart = () => be().needsStart();
export const shareBatch = (batch: Batch, name: string) => be().shareBatch(batch, name);
export const inspectBatchFile = (raw: unknown) => be().inspectBatchFile(raw);
export const importBatchFile = (raw: unknown) => be().importBatchFile(raw);

/** Save a Download to the user's computer. */
export function saveDownload({ blob, filename }: Download): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
