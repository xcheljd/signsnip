import type { Batch, Brand, Preset, Sign } from "../../src/core/types";

async function j<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? res.statusText);
  return body as T;
}
const post = (url: string, body: unknown, method = "POST") =>
  fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export interface State { brands: Brand[]; presets: Preset[]; batch: Batch }
export const getState = () => fetch("/api/state", { cache: "no-store" }).then((r) => j<State>(r));
export const putBatch = (b: Batch) => post("/api/batch", b, "PUT").then((r) => j<Batch>(r));
export const saveBrand = (b: { id?: string; name: string; collections?: string[] }) => post("/api/brands", b).then((r) => j<Brand>(r));
export const removeBrand = (id: string) => fetch(`/api/brands/${id}`, { method: "DELETE" }).then((r) => j(r));
export const uploadLogo = (id: string, file: File) => fetch(`/api/brands/${id}/logo`, { method: "POST", body: file }).then((r) => j<{ aspect: number }>(r));
export const savePreset = (p: Preset) => post("/api/presets", p).then((r) => j<Preset>(r));
export const removePreset = (id: string) => fetch(`/api/presets/${id}`, { method: "DELETE" }).then((r) => j(r));

export async function fetchPdf(items: Sign[], options: Batch["options"], mode: "sheet" | "single", download = false) {
  const res = await post("/api/pdf", { items, options, mode, download });
  if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "PDF failed");
  return { bytes: new Uint8Array(await res.arrayBuffer()), pages: Number(res.headers.get("x-pages")), signs: Number(res.headers.get("x-signs")) };
}
