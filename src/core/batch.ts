import { brandMatches, listPresets, readBatch, templateMatches, writeBatch } from "./store.js";
import { SignSchema, type Sign } from "./types.js";

export interface AddInput {
  brand?: string; preset?: string; prefix?: string; collection?: string;
  percent?: number; offLabel?: string; footer?: string; copies?: number;
  /** giving a price makes it a price-point sign */
  price?: number; wasPrice?: number; priceLabel?: string;
  /** template id or name; its kind (percent/price) wins */
  template?: string;
}

/** Build a validated Sign from loose input (CLI flags, CSV rows). Throws friendly errors. */
export function buildSign(input: AddInput): Sign {
  let base: Partial<Sign> = {};
  if (input.preset) {
    const p = listPresets().find((x) => x.id === input.preset || x.name.toLowerCase() === input.preset!.toLowerCase());
    if (!p) throw new Error(`No preset "${input.preset}". Try: signsnip presets`);
    base = { ...p.sign };
  }
  const brandRef = input.brand ?? base.brandId;
  if (!brandRef) throw new Error("Need a brand (--brand <id|name>) or a --preset");
  const matches = brandMatches(brandRef);
  if (matches.length > 1) throw new Error(`"${brandRef}" matches several brands (${matches.map((b) => b.name).join(", ")}). Be more specific.`);
  const brand = matches[0];
  if (!brand) throw new Error(`No brand matching "${brandRef}". Try: signsnip brands`);
  const tpls = input.template ? templateMatches(input.template) : [];
  if (tpls.length > 1) throw new Error(`"${input.template}" matches several templates (${tpls.map((t) => t.name).join(", ")}). Be more specific.`);
  const tpl = tpls[0];
  if (input.template && !tpl) throw new Error(`No template matching "${input.template}". Try: signsnip templates`);
  const kind = tpl?.kind ?? (input.price !== undefined ? "price" : input.percent !== undefined ? "percent" : (base.kind ?? "percent"));
  if (kind === "price" && input.price === undefined && base.price === undefined) throw new Error("Need --price for a price template");
  if (kind === "percent" && input.percent === undefined && base.percent === undefined) throw new Error("Need --percent (or --price for a price sign)");
  const parsed = SignSchema.safeParse({
    id: globalThis.crypto.randomUUID(), // Web Crypto: same call on Node 19+ and in browsers
    brandId: brand.id,
    kind,
    templateId: tpl?.id ?? base.templateId,
    prefix: input.prefix ?? base.prefix ?? "SELECT",
    collection: input.collection ?? base.collection ?? "MODELS",
    percent: input.percent ?? base.percent ?? 50,
    offLabel: input.offLabel ?? base.offLabel ?? "OFF*",
    price: input.price ?? base.price,
    wasPrice: input.wasPrice ?? base.wasPrice,
    priceLabel: input.priceLabel ?? base.priceLabel ?? "",
    // price signs don't reference MSRP by default
    footer: input.footer ?? base.footer ?? (kind === "price" ? "" : "*MSRP"),
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

/** Minimal CSV (quotes supported) with a header row: brand,collection,percent|price[,was,price_label,template,copies,prefix,footer]. */
function parseCsv(text: string): Record<string, string>[] {
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
  if (q) throw new Error(`CSV row ${rows.length + 1}: a quote (") is opened but never closed`);
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  const [head, ...rest] = rows;
  if (!head) return [];
  const keys = head.map((h) => h.trim().toLowerCase());
  return rest.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? "").trim()])));
}

/** "$1,295.00" -> 1295 */
export const money = (s: string) => Number(String(s).replace(/[$,\s]/g, ""));

export function csvToSigns(text: string): Sign[] {
  return parseCsv(text).map((r, i) => {
    try {
      return buildSign({
        brand: r.brand, preset: r.preset || undefined, collection: r.collection || undefined,
        prefix: r.prefix === undefined || r.prefix === "" ? undefined : r.prefix,
        percent: r.percent ? Number(r.percent.replace("%", "")) : undefined,
        price: r.price ? money(r.price) : undefined,
        wasPrice: r.was ? money(r.was) : undefined,
        priceLabel: r.price_label || undefined,
        template: r.template || undefined,
        footer: r.footer || undefined, copies: r.copies ? Number(r.copies) : undefined,
      });
    } catch (e) {
      const msg = (e as Error).message
        .replace("Need --percent (or --price for a price sign)", "needs a percent or price value")
        .replace("Need a brand (--brand <id|name>) or a --preset", "needs a brand (add a \"brand\" column)")
        .replace("Need --price for a price template", "needs a price for that template")
        .replace(". Try: signsnip brands", "");
      throw new Error(`CSV row ${i + 2}: ${msg}`);
    }
  });
}
