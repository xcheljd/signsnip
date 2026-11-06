import { randomUUID } from "node:crypto";
import { findBrand, listPresets, readBatch, writeBatch } from "./store.js";
import { SignSchema, type Sign } from "./types.js";

export interface AddInput {
  brand?: string; preset?: string; prefix?: string; collection?: string;
  percent?: number; offLabel?: string; footer?: string; copies?: number;
}

/** Build a validated Sign from loose input (CLI flags, CSV rows). Throws friendly errors. */
export function buildSign(input: AddInput): Sign {
  let base: Partial<Sign> = {};
  if (input.preset) {
    const p = listPresets().find((x) => x.id === input.preset || x.name.toLowerCase() === input.preset!.toLowerCase());
    if (!p) throw new Error(`No preset "${input.preset}". Try: signo presets`);
    base = { ...p.sign };
  }
  const brandRef = input.brand ?? base.brandId;
  if (!brandRef) throw new Error("Need a brand (--brand <id|name>) or a --preset");
  const brand = findBrand(brandRef);
  if (!brand) throw new Error(`No brand matching "${brandRef}". Try: signo brands`);
  const parsed = SignSchema.safeParse({
    id: randomUUID(),
    brandId: brand.id,
    prefix: input.prefix ?? base.prefix ?? "SELECT",
    collection: input.collection ?? base.collection ?? "MODELS",
    percent: input.percent ?? base.percent,
    offLabel: input.offLabel ?? base.offLabel ?? "OFF*",
    footer: input.footer ?? base.footer ?? "*MSRP",
    copies: input.copies ?? 1,
  });
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }
  return parsed.data;
}

export function addToBatch(signs: Sign[]) {
  const b = readBatch();
  return writeBatch({ ...b, items: [...b.items, ...signs] });
}

/** Minimal CSV (quotes supported): brand,collection,percent[,copies,prefix,footer] with a header row. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  const [head, ...rest] = rows;
  if (!head) return [];
  const keys = head.map((h) => h.trim().toLowerCase());
  return rest.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? "").trim()])));
}

export function csvToSigns(text: string): Sign[] {
  return parseCsv(text).map((r, i) => {
    try {
      return buildSign({
        brand: r.brand, preset: r.preset || undefined, collection: r.collection || undefined,
        prefix: r.prefix === undefined || r.prefix === "" ? undefined : r.prefix,
        percent: r.percent ? Number(r.percent.replace("%", "")) : undefined,
        footer: r.footer || undefined, copies: r.copies ? Number(r.copies) : undefined,
      });
    } catch (e) {
      throw new Error(`CSV row ${i + 2}: ${(e as Error).message}`);
    }
  });
}
