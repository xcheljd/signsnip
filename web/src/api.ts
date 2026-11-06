import type { Batch, Brand, Options, Preset, SavedBatch, Sign, Warning } from "../../src/core/types";

export interface LogoInfo { width: number; height: number; aspect: number; background: "transparent" | "white" | "solid"; hasOriginal: boolean }
export type BrandWithLogo = Brand & { logo: LogoInfo | null };
export interface SavedSummary { id: string; name: string; savedAt: string; signs: number }
export interface State { brands: BrandWithLogo[]; presets: Preset[]; batch: Batch; saved: SavedSummary[] }

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

export interface Pdf { bytes: Uint8Array; pages: number; signs: number }
export async function fetchPdf(items: Sign[], options: Options, mode: "sheet" | "single"): Promise<Pdf> {
  const res = await send("/api/pdf", { items, options, mode });
  if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "PDF failed");
  return { bytes: new Uint8Array(await res.arrayBuffer()), pages: Number(res.headers.get("x-pages")), signs: Number(res.headers.get("x-signs")) };
}
export async function fetchCalibration(paper: Options["paper"]): Promise<Uint8Array> {
  const res = await fetch(`/api/calibration?paper=${paper}`);
  if (!res.ok) throw new Error("Could not build the printer check page");
  return new Uint8Array(await res.arrayBuffer());
}
