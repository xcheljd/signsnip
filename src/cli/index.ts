import "../core/node.js";
import { count } from "../core/words.js";
// `signsnip batch | head` closes the pipe early: exit quietly instead of crashing
process.stdout.on("error", (e: NodeJS.ErrnoException) => { if (e.code === "EPIPE") process.exit(0); throw e; });
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { addToBatch, buildSign, csvToSigns } from "../core/batch.js";
import { pageFill, sheetGeometry } from "../core/geometry.js";
import { money as fmtMoney } from "../core/layout.js";
import { seedSamples } from "../core/node.js";
import { OUT_DIR } from "../core/paths.js";
import { checkSigns, expandCopies, renderCalibration, renderPdf } from "../core/pdf.js";
import {
  brandMatches, deleteSavedBatch, listBrands, listPresets, listSavedBatches, readBatch, readRules, saveNamedBatch,
  savedBatchMatches, savePresets, slugify, templateMatches, writeBatch, writeRules,
} from "../core/store.js";
import { GridSchema, PaperSchema, type Sign } from "../core/types.js";
import { exportWorkspace, parseWorkspace, restoreWorkspace, startFromScratch, startWithSamples, summarizeWorkspace } from "../core/workspace.js";
import { brandsCommand } from "./brands.js";
import { HELP } from "./help.js";
import { cash, describe, die, log, num, pick, type Flags } from "./shared.js";
import { templatesCommand } from "./templates.js";

const opts = {
  brand: { type: "string" }, preset: { type: "string" }, collection: { type: "string" }, prefix: { type: "string" },
  percent: { type: "string" }, footer: { type: "string" }, copies: { type: "string" }, off: { type: "string" },
  price: { type: "string" }, was: { type: "string" }, "price-label": { type: "string" }, rows: { type: "string" },
  template: { type: "string" }, name: { type: "string" }, replace: { type: "boolean" }, strict: { type: "boolean" },
  logo: { type: "string" }, collections: { type: "string" }, o: { type: "string", short: "o" }, grid: { type: "string" },
  paper: { type: "string" }, "no-cut-marks": { type: "boolean" }, help: { type: "boolean", short: "h" }, yes: { type: "boolean" },
  fit: { type: "string" }, strength: { type: "string" },
} as const;

function signFromFlags(v: Flags): Sign {
  return buildSign({
    brand: v.brand as string | undefined, preset: v.preset as string | undefined, collection: v.collection as string | undefined,
    prefix: v.prefix as string | undefined, percent: num(v.percent), offLabel: v.off as string | undefined,
    footer: v.footer as string | undefined, copies: num(v.copies),
    price: cash(v.price), wasPrice: cash(v.was), priceLabel: v["price-label"] as string | undefined,
    template: v.template as string | undefined,
  });
}

/** "1,3-5" -> [0,2,3,4] (0-based); "all"/undefined -> every row */
function parseRows(spec: string | undefined, count: number): number[] {
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
    die(`${count(small.length, "sign")} below the readable minimum - not exported (drop --strict to export anyway)`);
  }
  const pdf = await renderPdf(expandCopies(signs), options, "sheet");
  const out = path.resolve(String(v.o ?? path.join(OUT_DIR, "signs.pdf")));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, pdf.bytes);
  log(`wrote ${out}  (${count(pdf.signs, "sign")}, ${count(pdf.pages, "page")}, ${options.paper} ${options.grid})`);
  const warnings = (await checkSigns(signs)).filter((w) => w.level === "warn");
  for (const w of warnings) log(`  ! ${w.message}`);
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") return log(HELP);
  const { values: v, positionals: p } = parseArgs({ args: rest, options: opts, allowPositionals: true });
  if (v.help) return log(HELP);

  switch (cmd) {
    case "brands": return brandsCommand(p, v);
    case "presets": {
      for (const pr of listPresets()) {
        const offer = pr.sign.kind === "price" && pr.sign.price ? fmtMoney(pr.sign.price) : `${pr.sign.percent}%`;
        log(`${pr.id.padEnd(14)} ${pr.name}  (${pr.sign.brandId}: ${pr.sign.collection} ${offer})`);
      }
      return;
    }
    case "add": {
      const s = signFromFlags(v); const b = addToBatch([s]);
      return log(describe(s, b.items.length), `\nbatch now has ${count(b.items.length, "row")}`);
    }
    case "import": {
      if (!p[0]) die("usage: signsnip import <file.csv>");
      const signs = csvToSigns(fs.readFileSync(p[0], "utf8"));
      const b = addToBatch(signs); return log(`imported ${count(signs.length, "row")}; batch now has ${b.items.length}`);
    }
    case "batch": {
      const b = readBatch();
      if (!b.items.length) return log("(batch is empty)");
      b.items.forEach((s, i) => log(describe(s, i + 1)));
      const total = expandCopies(b.items).length;
      const fill = pageFill(total, sheetGeometry(b.options).perPage);
      return log(`${count(total, "sign")} · ${count(fill.pages, "page")} · last page ${fill.lastUsed}/${fill.lastUsed + fill.empty}${fill.empty ? ` (${fill.empty} empty - signsnip fill)` : ""} · ${b.options.paper} ${b.options.grid}`);
    }
    case "bulk": {
      const b = readBatch();
      if (!b.items.length) die("the batch is empty");
      const rows = parseRows(v.rows, b.items.length);
      const brand = v.brand === undefined ? undefined : pick(brandMatches(v.brand), v.brand, "brand", "signsnip bulk --brand <brand>", "signsnip brands");
      const patch: Partial<Sign> = {};
      if (v.percent !== undefined) Object.assign(patch, { kind: "percent", percent: num(v.percent) });
      if (v.price !== undefined) Object.assign(patch, { kind: "price", price: cash(v.price) });
      if (v.was !== undefined) patch.wasPrice = v.was === "" ? undefined : cash(v.was);
      if (v["price-label"] !== undefined) patch.priceLabel = v["price-label"];
      if (brand) patch.brandId = brand.id;
      if (v.template !== undefined) {
        const t = pick(templateMatches(v.template), v.template, "template", "signsnip bulk --template <tpl>", "signsnip templates");
        Object.assign(patch, { templateId: t.id, kind: t.kind });
        if (t.kind === "price" && rows.some((i) => !b.items[i]!.price) && v.price === undefined) die("those rows have no price - add --price too");
      }
      if (v.footer !== undefined) patch.footer = v.footer;
      if (v.prefix !== undefined) patch.prefix = v.prefix;
      if (v.copies !== undefined) patch.copies = num(v.copies);
      if (!Object.keys(patch).length) die("nothing to change - pass --percent, --price, --brand, --template, --footer, --prefix or --copies");
      for (const i of rows) b.items[i] = { ...b.items[i]!, ...patch };
      writeBatch(b);
      return log(`updated ${count(rows.length, "row")}`);
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
      if (!b.items.length) die("the batch is empty - nothing to remove");
      if (!Number.isInteger(n) || n < 1 || n > b.items.length) die(b.items.length === 1 ? "the batch has one row: signsnip rm 1" : `row must be 1-${b.items.length}`);
      b.items.splice(n - 1, 1); writeBatch(b); return log(`removed row ${n}`);
    }
    case "clear": { const b = readBatch(); writeBatch({ ...b, items: [] }); return log("batch cleared"); }
    case "batches": {
      if (p[0] === "rm") {
        const s = pick(savedBatchMatches(p[1] ?? ""), p[1], "saved batch", "signsnip batches rm <name>", "signsnip batches");
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
      const s = pick(savedBatchMatches(p[0] ?? ""), p[0], "saved batch", "signsnip load <name>", "signsnip batches");
      writeBatch(s.batch); return log(`loaded "${s.name}" (${s.batch.items.length} rows)`);
    }
    case "templates": return templatesCommand(p, v);
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
      return log(`backed up ${count(s.brands, "brand")} (${count(s.logos, "logo")}), ${count(s.templates, "template")}, ${count(s.presets, "preset")}, ${count(s.saved, "saved batch")}, ${count(s.signs, "sign")} in the batch -> ${file}`);
    }
    case "restore": {
      if (!p[0]) die("usage: signsnip restore <file.signsnip-backup.json> --yes");
      let raw: unknown;
      try { raw = JSON.parse(fs.readFileSync(p[0], "utf8")); } catch { die(`can't read ${p[0]} as JSON`); }
      const s = summarizeWorkspace(parseWorkspace(raw));
      if (!v.yes) die(`this replaces EVERYTHING here with the backup from ${s.exportedAt.slice(0, 10)} (${count(s.brands, "brand")}, ${count(s.templates, "template")}, ${count(s.saved, "saved batch")}). Run again with --yes, and \`signsnip backup\` first if you want to keep the current data.`);
      restoreWorkspace(raw);
      return log(`restored: ${count(s.brands, "brand")} (${count(s.logos, "logo")}), ${count(s.templates, "template")}, ${count(s.presets, "preset")}, ${count(s.saved, "saved batch")}, ${count(s.signs, "sign")} in the batch`);
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
      const id = slugify(String(name), "preset");
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
