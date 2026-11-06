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
  readBatch, removeLogoBackground, restoreLogo, saveLogo, saveNamedBatch, savePresets, upsertBrand, writeBatch,
} from "../core/store.js";
import { GridSchema, PaperSchema, type Sign } from "../core/types.js";

const HELP = `signo - Sign-O-Matic CLI (47x70mm shelf signs -> print-ready PDF)

Brands
  signo brands                              list brands, collections, logo status
  signo brands add "Name" [--logo file] [--collections "A,B,C"]
  signo brands logo <brand> <file>          set/replace a logo (png/jpg/webp/svg)
  signo brands collections <brand> "A,B,C"  replace the collection list
  signo brands scale <brand> <0.5-1.6>      grow/shrink that brand's logo on every sign
  signo brands fix-bg <brand>               make a logo's solid background transparent
  signo brands restore <brand>              undo fix-bg
  signo brands rm <brand>

Batch (shared live with the web UI)
  signo add --brand <id|name> --collection "Harbor Line" --percent 50 [--prefix SELECT] [--footer "*MSRP"] [--copies 2]
  signo add --brand <b> --collection Comet --price 199 [--was 395] [--price-label NOW]   price-point sign
  signo add --preset <id|name> [--copies 4]
  signo import <file.csv>                   columns: brand,collection,percent|price[,was,price_label,copies,prefix,footer]
  signo batch                               show the current batch + page fill
  signo bulk [--rows 1,3-5|all] --percent 50 | --price 199 | --brand <b> | --footer "x" | --copies 2
  signo fill                                top up the last page with copies of the last row
  signo rm <row#>                           remove one row (1-based)
  signo clear                               empty the batch

Saved batches
  signo batches                             list saved batches
  signo save "Holiday sale"                 save the current batch under a name
  signo load "Holiday sale"                 replace the current batch with a saved one
  signo batches rm "Holiday sale"

Output
  signo export [-o out/signs.pdf] [--grid landscape-5x2|portrait-4x3] [--paper letter|a4] [--no-cut-marks]
  signo make  <same flags as add> [-o file]  one-shot: a sheet from a single spec
  signo check                               pre-print warnings (low-res logos, tiny text, ...)
  signo calibrate [-o file] [--paper a4]     printer check page (47x70 box + rulers)
  signo presets
  signo serve                               start the web UI (http://127.0.0.1:7047)
`;

const log = (...a: unknown[]) => console.log(...a);
function die(m: string): never { console.error(`error: ${m}`); process.exit(1); }

const opts = {
  brand: { type: "string" }, preset: { type: "string" }, collection: { type: "string" }, prefix: { type: "string" },
  percent: { type: "string" }, footer: { type: "string" }, copies: { type: "string" }, off: { type: "string" },
  price: { type: "string" }, was: { type: "string" }, "price-label": { type: "string" }, rows: { type: "string" },
  logo: { type: "string" }, collections: { type: "string" }, o: { type: "string", short: "o" }, grid: { type: "string" },
  paper: { type: "string" }, "no-cut-marks": { type: "boolean" }, help: { type: "boolean", short: "h" },
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
  });
}

export function describe(s: Sign, n: number) {
  const b = findBrand(s.brandId)?.name ?? s.brandId;
  const offer = s.kind === "price" && s.price
    ? [s.priceLabel.toUpperCase(), fmtMoney(s.price), s.wasPrice ? `(was ${fmtMoney(s.wasPrice)})` : ""].filter(Boolean).join(" ")
    : `${s.percent}% ${s.offLabel}`;
  return `${String(n).padStart(2)}. ${b} | ${[s.prefix, s.collection].filter(Boolean).join(" ")} | ${offer} | ${s.footer || "-"} | x${s.copies}`;
}

/** "1,3-5" -> [0,2,3,4] (0-based); "all"/undefined -> every row */
export function parseRows(spec: string | undefined, count: number): number[] {
  if (!spec || spec === "all") return Array.from({ length: count }, (_, i) => i);
  const out = new Set<number>();
  for (const part of spec.split(",")) {
    const [a, b] = part.split("-").map((x) => Number(x.trim()));
    if (!Number.isInteger(a) || (b !== undefined && !Number.isInteger(b))) die(`bad --rows "${spec}"`);
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
  if (signs.length === 0) die("nothing to export - the batch is empty (signo add ...)");
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
        if (!a) die('usage: signo brands add "Name" [--logo file] [--collections "A,B"]');
        const br = upsertBrand({ name: a, collections: v.collections?.split(",").map((s) => s.trim()).filter(Boolean) });
        if (v.logo) await saveLogo(br.id, fs.readFileSync(v.logo));
        return log(`saved brand ${br.id}${v.logo ? " with logo" : ""}`);
      }
      const br = findBrand(a ?? "");
      if (sub === "logo") {
        if (!br || !b) die("usage: signo brands logo <brand> <file>");
        const { aspect } = await saveLogo(br.id, fs.readFileSync(b));
        return log(`logo set for ${br.id} (aspect ${aspect.toFixed(2)})`);
      }
      if (sub === "collections") {
        if (!br || b === undefined) die('usage: signo brands collections <brand> "A,B,C"');
        upsertBrand({ id: br.id, name: br.name, collections: b.split(",").map((s) => s.trim()).filter(Boolean) });
        return log("collections updated");
      }
      if (sub === "scale") {
        const k = Number(b);
        if (!br || !(k >= 0.5 && k <= 1.6)) die("usage: signo brands scale <brand> <0.5-1.6>");
        const info = await logoInfo(br.id);
        const max = info ? maxLogoScale(info.aspect) : 1.6;
        const use = Math.min(Math.round(k * 100) / 100, max);
        upsertBrand({ id: br.id, name: br.name, logoScale: use });
        return log(`${br.id} logo scale = ${use}${use < k ? ` (capped: this logo's shape maxes out at ${max})` : ""}`);
      }
      if (sub === "fix-bg") {
        if (!br) die("usage: signo brands fix-bg <brand>");
        const info = await removeLogoBackground(br.id);
        return log(`background removed for ${br.id} (now ${info.background}); undo with: signo brands restore ${br.id}`);
      }
      if (sub === "restore") { if (!br) die("usage: signo brands restore <brand>"); await restoreLogo(br.id); return log(`restored original logo for ${br.id}`); }
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
      if (!p[0]) die("usage: signo import <file.csv>");
      const signs = csvToSigns(fs.readFileSync(p[0], "utf8"));
      const b = addToBatch(signs); return log(`imported ${signs.length} row(s); batch now has ${b.items.length}`);
    }
    case "batch": {
      const b = readBatch();
      if (!b.items.length) return log("(batch is empty)");
      b.items.forEach((s, i) => log(describe(s, i + 1)));
      const total = expandCopies(b.items).length;
      const fill = pageFill(total, sheetGeometry(b.options).perPage);
      return log(`${total} signs · ${fill.pages} page${fill.pages === 1 ? "" : "s"} · last page ${fill.lastUsed}/${fill.lastUsed + fill.empty}${fill.empty ? ` (${fill.empty} empty - signo fill)` : ""} · ${b.options.paper} ${b.options.grid}`);
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
      if (v.footer !== undefined) patch.footer = v.footer;
      if (v.prefix !== undefined) patch.prefix = v.prefix;
      if (v.copies !== undefined) patch.copies = num(v.copies);
      if (!Object.keys(patch).length) die("nothing to change - pass --percent, --price, --brand, --footer, --prefix or --copies");
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
        const s = findSavedBatch(p[1] ?? "") ?? die("usage: signo batches rm <name>");
        deleteSavedBatch(s.id); return log(`deleted saved batch "${s.name}"`);
      }
      const all = listSavedBatches();
      if (!all.length) return log('(no saved batches - signo save "Name")');
      for (const s of all) log(`${s.id.padEnd(22)} ${s.name}  · ${expandCopies(s.batch.items).length} signs · saved ${s.savedAt.slice(0, 10)}`);
      return;
    }
    case "save": {
      const name = p[0] ?? die('usage: signo save "Batch name"');
      const b = readBatch();
      if (!b.items.length) die("the batch is empty - nothing to save");
      const s = saveNamedBatch(name, b); return log(`saved "${s.name}" (${s.id})`);
    }
    case "load": {
      const s = findSavedBatch(p[0] ?? "") ?? die(`No saved batch matching "${p[0] ?? ""}". Try: signo batches`);
      writeBatch(s.batch); return log(`loaded "${s.name}" (${s.batch.items.length} rows)`);
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
      const s = signFromFlags(v); const name = p[0] ?? die("usage: signo save-preset <name> <add flags>");
      const id = String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-");
      const { id: _i, copies: _c, ...sign } = s;
      savePresets([...listPresets().filter((x) => x.id !== id), { id, name: String(name), sign }]);
      return log(`saved preset ${id}`);
    }
    default: die(`unknown command "${cmd}". Run: signo help`);
  }
}
main().catch((e) => die((e as Error).message));
