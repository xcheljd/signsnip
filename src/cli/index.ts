import "../core/node.js";
// `signsnip batch | head` closes the pipe early: exit quietly instead of crashing
process.stdout.on("error", (e: NodeJS.ErrnoException) => { if (e.code === "EPIPE") process.exit(0); throw e; });
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { addToBatch, buildSign, csvToSigns, money } from "../core/batch.js";
import { pageFill, sheetGeometry } from "../core/geometry.js";
import { maxLogoScale, money as fmtMoney } from "../core/layout.js";
import { OUT_DIR } from "../core/paths.js";
import { checkSigns, expandCopies, renderCalibration, renderPdf } from "../core/pdf.js";
import {
  deleteBrand, deleteSavedBatch, findBrand, findSavedBatch, listBrands, listPresets, listSavedBatches, logoInfo,
  readRules, writeRules,
  readBatch, removeLogoBackground, restoreLogo, saveLogo, saveNamedBatch, savePresets, upsertBrand, writeBatch,
  deleteTemplate, duplicateTemplate, exportTemplateSet, findTemplate, importTemplateSet, listTemplates, parseTemplateSet,
  resetTemplate, saveTemplate,
} from "../core/store.js";
import { FIELD_LABELS, isBuiltin, resolveTemplate } from "../core/template.js";
import { seedSamples } from "../core/node.js";
import { exportWorkspace, parseWorkspace, restoreWorkspace, startFromScratch, startWithSamples, summarizeWorkspace } from "../core/workspace.js";
import { GridSchema, PaperSchema, TemplateSchema, type Sign, type Template } from "../core/types.js";

const HELP = `signsnip - SignSnip CLI (47x70mm shelf signs -> print-ready PDF)

Brands
  signsnip brands                              list brands, collections, logo status
  signsnip brands add "Name" [--logo file] [--collections "A,B,C"]
  signsnip brands logo <brand> <file>          set/replace a logo (png/jpg/webp/svg)
  signsnip brands collections <brand> "A,B,C"  replace the collection list
  signsnip brands scale <brand> <0.5-1.6>      grow/shrink that brand's logo on every sign
  signsnip brands fix-bg <brand>               make a logo's solid background transparent
  signsnip brands restore <brand>              undo fix-bg
  signsnip brands rm <brand>

Batch (shared live with the web UI)
  signsnip add --brand <id|name> --collection "Harbor Line" --percent 50 [--prefix SELECT] [--footer "*MSRP"] [--copies 2]
  signsnip add --brand <b> --collection Comet --price 199 [--was 395] [--price-label NOW]   price-point sign
  signsnip add --preset <id|name> [--copies 4]
  signsnip add --template bogo --brand <b> --collection Comet --percent 50   any template
  signsnip import <file.csv>                   columns: brand,collection,percent|price[,was,price_label,copies,prefix,footer]
  signsnip batch                               show the current batch + page fill
  signsnip bulk [--rows 1,3-5|all] --percent 50 | --price 199 | --brand <b> | --template <t> | --footer "x" | --copies 2
  signsnip fill                                top up the last page with copies of the last row
  signsnip rm <row#>                           remove one row (1-based)
  signsnip clear                               empty the batch

Templates (layouts: what goes where, font sizes)
  signsnip templates                           list templates (+ how many batch rows use each)
  signsnip templates show <tpl>                every object with position/size (mm) and font size (pt)
  signsnip templates set <tpl> offer.size=34 heading.y=20 footer.weight=regular ...
                                            object = id or field name; props: x y w h size minSize weight
                                            align vAlign maxLines lineSpacing balance uppercase strike color text
  signsnip templates duplicate <tpl> "New name"
  signsnip templates rename <tpl> "New name"
  signsnip templates reset <percent|price|bogo|final-sale>   back to the original layout
  signsnip templates rm <tpl>
  signsnip templates export [tpl ...] [-o file.signsnip.json] [--name "Holiday set"]
  signsnip templates import <file> [--replace]  default keeps both when a template differs

Readable text (auto-fit)
  signsnip rules                               readable minimum + abbreviation list
  signsnip rules min 10                        text that would shrink below 10pt gets auto-fixed or flagged
  signsnip rules abbr "Chronograph" "Chrono"   add/replace an abbreviation (used only when needed)
  signsnip rules abbr-rm "Chronograph"
  signsnip templates fallback percent percent-long   use this template when text gets too small (none = off)
  signsnip templates min percent 9 | none      per-template readable minimum (none = use the store setting)
  signsnip export --strict                     refuse to export if any sign is still below the minimum

Backups (everything: brands, logos, templates, text rules, presets, batches)
  signsnip backup [-o file.signsnip-backup.json]  one file you can restore here or in the hosted app
  signsnip restore <file> --yes                REPLACES everything with the backup
  signsnip start scratch|samples --yes         wipe and start empty, or with the made-up sample brands

Saved batches
  signsnip batches                             list saved batches
  signsnip save "Holiday sale"                 save the current batch under a name
  signsnip load "Holiday sale"                 replace the current batch with a saved one
  signsnip batches rm "Holiday sale"

Output
  signsnip export [-o out/signs.pdf] [--grid landscape-5x2|portrait-4x3] [--paper letter|a4] [--no-cut-marks]
  signsnip make  <same flags as add> [-o file]  one-shot: a sheet from a single spec
  signsnip check                               pre-print warnings (low-res logos, tiny text, ...)
  signsnip calibrate [-o file] [--paper a4]     printer check page (47x70 box + rulers)
  signsnip presets
  signsnip serve                               start the web UI (http://127.0.0.1:7047)
`;

const log = (...a: unknown[]) => console.log(...a);
function die(m: string): never { console.error(`error: ${m}`); process.exit(1); }

const opts = {
  brand: { type: "string" }, preset: { type: "string" }, collection: { type: "string" }, prefix: { type: "string" },
  percent: { type: "string" }, footer: { type: "string" }, copies: { type: "string" }, off: { type: "string" },
  price: { type: "string" }, was: { type: "string" }, "price-label": { type: "string" }, rows: { type: "string" },
  template: { type: "string" }, name: { type: "string" }, replace: { type: "boolean" }, strict: { type: "boolean" },
  logo: { type: "string" }, collections: { type: "string" }, o: { type: "string", short: "o" }, grid: { type: "string" },
  paper: { type: "string" }, "no-cut-marks": { type: "boolean" }, help: { type: "boolean", short: "h" }, yes: { type: "boolean" },
} as const;
type Flags = Record<string, string | boolean | undefined>;

const num = (x: unknown) => (x === undefined ? undefined : Number(String(x).replace("%", "")));
const cash = (x: unknown) => (x === undefined ? undefined : money(String(x)));

function signFromFlags(v: Flags): Sign {
  return buildSign({
    brand: v.brand as string | undefined, preset: v.preset as string | undefined, collection: v.collection as string | undefined,
    prefix: v.prefix as string | undefined, percent: num(v.percent), offLabel: v.off as string | undefined,
    footer: v.footer as string | undefined, copies: num(v.copies),
    price: cash(v.price), wasPrice: cash(v.was), priceLabel: v["price-label"] as string | undefined,
    template: v.template as string | undefined,
  });
}

export function describe(s: Sign, n: number) {
  const b = findBrand(s.brandId)?.name ?? s.brandId;
  const offer = s.kind === "price" && s.price
    ? [s.priceLabel.toUpperCase(), fmtMoney(s.price), s.wasPrice ? `(was ${fmtMoney(s.wasPrice)})` : ""].filter(Boolean).join(" ")
    : `${s.percent}% ${s.offLabel}`;
  const tpl = s.templateId && s.templateId !== s.kind ? ` [${resolveTemplate(s, listTemplates()).name}]` : "";
  return `${String(n).padStart(2)}. ${b} | ${[s.prefix, s.collection].filter(Boolean).join(" ")} | ${offer} | ${s.footer || "-"} | x${s.copies}${tpl}`;
}

const TEXT_PROPS: Record<string, "num" | "int" | "bool" | "str" | readonly string[]> = {
  x: "num", y: "num", w: "num", h: "num", size: "num", minSize: "num", maxLines: "int", lineSpacing: "num", uppercase: "bool", strike: "bool", balance: "bool",
  color: "str", text: "str", weight: ["bold", "regular"], align: ["left", "center", "right"], vAlign: ["top", "middle", "bottom"],
};
const LOGO_PROPS = new Set(["x", "y", "w", "h"]);

/** "offer.size=34" -> mutate the template; object = id, else first object with that field ("logo" works too). */
export function applyTemplateSet(t: Template, assignment: string): Template {
  const m = /^([\w-]+)\.(\w+)=(.*)$/.exec(assignment);
  if (!m) die(`bad assignment "${assignment}" - use object.prop=value, e.g. offer.size=34`);
  const [, ref, prop, raw] = m as unknown as [string, string, string, string];
  const obj = t.objects.find((o) => o.id === ref) ?? t.objects.find((o) => (o.type === "logo" ? ref === "logo" : o.field === ref));
  if (!obj) die(`no object "${ref}" in ${t.id}. Objects: ${t.objects.map((o) => o.id).join(", ")}`);
  const kind = obj.type === "logo" ? (LOGO_PROPS.has(prop) ? "num" : undefined) : TEXT_PROPS[prop];
  if (!kind) die(`"${prop}" isn't a property of ${obj.type === "logo" ? "a logo" : "text"}. Try: ${obj.type === "logo" ? [...LOGO_PROPS].join(" ") : Object.keys(TEXT_PROPS).join(" ")}`);
  let value: unknown = raw;
  if (kind === "num" || kind === "int") { value = Number(raw.replace(/mm|pt$/, "")); if (!Number.isFinite(value as number)) die(`${prop} needs a number`); if (kind === "int") value = Math.round(value as number); }
  else if (kind === "bool") value = /^(1|true|yes|on)$/i.test(raw);
  else if (Array.isArray(kind) && !kind.includes(raw)) die(`${prop} must be one of: ${kind.join(", ")}`);
  const next = { ...t, objects: t.objects.map((o) => (o === obj ? { ...o, [prop]: value } : o)) };
  const r = TemplateSchema.safeParse(next);
  if (!r.success) die(r.error.issues.map((i) => `${i.path.slice(2).join(".")}: ${i.message}`).join("; "));
  return r.data;
}

function showTemplate(t: Template) {
  log(`${t.name} (${t.id}) · ${t.kind === "price" ? "price" : "percent off"} · safe margin ${t.safeMargin} mm${isBuiltin(t.id) ? " · built-in" : ""}`);
  const fb = t.fallbackId ? listTemplates().find((x) => x.id === t.fallbackId) : undefined;
  log(`  readable minimum ${t.readableMin ? `${t.readableMin}pt (template)` : `${readRules().readableMin}pt (store)`}${t.fallbackId ? ` · too small → "${fb?.name ?? `${t.fallbackId} (missing)`}"` : ""}`);
  for (const o of t.objects) {
    const box = `x ${o.x} y ${o.y}  ${o.w}×${o.h} mm`;
    if (o.type === "logo") { log(`  ${o.id.padEnd(12)} logo                     ${box}`); continue; }
    const what = o.field === "static" ? `"${o.text}"` : FIELD_LABELS[o.field];
    log(`  ${o.id.padEnd(12)} ${what.padEnd(24)} ${box}  ${o.size}pt (min ${o.minSize}) ${o.weight} ${o.align}/${o.vAlign}${o.maxLines > 1 ? ` ${o.maxLines} lines${o.balance ? " balanced" : ""}${(o.lineSpacing ?? 1) !== 1 ? ` spacing ${Math.round((o.lineSpacing ?? 1) * 100)}%` : ""}` : ""}${o.strike ? " strike" : ""}${o.color !== "#000000" ? ` ${o.color}` : ""}`);
  }
}

/** "1,3-5" -> [0,2,3,4] (0-based); "all"/undefined -> every row */
export function parseRows(spec: string | undefined, count: number): number[] {
  if (!spec || spec === "all") return Array.from({ length: count }, (_, i) => i);
  const out = new Set<number>();
  for (const part of spec.split(",")) {
    const [a, b] = part.split("-").map((x) => Number(x.trim()));
    if (!Number.isInteger(a) || (b !== undefined && !Number.isInteger(b))) die(`bad --rows "${spec}"`);
    if (b !== undefined && b < a!) die(`--rows ${part}: the range runs backwards (did you mean ${b}-${a}?)`);
    for (let i = a!; i <= (b ?? a!); i++) {
      if (i < 1 || i > count) die(`row ${i} is out of range 1-${count}`);
      out.add(i - 1);
    }
  }
  return [...out].sort((x, y) => x - y);
}

async function doExport(signs: Sign[], v: Flags) {
  const batch = readBatch();
  const options = {
    grid: v.grid ? GridSchema.parse(v.grid) : batch.options.grid,
    paper: v.paper ? PaperSchema.parse(v.paper) : batch.options.paper,
    cutMarks: v["no-cut-marks"] ? false : batch.options.cutMarks,
  };
  if (signs.length === 0) die("nothing to export - the batch is empty (signsnip add ...)");
  const small = (await checkSigns(signs)).filter((w) => w.code === "small-text");
  if (v.strict && small.length) {
    for (const w of small) console.error(`  ! ${w.message}`);
    die(`${small.length} sign${small.length === 1 ? "" : "s"} below the readable minimum - not exported (drop --strict to export anyway)`);
  }
  const pdf = await renderPdf(expandCopies(signs), options, "sheet");
  const out = path.resolve(String(v.o ?? path.join(OUT_DIR, "signs.pdf")));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, pdf.bytes);
  log(`wrote ${out}  (${pdf.signs} signs, ${pdf.pages} page${pdf.pages === 1 ? "" : "s"}, ${options.paper} ${options.grid})`);
  const warnings = (await checkSigns(signs)).filter((w) => w.level === "warn");
  for (const w of warnings) log(`  ! ${w.message}`);
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") return log(HELP);
  const { values: v, positionals: p } = parseArgs({ args: rest, options: opts, allowPositionals: true });
  if (v.help) return log(HELP);

  switch (cmd) {
    case "brands": {
      const [sub, a, b] = p;
      if (!sub) {
        for (const br of listBrands()) {
          const info = await logoInfo(br.id);
          const logo = info ? `${info.width}x${info.height}px${info.background !== "transparent" ? `, ${info.background} bg` : ""}` : "NO LOGO";
          log(`${br.id.padEnd(16)} ${br.name}  [${logo}${br.logoScale !== 1 ? `, scale ${br.logoScale}` : ""}]\n${" ".repeat(17)}${br.collections.join(", ") || "(no collections)"}`);
        }
        return;
      }
      if (sub === "add") {
        if (!a) die('usage: signsnip brands add "Name" [--logo file] [--collections "A,B"]');
        const br = upsertBrand({ name: a, collections: v.collections?.split(",").map((s) => s.trim()).filter(Boolean) });
        if (v.logo) await saveLogo(br.id, fs.readFileSync(v.logo));
        return log(`saved brand ${br.id}${v.logo ? " with logo" : ""}`);
      }
      const br = findBrand(a ?? "");
      if (sub === "logo") {
        if (!br || !b) die("usage: signsnip brands logo <brand> <file>");
        const { aspect } = await saveLogo(br.id, fs.readFileSync(b));
        return log(`logo set for ${br.id} (aspect ${aspect.toFixed(2)})`);
      }
      if (sub === "collections") {
        if (!br || b === undefined) die('usage: signsnip brands collections <brand> "A,B,C"');
        upsertBrand({ id: br.id, name: br.name, collections: b.split(",").map((s) => s.trim()).filter(Boolean) });
        return log("collections updated");
      }
      if (sub === "scale") {
        const k = Number(b);
        if (!br || !(k >= 0.5 && k <= 1.6)) die("usage: signsnip brands scale <brand> <0.5-1.6>");
        const info = await logoInfo(br.id);
        const max = info ? maxLogoScale(info.aspect) : 1.6;
        const use = Math.min(Math.round(k * 100) / 100, max);
        upsertBrand({ id: br.id, name: br.name, logoScale: use });
        return log(`${br.id} logo scale = ${use}${use < k ? ` (capped: this logo's shape maxes out at ${max})` : ""}`);
      }
      if (sub === "fix-bg") {
        if (!br) die("usage: signsnip brands fix-bg <brand>");
        const info = await removeLogoBackground(br.id);
        return log(`background removed for ${br.id} (now ${info.background}); undo with: signsnip brands restore ${br.id}`);
      }
      if (sub === "restore") { if (!br) die("usage: signsnip brands restore <brand>"); await restoreLogo(br.id); return log(`restored original logo for ${br.id}`); }
      if (sub === "rm") { if (!br) die("unknown brand"); deleteBrand(br.id); return log(`removed ${br.id}`); }
      return die(`unknown brands subcommand "${sub}"`);
    }
    case "presets": {
      for (const pr of listPresets()) {
        const offer = pr.sign.kind === "price" && pr.sign.price ? fmtMoney(pr.sign.price) : `${pr.sign.percent}%`;
        log(`${pr.id.padEnd(14)} ${pr.name}  (${pr.sign.brandId}: ${pr.sign.collection} ${offer})`);
      }
      return;
    }
    case "add": {
      const s = signFromFlags(v); const b = addToBatch([s]);
      return log(describe(s, b.items.length), `\nbatch now has ${b.items.length} row(s)`);
    }
    case "import": {
      if (!p[0]) die("usage: signsnip import <file.csv>");
      const signs = csvToSigns(fs.readFileSync(p[0], "utf8"));
      const b = addToBatch(signs); return log(`imported ${signs.length} row(s); batch now has ${b.items.length}`);
    }
    case "batch": {
      const b = readBatch();
      if (!b.items.length) return log("(batch is empty)");
      b.items.forEach((s, i) => log(describe(s, i + 1)));
      const total = expandCopies(b.items).length;
      const fill = pageFill(total, sheetGeometry(b.options).perPage);
      return log(`${total} signs · ${fill.pages} page${fill.pages === 1 ? "" : "s"} · last page ${fill.lastUsed}/${fill.lastUsed + fill.empty}${fill.empty ? ` (${fill.empty} empty - signsnip fill)` : ""} · ${b.options.paper} ${b.options.grid}`);
    }
    case "bulk": {
      const b = readBatch();
      if (!b.items.length) die("the batch is empty");
      const rows = parseRows(v.rows, b.items.length);
      const brand = v.brand ? findBrand(v.brand) : undefined;
      if (v.brand && !brand) die(`No brand matching "${v.brand}"`);
      const patch: Partial<Sign> = {};
      if (v.percent !== undefined) Object.assign(patch, { kind: "percent", percent: num(v.percent) });
      if (v.price !== undefined) Object.assign(patch, { kind: "price", price: cash(v.price) });
      if (v.was !== undefined) patch.wasPrice = v.was === "" ? undefined : cash(v.was);
      if (v["price-label"] !== undefined) patch.priceLabel = v["price-label"];
      if (brand) patch.brandId = brand.id;
      if (v.template !== undefined) {
        const t = findTemplate(v.template) ?? die(`No template matching "${v.template}"`);
        Object.assign(patch, { templateId: t.id, kind: t.kind });
        if (t.kind === "price" && rows.some((i) => !b.items[i]!.price) && v.price === undefined) die("those rows have no price - add --price too");
      }
      if (v.footer !== undefined) patch.footer = v.footer;
      if (v.prefix !== undefined) patch.prefix = v.prefix;
      if (v.copies !== undefined) patch.copies = num(v.copies);
      if (!Object.keys(patch).length) die("nothing to change - pass --percent, --price, --brand, --template, --footer, --prefix or --copies");
      for (const i of rows) b.items[i] = { ...b.items[i]!, ...patch };
      writeBatch(b);
      return log(`updated ${rows.length} row(s)`);
    }
    case "fill": {
      const b = readBatch();
      const last = b.items.at(-1);
      if (!last) die("the batch is empty");
      const fill = pageFill(expandCopies(b.items).length, sheetGeometry(b.options).perPage);
      if (!fill.empty) return log("last page is already full");
      last.copies += fill.empty; writeBatch(b);
      return log(`added ${fill.empty} cop${fill.empty === 1 ? "y" : "ies"} of row ${b.items.length}; last page is full`);
    }
    case "rm": {
      const n = Number(p[0]); const b = readBatch();
      if (!Number.isInteger(n) || n < 1 || n > b.items.length) die(`row must be 1-${b.items.length}`);
      b.items.splice(n - 1, 1); writeBatch(b); return log(`removed row ${n}`);
    }
    case "clear": { const b = readBatch(); writeBatch({ ...b, items: [] }); return log("batch cleared"); }
    case "batches": {
      if (p[0] === "rm") {
        const s = findSavedBatch(p[1] ?? "") ?? die("usage: signsnip batches rm <name>");
        deleteSavedBatch(s.id); return log(`deleted saved batch "${s.name}"`);
      }
      const all = listSavedBatches();
      if (!all.length) return log('(no saved batches - signsnip save "Name")');
      for (const s of all) log(`${s.id.padEnd(22)} ${s.name}  · ${expandCopies(s.batch.items).length} signs · saved ${s.savedAt.slice(0, 10)}`);
      return;
    }
    case "save": {
      const name = p[0] ?? die('usage: signsnip save "Batch name"');
      const b = readBatch();
      if (!b.items.length) die("the batch is empty - nothing to save");
      const s = saveNamedBatch(name, b); return log(`saved "${s.name}" (${s.id})${s.replaced ? " - replaced the earlier batch with that name" : ""}`);
    }
    case "load": {
      const s = findSavedBatch(p[0] ?? "") ?? die(`No saved batch matching "${p[0] ?? ""}". Try: signsnip batches`);
      writeBatch(s.batch); return log(`loaded "${s.name}" (${s.batch.items.length} rows)`);
    }
    case "templates": {
      const [sub, a, ...more] = p;
      if (!sub) {
        const items = readBatch().items;
        for (const t of listTemplates()) {
          const used = items.filter((s) => resolveTemplate(s, listTemplates()).id === t.id).length;
          log(`${t.id.padEnd(18)} ${t.name.padEnd(24)} ${t.kind.padEnd(8)} ${String(t.objects.length).padStart(2)} objects${used ? ` · used by ${used} row(s)` : ""}${isBuiltin(t.id) ? " · built-in" : ""}`);
        }
        return;
      }
      const t = sub === "import" || sub === "export" ? undefined : findTemplate(a ?? "");
      const need = () => t ?? die(`No template matching "${a ?? ""}". Try: signsnip templates`);
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
      if (sub === "fallback") {
        const to = more[0] ?? die("usage: signsnip templates fallback <tpl> <other-tpl|none>");
        const cur = need();
        if (to === "none") { saveTemplate({ ...cur, fallbackId: undefined }); return log(`${cur.id}: no fallback`); }
        const fb = findTemplate(to) ?? die(`No template matching "${to}"`);
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
        const ids = [a, ...more].filter((x): x is string => !!x).map((r) => (findTemplate(r) ?? die(`No template matching "${r}"`)).id);
        const set = exportTemplateSet(ids, v.name);
        const out = path.resolve(String(v.o ?? path.join(OUT_DIR, `${(v.name ?? "sign-templates").toLowerCase().replace(/[^a-z0-9]+/g, "-")}.signsnip.json`)));
        fs.mkdirSync(path.dirname(out), { recursive: true });
        fs.writeFileSync(out, JSON.stringify(set, null, 2) + "\n");
        return log(`wrote ${out} (${set.templates.length} template${set.templates.length === 1 ? "" : "s"}: ${set.templates.map((x) => x.id).join(", ")})`);
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
    case "rules": {
      const [sub, a, b] = p;
      const r = readRules();
      if (!sub) {
        log(`readable minimum: ${r.readableMin}pt`);
        log(r.abbreviations.length ? "abbreviations (used only when text would drop below the minimum):" : "no abbreviations");
        for (const x of r.abbreviations) log(`  ${x.from} -> ${x.to || "(removed)"}`);
        return;
      }
      if (sub === "min") {
        const n = Number(String(a ?? "").replace(/pt$/, ""));
        if (!(n >= 4 && n <= 40)) die("usage: signsnip rules min <4-40>");
        writeRules({ ...r, readableMin: n }); return log(`readable minimum = ${n}pt`);
      }
      if (sub === "abbr") {
        if (!a || b === undefined) die('usage: signsnip rules abbr "Word" "Short"');
        writeRules({ ...r, abbreviations: [...r.abbreviations, { from: a, to: b }] }); return log(`${a} -> ${b || "(removed)"}`);
      }
      if (sub === "abbr-rm") {
        const left = r.abbreviations.filter((x) => x.from.toLowerCase() !== String(a ?? "").toLowerCase());
        if (left.length === r.abbreviations.length) die(`no abbreviation for "${a ?? ""}"`);
        writeRules({ ...r, abbreviations: left }); return log(`removed ${a}`);
      }
      return die(`unknown rules subcommand "${sub}"`);
    }
    case "backup": {
      const ws = exportWorkspace();
      const file = v.o ?? path.join(OUT_DIR, `signsnip-backup-${new Date().toISOString().slice(0, 10)}.signsnip-backup.json`);
      fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(ws));
      const s = summarizeWorkspace(ws);
      return log(`backed up ${s.brands} brands (${s.logos} logos), ${s.templates} templates, ${s.presets} presets, ${s.saved} saved batches, ${s.signs} signs in the batch -> ${file}`);
    }
    case "restore": {
      if (!p[0]) die("usage: signsnip restore <file.signsnip-backup.json> --yes");
      let raw: unknown;
      try { raw = JSON.parse(fs.readFileSync(p[0], "utf8")); } catch { die(`can't read ${p[0]} as JSON`); }
      const s = summarizeWorkspace(parseWorkspace(raw));
      if (!v.yes) die(`this replaces EVERYTHING here with the backup from ${s.exportedAt.slice(0, 10)} (${s.brands} brands, ${s.templates} templates, ${s.saved} saved batches). Run again with --yes, and \`signsnip backup\` first if you want to keep the current data.`);
      restoreWorkspace(raw);
      return log(`restored: ${s.brands} brands (${s.logos} logos), ${s.templates} templates, ${s.presets} presets, ${s.saved} saved batches, ${s.signs} signs in the batch`);
    }
    case "start": {
      const from = p[0];
      if (from !== "scratch" && from !== "samples") die("usage: signsnip start scratch|samples --yes");
      if (!v.yes) die(`this wipes all brands, logos, templates, batches and rules here. Run again with --yes (and \`signsnip backup\` first to keep them).`);
      if (from === "scratch") startFromScratch(); else startWithSamples(seedSamples());
      return log(from === "scratch" ? "started from scratch: no brands, built-in templates, default text rules" : `started with samples: ${listBrands().length} made-up brands and a ${readBatch().items.length}-row batch`);
    }
    case "check": {
      const b = readBatch();
      if (!b.items.length) return log("(batch is empty)");
      const ws = await checkSigns(b.items);
      if (!ws.length) return log("no problems found");
      for (const w of ws) log(`${w.level === "warn" ? "!" : "i"} ${w.message}`);
      return;
    }
    case "calibrate": {
      const paper = v.paper ? PaperSchema.parse(v.paper) : readBatch().options.paper;
      const out = path.resolve(String(v.o ?? path.join(OUT_DIR, "printer-check.pdf")));
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, await renderCalibration(paper));
      return log(`wrote ${out} - print at 100% / Actual size and measure the box (47 x 70 mm)`);
    }
    case "export": return doExport(readBatch().items, v);
    case "make": return doExport([signFromFlags(v)], v);
    case "serve": { await import("../server/index.js"); return; }
    case "save-preset": {
      const s = signFromFlags(v); const name = p[0] ?? die("usage: signsnip save-preset <name> <add flags>");
      const id = String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-");
      const { id: _i, copies: _c, ...sign } = s;
      savePresets([...listPresets().filter((x) => x.id !== id), { id, name: String(name), sign }]);
      return log(`saved preset ${id}`);
    }
    default: die(`unknown command "${cmd}". Run: signsnip help`);
  }
}
main().catch((e) => {
  const issues = (e as { issues?: { path: (string | number)[]; message: string }[] }).issues;
  if (Array.isArray(issues)) die(issues.map((i) => `${i.path.join(".") || "value"}: ${i.message}`).join("; "));
  if ((e as NodeJS.ErrnoException).code === "ENOENT") die(`can't find ${(e as NodeJS.ErrnoException).path}`);
  die((e as Error).message);
});
