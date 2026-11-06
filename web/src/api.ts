import type { Batch, Brand, Options, Preset, Rules, SavedBatch, Sign, Template, Warning } from "../../src/core/types";

export interface LogoInfo { width: number; height: number; aspect: number; background: "transparent" | "white" | "solid"; hasOriginal: boolean }
export type BrandWithLogo = Brand & { logo: LogoInfo | null };
export interface SavedSummary { id: string; name: string; savedAt: string; signs: number }
export interface State { brands: BrandWithLogo[]; presets: Preset[]; batch: Batch; saved: SavedSummary[]; templates: Template[]; rules: Rules }

async function j<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? res.statusText);
  return body as T;
}
const send = (url: string, body?: unknown, method = "POST") =>
  fetch(url, { method, headers: body === undefined ? {} : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

export const getState = () => fetch("/api/state", { cache: "no-store" }).then((r) => j<State>(r));
export const putBatch = (b: Batch) => send("/api/batch", b, "PUT").then((r) => j<Batch>(r));
export const saveBrand = (b: { id?: string; name: string; collections?: string[]; logoScale?: number }) => send("/api/brands", b).then((r) => j<Brand>(r));
export const removeBrand = (id: string) => send(`/api/brands/${id}`, undefined, "DELETE").then((r) => j(r));
export const uploadLogo = (id: string, file: File) => fetch(`/api/brands/${id}/logo`, { method: "POST", body: file }).then((r) => j<{ aspect: number }>(r));
export const removeLogoBg = (id: string) => send(`/api/brands/${id}/logo/remove-bg`).then((r) => j<LogoInfo>(r));
export const restoreLogo = (id: string) => send(`/api/brands/${id}/logo/restore`).then((r) => j(r));
export const savePreset = (p: Preset) => send("/api/presets", p).then((r) => j<Preset>(r));
export const removePreset = (id: string) => send(`/api/presets/${id}`, undefined, "DELETE").then((r) => j(r));
export const check = (items: Sign[]) => send("/api/check", { items }).then((r) => j<Warning[]>(r));
export const saveBatchAs = (name: string, batch: Batch) => send("/api/batches", { name, batch }).then((r) => j<SavedBatch>(r));
export const loadSaved = (id: string) => fetch(`/api/batches/${id}`).then((r) => j<SavedBatch>(r));
export const deleteSaved = (id: string) => send(`/api/batches/${id}`, undefined, "DELETE").then((r) => j(r));

export const saveRules = (r: Rules) => send("/api/rules", r, "PUT").then((res) => j<Rules>(res));
export const saveTemplate = (t: Template) => send(`/api/templates/${t.id}`, t, "PUT").then((r) => j<Template>(r));
export const duplicateTemplate = (id: string, name?: string) => send(`/api/templates/${id}/duplicate`, { name }).then((r) => j<Template>(r));
export const resetTemplate = (id: string) => send(`/api/templates/${id}/reset`).then((r) => j<Template>(r));
export const deleteTemplate = (id: string) => send(`/api/templates/${id}`, undefined, "DELETE").then((r) => j(r));
export const templateExportUrl = (ids: string[], name: string) =>
  `/api/templates/export?ids=${encodeURIComponent(ids.join(","))}${name.trim() ? `&name=${encodeURIComponent(name.trim())}` : ""}`;
export interface SetPreview {
  name?: string; exportedAt: string;
  templates: { id: string; name: string; kind: "percent" | "price"; objects: number; status: "new" | "same" | "conflict"; mine?: string }[];
}
export const inspectSet = (set: unknown) => send("/api/templates/inspect", set).then((r) => j<SetPreview>(r));
export interface ImportResult { added: string[]; replaced: string[]; renamed: { from: string; to: string }[]; unchanged: string[] }
export const importSet = (set: unknown, mode: "keep-both" | "replace", only: string[]) =>
  send("/api/templates/import", { set, mode, only }).then((r) => j<ImportResult>(r));

export interface Pdf { bytes: Uint8Array; pages: number; signs: number }
export async function fetchPdf(items: Sign[], options: Options, mode: "sheet" | "single", templates?: Template[]): Promise<Pdf> {
  const res = await send("/api/pdf", { items, options, mode, templates });
  if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "PDF failed");
  return { bytes: new Uint8Array(await res.arrayBuffer()), pages: Number(res.headers.get("x-pages")), signs: Number(res.headers.get("x-signs")) };
}
export async function fetchCalibration(paper: Options["paper"]): Promise<Uint8Array> {
  const res = await fetch(`/api/calibration?paper=${paper}`);
  if (!res.ok) throw new Error("Could not build the printer check page");
  return new Uint8Array(await res.arrayBuffer());
}
