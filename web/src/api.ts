import type { Batch, Brand, Options, Preset, Rules, SavedBatch, Sign, Template, Warning } from "../../src/core/types";
import type { ImportResult, LogoInfo, SetPreview } from "../../src/core/store";

export type { ImportResult, LogoInfo, SetPreview };
export type BrandWithLogo = Brand & { logo: LogoInfo | null };
export interface SavedSummary { id: string; name: string; savedAt: string; signs: number }
export interface State { brands: BrandWithLogo[]; presets: Preset[]; batch: Batch; saved: SavedSummary[]; templates: Template[]; rules: Rules }
export interface Pdf { bytes: Uint8Array; pages: number; signs: number }
export interface Download { blob: Blob; filename: string }
export interface BackupSummary { exportedAt: string; brands: number; logos: number; presets: number; templates: number; saved: number; signs: number; abbreviations: number; backgrounds?: number }

/**
 * Everything the UI can ask for. Two implementations:
 *  - "server" (default): the local hono server, data/ on disk, shared with the CLI
 *  - "browser": no server; data in this browser's IndexedDB (the hosted, static build)
 */
export interface Backend {
  getState(): Promise<State>;
  putBatch(b: Batch): Promise<Batch>;
  saveBrand(b: { id?: string; name: string; collections?: string[]; logoScale?: number }): Promise<Brand>;
  removeBrand(id: string): Promise<unknown>;
  uploadLogo(id: string, file: File): Promise<{ aspect: number }>;
  removeLogoBg(id: string): Promise<LogoInfo>;
  restoreLogo(id: string): Promise<unknown>;
  /** an <img src> for the brand's logo; `version` busts caches when the logo changes */
  logoUrl(id: string, version: string): string;
  /** store a picture for a template background */
  uploadBackground(file: File): Promise<{ image: string; aspect: number }>;
  backgroundUrl(image: string): string;
  savePreset(p: Preset): Promise<Preset>;
  removePreset(id: string): Promise<unknown>;
  check(items: Sign[]): Promise<Warning[]>;
  saveBatchAs(name: string, batch: Batch): Promise<SavedBatch>;
  loadSaved(id: string): Promise<SavedBatch>;
  deleteSaved(id: string): Promise<unknown>;
  saveRules(r: Rules): Promise<Rules>;
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
const send = (url: string, body?: unknown, method = "POST") =>
  fetch(url, { method, headers: body === undefined ? {} : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const filename = (res: Response, fallback: string) => /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? fallback;

const server: Backend = {
  getState: () => fetch("/api/state", { cache: "no-store" }).then((r) => j<State>(r)),
  putBatch: (b) => send("/api/batch", b, "PUT").then((r) => j<Batch>(r)),
  saveBrand: (b) => send("/api/brands", b).then((r) => j<Brand>(r)),
  removeBrand: (id) => send(`/api/brands/${id}`, undefined, "DELETE").then((r) => j(r)),
  uploadLogo: (id, file) => fetch(`/api/brands/${id}/logo`, { method: "POST", body: file }).then((r) => j<{ aspect: number }>(r)),
  removeLogoBg: (id) => send(`/api/brands/${id}/logo/remove-bg`).then((r) => j<LogoInfo>(r)),
  restoreLogo: (id) => send(`/api/brands/${id}/logo/restore`).then((r) => j(r)),
  logoUrl: (id, version) => `/api/logos/${id}?v=${encodeURIComponent(version)}`,
  uploadBackground: (file) => fetch("/api/backgrounds", { method: "POST", body: file }).then((r) => j<{ image: string; aspect: number }>(r)),
  backgroundUrl: (image) => `/api/backgrounds/${image}`,
  savePreset: (p) => send("/api/presets", p).then((r) => j<Preset>(r)),
  removePreset: (id) => send(`/api/presets/${id}`, undefined, "DELETE").then((r) => j(r)),
  check: (items) => send("/api/check", { items }).then((r) => j<Warning[]>(r)),
  saveBatchAs: (name, batch) => send("/api/batches", { name, batch }).then((r) => j<SavedBatch>(r)),
  loadSaved: (id) => fetch(`/api/batches/${id}`).then((r) => j<SavedBatch>(r)),
  deleteSaved: (id) => send(`/api/batches/${id}`, undefined, "DELETE").then((r) => j(r)),
  saveRules: (r) => send("/api/rules", r, "PUT").then((res) => j<Rules>(res)),
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
  needsStart: () => false,
};

let impl: Backend = server;
/** Pick and initialise the backend. Must finish before the app renders. */
export async function init(): Promise<void> {
  if (MODE === "browser") impl = await (await import("./local/backend")).createBrowserBackend();
}
const be = () => impl;

export const getState = () => be().getState();
export const putBatch = (b: Batch) => be().putBatch(b);
export const saveBrand: Backend["saveBrand"] = (b) => be().saveBrand(b);
export const removeBrand = (id: string) => be().removeBrand(id);
export const uploadLogo = (id: string, file: File) => be().uploadLogo(id, file);
export const removeLogoBg = (id: string) => be().removeLogoBg(id);
export const restoreLogo = (id: string) => be().restoreLogo(id);
export const logoUrl = (id: string, version: string) => be().logoUrl(id, version);
export const uploadBackground = (file: File) => be().uploadBackground(file);
export const backgroundUrl = (image: string) => be().backgroundUrl(image);
export const savePreset = (p: Preset) => be().savePreset(p);
export const removePreset = (id: string) => be().removePreset(id);
export const check = (items: Sign[]) => be().check(items);
export const saveBatchAs = (name: string, batch: Batch) => be().saveBatchAs(name, batch);
export const loadSaved = (id: string) => be().loadSaved(id);
export const deleteSaved = (id: string) => be().deleteSaved(id);
export const saveRules = (r: Rules) => be().saveRules(r);
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

/** Save a Download to the user's computer. */
export function saveDownload({ blob, filename }: Download): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
