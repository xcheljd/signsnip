import { money } from "../core/batch.js";
import { money as fmtMoney } from "../core/layout.js";
import { getBrand, listTemplates } from "../core/store.js";
import { resolveTemplate } from "../core/template.js";
import type { Sign } from "../core/types.js";

export const log = (...a: unknown[]) => console.log(...a);
export function die(m: string): never { console.error(`error: ${m}`); process.exit(1); }

export type Flags = Record<string, string | boolean | undefined>;

export const num = (x: unknown) => (x === undefined ? undefined : Number(String(x).replace("%", "")));
export const cash = (x: unknown) => (x === undefined ? undefined : money(String(x)));
export const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

/**
 * The one thing the user meant, or a clear error. `matches` comes from the store's
 * brandMatches / templateMatches / savedBatchMatches; nothing typed prints `usage`.
 */
export function pick<T extends { name: string }>(matches: T[], ref: string | undefined, what: string, usage: string, hint: string): T {
  if (!ref?.trim()) die(`usage: ${usage}`);
  if (matches.length > 1) die(`"${ref}" matches several ${what}${what.endsWith("ch") ? "es" : "s"} (${matches.map((m) => m.name).join(", ")}). Be more specific.`);
  return matches[0] ?? die(`No ${what} matching "${ref}". Try: ${hint}`);
}

export function describe(s: Sign, n: number) {
  const b = getBrand(s.brandId)?.name ?? `${s.brandId} (deleted brand)`;
  const offer = s.kind === "price" && s.price
    ? [s.priceLabel.toUpperCase(), fmtMoney(s.price), s.wasPrice ? `(was ${fmtMoney(s.wasPrice)})` : ""].filter(Boolean).join(" ")
    : `${s.percent}% ${s.offLabel}`;
  const tpl = s.templateId && s.templateId !== s.kind ? ` [${resolveTemplate(s, listTemplates()).name}]` : "";
  return `${String(n).padStart(2)}. ${b} | ${[s.prefix, s.collection].filter(Boolean).join(" ")} | ${offer} | ${s.footer || "-"} | x${s.copies}${tpl}`;
}
