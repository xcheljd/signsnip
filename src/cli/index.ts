import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { addToBatch, buildSign, csvToSigns } from "../core/batch.js";
import { OUT_DIR } from "../core/paths.js";
import { expandCopies, renderPdf } from "../core/pdf.js";
import {
  deleteBrand, findBrand, listBrands, listPresets, readBatch, saveLogo, savePresets, upsertBrand, writeBatch,
} from "../core/store.js";
import { GridSchema, PaperSchema, type Sign } from "../core/types.js";

const HELP = `signo - Sign-O-Matic CLI (47x70mm shelf signs -> print-ready PDF)

Brands
  signo brands                              list brands + collections
  signo brands add "Name" [--logo file] [--collections "A,B,C"]
  signo brands logo <brand> <file>          set/replace a logo (png/jpg/webp/svg)
  signo brands collections <brand> "A,B,C"  replace the collection list
  signo brands rm <brand>

Batch (shared live with the web UI)
  signo add --brand <id|name> --collection "Harbor Line" --percent 50 [--prefix SELECT] [--footer "*MSRP"] [--copies 2]
  signo add --preset <id|name> [--copies 4]
  signo import <file.csv>                   columns: brand,collection,percent[,copies,prefix,footer]
  signo batch                               show the current batch
  signo rm <row#>                           remove one row (1-based)
  signo clear                               empty the batch

Output
  signo export [-o out/signs.pdf] [--grid landscape-5x2|portrait-4x3] [--paper letter|a4] [--no-cut-marks]
  signo make  <same flags as add> [-o file]  one-shot: a sheet from a single spec
  signo presets
  signo serve                               start the web UI (http://127.0.0.1:7047)
`;

const log = (...a: unknown[]) => console.log(...a);
function die(m: string): never { console.error(`error: ${m}`); process.exit(1); }

const opts = {
  brand: { type: "string" }, preset: { type: "string" }, collection: { type: "string" }, prefix: { type: "string" },
  percent: { type: "string" }, footer: { type: "string" }, copies: { type: "string" }, off: { type: "string" },
  logo: { type: "string" }, collections: { type: "string" }, o: { type: "string", short: "o" }, grid: { type: "string" },
  paper: { type: "string" }, "no-cut-marks": { type: "boolean" }, help: { type: "boolean", short: "h" },
} as const;

function signFromFlags(v: Record<string, string | boolean | undefined>): Sign {
  const num = (x: unknown) => (x === undefined ? undefined : Number(String(x).replace("%", "")));
  return buildSign({
    brand: v.brand as string | undefined, preset: v.preset as string | undefined, collection: v.collection as string | undefined,
    prefix: v.prefix as string | undefined, percent: num(v.percent), offLabel: v.off as string | undefined,
    footer: v.footer as string | undefined, copies: num(v.copies),
  });
}

function describe(s: Sign, n: number) {
  const b = findBrand(s.brandId)?.name ?? s.brandId;
  return `${String(n).padStart(2)}. ${b} | ${[s.prefix, s.collection].filter(Boolean).join(" ")} | ${s.percent}% ${s.offLabel} | ${s.footer} | x${s.copies}`;
}

async function doExport(signs: Sign[], v: Record<string, string | boolean | undefined>) {
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
        for (const br of listBrands()) log(`${br.id.padEnd(16)} ${br.name}  [logo: ${br.hasLogo ? "yes" : "NO"}]\n${" ".repeat(17)}${br.collections.join(", ") || "(no collections)"}`);
        return;
      }
      if (sub === "add") {
        if (!a) die('usage: signo brands add "Name" [--logo file] [--collections "A,B"]');
        const br = upsertBrand({ name: a, collections: v.collections?.split(",").map((s) => s.trim()).filter(Boolean) });
        if (v.logo) await saveLogo(br.id, fs.readFileSync(v.logo));
        return log(`saved brand ${br.id}${v.logo ? " with logo" : ""}`);
      }
      if (sub === "logo") {
        const br = findBrand(a ?? ""); if (!br || !b) die("usage: signo brands logo <brand> <file>");
        const { aspect } = await saveLogo(br!.id, fs.readFileSync(b!));
        return log(`logo set for ${br!.id} (aspect ${aspect.toFixed(2)})`);
      }
      if (sub === "collections") {
        const br = findBrand(a ?? ""); if (!br || b === undefined) die('usage: signo brands collections <brand> "A,B,C"');
        upsertBrand({ id: br!.id, name: br!.name, collections: b!.split(",").map((s) => s.trim()).filter(Boolean) });
        return log("collections updated");
      }
      if (sub === "rm") { const br = findBrand(a ?? ""); if (!br) die("unknown brand"); deleteBrand(br!.id); return log(`removed ${br!.id}`); }
      return die(`unknown brands subcommand "${sub}"`);
    }
    case "presets": {
      for (const pr of listPresets()) log(`${pr.id.padEnd(14)} ${pr.name}  (${pr.sign.brandId}: ${pr.sign.collection} ${pr.sign.percent}%)`);
      return;
    }
    case "add": {
      const s = signFromFlags(v); const b = addToBatch([s]);
      return log(describe(s, b.items.length), `\nbatch now has ${b.items.length} row(s)`);
    }
    case "import": {
      if (!p[0]) die("usage: signo import <file.csv>");
      const signs = csvToSigns(fs.readFileSync(p[0]!, "utf8"));
      const b = addToBatch(signs); return log(`imported ${signs.length} row(s); batch now has ${b.items.length}`);
    }
    case "batch": {
      const b = readBatch();
      if (!b.items.length) return log("(batch is empty)");
      b.items.forEach((s, i) => log(describe(s, i + 1)));
      return log(`${expandCopies(b.items).length} signs total · ${b.options.paper} ${b.options.grid}`);
    }
    case "rm": {
      const n = Number(p[0]); const b = readBatch();
      if (!Number.isInteger(n) || n < 1 || n > b.items.length) die(`row must be 1-${b.items.length}`);
      b.items.splice(n - 1, 1); writeBatch(b); return log(`removed row ${n}`);
    }
    case "clear": { const b = readBatch(); writeBatch({ ...b, items: [] }); return log("batch cleared"); }
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
