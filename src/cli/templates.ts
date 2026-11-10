import fs from "node:fs";
import { count } from "../core/words.js";
import path from "node:path";
import { OUT_DIR } from "../core/paths.js";
import {
  deleteTemplate, duplicateTemplate, exportTemplateSet, importTemplateSet, listTemplates, parseTemplateSet,
  readBatch, readRules, resetTemplate, saveBackground, saveTemplate, slugify, templateMatches,
} from "../core/store.js";
import { FIELD_LABELS, isBuiltin, resolveTemplate } from "../core/template.js";
import { TemplateSchema, type Template } from "../core/types.js";
import { die, log, num, pick, type Flags } from "./shared.js";

const TEXT_PROPS: Record<string, "num" | "int" | "bool" | "str" | readonly string[]> = {
  x: "num", y: "num", w: "num", h: "num", size: "num", minSize: "num", maxLines: "int", lineSpacing: "num", uppercase: "bool", strike: "bool", balance: "bool",
  color: "str", text: "str", weight: ["bold", "regular"], align: ["left", "center", "right"], vAlign: ["top", "middle", "bottom"],
};
const LOGO_PROPS = new Set(["x", "y", "w", "h"]);

/** "offer.size=34" -> mutate the template; object = id, else first object with that field ("logo" works too). */
function applyTemplateSet(t: Template, assignment: string): Template {
  const m = /^([\w-]+)\.(\w+)=(.*)$/.exec(assignment);
  if (!m) die(`bad assignment "${assignment}" - use object.prop=value, e.g. offer.size=34`);
  const [, ref, prop, raw] = m as unknown as [string, string, string, string];
  const obj = t.objects.find((o) => o.id === ref) ?? t.objects.find((o) => (o.type === "logo" ? ref === "logo" : o.field === ref));
  if (!obj) die(`no object "${ref}" in ${t.id}. Objects: ${t.objects.map((o) => o.id).join(", ")}`);
  const kind = obj.type === "logo" ? (LOGO_PROPS.has(prop) ? "num" : undefined) : TEXT_PROPS[prop];
  if (!kind) die(`"${prop}" isn't a property of ${obj.type === "logo" ? "a logo" : "text"}. Try: ${obj.type === "logo" ? [...LOGO_PROPS].join(" ") : Object.keys(TEXT_PROPS).join(" ")}`);
  let value: unknown = raw;
  if (kind === "num" || kind === "int") { value = Number(raw.replace(/(mm|pt)$/, "")); if (!Number.isFinite(value as number)) die(`${prop} needs a number`); if (kind === "int") value = Math.round(value as number); }
  else if (kind === "bool") {
    if (!/^(1|true|yes|on|0|false|no|off)$/i.test(raw)) die(`${prop} must be yes or no`);
    value = /^(1|true|yes|on)$/i.test(raw);
  }
  else if (Array.isArray(kind) && !kind.includes(raw)) die(`${prop} must be one of: ${kind.join(", ")}`);
  const next = { ...t, objects: t.objects.map((o) => (o === obj ? { ...o, [prop]: value } : o)) };
  const r = TemplateSchema.safeParse(next);
  if (!r.success) die(r.error.issues.map((i) => `${i.path.slice(2).join(".")}: ${i.message}`).join("; "));
  return r.data;
}

function showTemplate(t: Template) {
  log(`${t.name} (${t.id}) · ${t.kind === "price" ? "price" : "percent off"} · safe margin ${t.safeMargin} mm${isBuiltin(t.id) ? " · built-in" : ""}`);
  const fb = t.fallbackId ? listTemplates().find((x) => x.id === t.fallbackId) : undefined;
  if (t.background) log(`  background   ${t.background.fit === "cover" ? "fills the sign" : "whole picture"} · ${Math.round(t.background.opacity * 100)}% strength · ${t.background.image}`);
  log(`  readable minimum ${t.readableMin ? `${t.readableMin}pt (template)` : `${readRules().readableMin}pt (store)`}${t.fallbackId ? ` · too small → "${fb?.name ?? `${t.fallbackId} (missing)`}"` : ""}`);
  for (const o of t.objects) {
    const box = `x ${o.x} y ${o.y}  ${o.w}×${o.h} mm`;
    if (o.type === "logo") { log(`  ${o.id.padEnd(12)} logo                     ${box}`); continue; }
    const what = o.field === "static" ? `"${o.text}"` : FIELD_LABELS[o.field];
    log(`  ${o.id.padEnd(12)} ${what.padEnd(24)} ${box}  ${o.size}pt (min ${o.minSize}) ${o.weight} ${o.align}/${o.vAlign}${o.maxLines > 1 ? ` ${o.maxLines} lines${o.balance ? " balanced" : ""}${(o.lineSpacing ?? 1) !== 1 ? ` spacing ${Math.round((o.lineSpacing ?? 1) * 100)}%` : ""}` : ""}${o.strike ? " strike" : ""}${o.color !== "#000000" ? ` ${o.color}` : ""}`);
  }
}

/** `signsnip templates ...` */
export async function templatesCommand(p: string[], v: Flags) {
  const [sub, a, ...more] = p;
  if (!sub) {
    const items = readBatch().items;
    for (const t of listTemplates()) {
      const used = items.filter((s) => resolveTemplate(s, listTemplates()).id === t.id).length;
      log(`${t.id.padEnd(18)} ${t.name.padEnd(24)} ${t.kind.padEnd(8)} ${String(t.objects.length).padStart(2)} objects${used ? ` · used by ${count(used, "row")}` : ""}${isBuiltin(t.id) ? " · built-in" : ""}`);
    }
    return;
  }
  const find = (ref: string | undefined) => pick(templateMatches(ref ?? ""), ref, "template", `signsnip templates ${sub} <tpl> ...`, "signsnip templates");
  let t: Template | undefined;
  const need = () => (t ??= find(a));
  if (sub === "show") return showTemplate(need());
  if (sub === "set") {
    if (!more.length) die("usage: signsnip templates set <tpl> offer.size=34 [heading.y=20 ...]");
    let next = need();
    for (const as of more) next = applyTemplateSet(next, as);
    saveTemplate(next);
    log(`updated ${next.id}:`); return showTemplate(next);
  }
  if (sub === "duplicate") { const c = duplicateTemplate(need().id, more[0]); return log(`created ${c.id} ("${c.name}")`); }
  if (sub === "rename") {
    const name = more[0] ?? die('usage: signsnip templates rename <tpl> "New name"');
    saveTemplate({ ...need(), name }); return log(`renamed ${need().id} to "${name}"`);
  }
  if (sub === "background") {
    const cur = need();
    const arg = more[0];
    const fit = v.fit === undefined ? undefined : String(v.fit);
    if (fit !== undefined && fit !== "cover" && fit !== "contain") die('--fit is "cover" (fill the sign, crop the edges) or "contain" (show the whole picture)');
    const st = num(v.strength);
    if (st !== undefined && (!Number.isFinite(st) || st < 5 || st > 100)) die("--strength is a percent from 5 to 100 (30 is a good start)");
    if (arg === "none") { saveTemplate({ ...cur, background: undefined }); return log(`${cur.id}: no background`); }
    let bg = cur.background;
    if (arg) {
      if (!fs.existsSync(arg)) die(`No file "${arg}"`);
      const { image, aspect } = await saveBackground(fs.readFileSync(arg));
      bg = { image, aspect, fit: bg?.fit ?? "cover", opacity: bg?.opacity ?? 0.3 };
    }
    if (!bg) die("usage: signsnip templates background <tpl> <image> [--fit cover|contain] [--strength 30]   (or: none)");
    bg = { ...bg, ...(fit ? { fit: fit as "cover" | "contain" } : {}), ...(st !== undefined ? { opacity: st / 100 } : {}) };
    saveTemplate({ ...cur, background: bg });
    return log(`${cur.id}: background ${bg.fit === "cover" ? "fills the sign" : "shows the whole picture"} at ${Math.round(bg.opacity * 100)}% strength${bg.opacity > 0.5 ? " (strong: check the text stays readable; 20-35% is safer)" : ""}`);
  }
  if (sub === "fallback") {
    const to = more[0] ?? die("usage: signsnip templates fallback <tpl> <other-tpl|none>");
    const cur = need();
    if (to === "none") { saveTemplate({ ...cur, fallbackId: undefined }); return log(`${cur.id}: no fallback`); }
    const fb = find(to);
    if (fb.id === cur.id) die("a template can't fall back to itself");
    if (fb.kind !== cur.kind) die(`"${fb.name}" prints a ${fb.kind}; ${cur.id} prints a ${cur.kind} - pick one of the same kind`);
    saveTemplate({ ...cur, fallbackId: fb.id });
    return log(`${cur.id}: when text gets too small, use "${fb.name}"`);
  }
  if (sub === "min") {
    const v2 = more[0] ?? die("usage: signsnip templates min <tpl> <pt|none>");
    const cur = need();
    if (v2 === "none") { saveTemplate({ ...cur, readableMin: undefined }); return log(`${cur.id}: uses the store readable minimum (${readRules().readableMin}pt)`); }
    const n = Number(v2.replace(/pt$/, ""));
    if (!(n >= 4 && n <= 40)) die("readable minimum must be 4-40 pt");
    saveTemplate({ ...cur, readableMin: n }); return log(`${cur.id}: readable minimum ${n}pt`);
  }
  if (sub === "reset") { const r = resetTemplate(need().id); return log(`${r.id} is back to its original layout`); }
  if (sub === "rm") { deleteTemplate(need().id); return log(`deleted template ${need().id}; rows that used it fall back to the built-in layout`); }
  if (sub === "export") {
    const ids = [a, ...more].filter((x): x is string => !!x).map((r) => find(r).id);
    const set = exportTemplateSet(ids, v.name as string | undefined);
    const out = path.resolve(String(v.o ?? path.join(OUT_DIR, `${slugify(String(v.name ?? ""), "sign-templates")}.signsnip.json`)));
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(set, null, 2) + "\n");
    return log(`wrote ${out} (${count(set.templates.length, "template")}: ${set.templates.map((x) => x.id).join(", ")})`);
  }
  if (sub === "import") {
    if (!a) die("usage: signsnip templates import <file.signsnip.json> [--replace]");
    let raw: unknown;
    try { raw = JSON.parse(fs.readFileSync(a, "utf8")); } catch { die(`can't read ${a} as JSON`); }
    const r = importTemplateSet(parseTemplateSet(raw), v.replace ? "replace" : "keep-both");
    const parts = [
      r.added.length && `added ${r.added.join(", ")}`,
      r.replaced.length && `replaced ${r.replaced.join(", ")}`,
      r.renamed.length && `kept both for ${r.renamed.map((x) => `${x.from} → ${x.to}`).join(", ")}`,
      r.unchanged.length && `already had ${r.unchanged.join(", ")}`,
    ].filter(Boolean);
    return log(parts.join("; ") || "nothing to import");
  }
  return die(`unknown templates subcommand "${sub}"`);
}
