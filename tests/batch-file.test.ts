import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { exportBatchFile, importBatchFile, inspectBatchFile, parseBatchFile } from "../src/core/batch-file";
import { expandCopies, renderPdf } from "../src/core/pdf";
import { MemoryRepo, repo, setRepo } from "../src/core/repo";
import {
  duplicateTemplate, exportTemplateSet, importTemplateSet, listBrands, listSavedBatches, listTemplates, readBatch, readLogo,
  saveBackground, saveNamedBatch, saveTemplate, upsertBrand,
} from "../src/core/store";
import type { Batch, BatchFile, Template } from "../src/core/types";
import { exportWorkspace, startFromScratch, startWithSamples } from "../src/core/workspace";
import { assertSafeRepo, seedSamples, startServer, tmpWorkspace, useNodeWorkspace } from "./helpers";

/**
 * "Share as a file" / "Open a shared file": one batch moves to another workspace. Opening it
 * only adds (a new saved batch, new brands, new templates); a refused file changes nothing.
 */
const JSON_TYPE = { "content-type": "application/json" };
let seed: Awaited<ReturnType<typeof seedSamples>>;
let dir: string;
let picture: Uint8Array, otherLogo: Uint8Array;

/** Everything stored, by value (exportedAt is the only field that changes between exports), plus every blob key. */
const stored = () => {
  const { exportedAt: _, ...rest } = exportWorkspace();
  return { ...rest, blobs: [...(repo() as MemoryRepo).blobs.keys()].sort() };
};
const tpl = (id: string) => listTemplates().find((t) => t.id === id)!;
const json = <T>(x: T) => JSON.parse(JSON.stringify(x)) as T; // what a file gives back

/** The sender: the fake samples; one sign on a copied template with a background picture; one brand left unused. */
async function sender(): Promise<{ r: MemoryRepo; batch: Batch }> {
  const r = new MemoryRepo();
  setRepo(r);
  startWithSamples(seed);
  const t = duplicateTemplate("bogo", "Weekend special");
  const bg = await saveBackground(picture);
  saveTemplate({ ...t, background: { ...bg, fit: "cover", opacity: 0.3 } });
  const b = readBatch();
  const items = b.items.filter((s) => s.brandId !== "lumen-atelier").map((s, i) => (i === 0 ? { ...s, templateId: t.id } : s));
  return { r, batch: { ...b, items } };
}
const receiveEmpty = () => { const r = new MemoryRepo(); setRepo(r); startFromScratch(); return r; };

async function pdfText(batch: Batch, name: string): Promise<string> {
  const pdf = await renderPdf(expandCopies(batch.items), batch.options, "sheet");
  const file = path.join(dir, `${name}.pdf`);
  fs.writeFileSync(file, pdf.bytes);
  const out = spawnSync("pdftotext", ["-layout", file, "-"], { encoding: "utf8" });
  expect(out.status).toBe(0);
  return out.stdout;
}

beforeAll(async () => {
  dir = await useNodeWorkspace(tmpWorkspace("signsnip-batchfile-")); // sharp image ops + fonts
  assertSafeRepo();
  seed = await seedSamples();
  picture = new Uint8Array(await sharp({ create: { width: 64, height: 96, channels: 3, background: { r: 200, g: 220, b: 240 } } }).png().toBuffer());
  otherLogo = new Uint8Array(await sharp({ create: { width: 60, height: 20, channels: 4, background: { r: 10, g: 120, b: 80, alpha: 1 } } }).png().toBuffer());
});

describe("sharing a batch as a file", () => {
  it("carries only what the batch uses: its brands and logos, its templates and their pictures", async () => {
    const { batch } = await sender();
    const f = exportBatchFile(batch, "Friday sale");
    expect(f.format).toBe("signsnip/batch");
    expect(f.brands.map((b) => b.id).sort()).toEqual(["kestrel-vale", "northwind", "orbital", "tidemark"]); // lumen is in no sign
    expect(Object.keys(f.logos).sort()).toEqual(["kestrel-vale", "northwind", "orbital", "tidemark"]);
    expect(f.templates.map((t) => t.id)).toEqual(["weekend-special"]); // unchanged built-ins aren't carried
    expect(Object.keys(f.images)).toEqual([tpl("weekend-special").background!.image]);
    expect(f.brands.every((b) => !("hasLogo" in b) || b.hasLogo === false)).toBe(true);
    // a built-in the sender changed is carried
    const p = tpl("percent");
    saveTemplate({ ...p, safeMargin: 3 });
    expect(exportBatchFile(batch, "x").templates.map((t) => t.id).sort()).toEqual(["percent", "weekend-special"]);
  });
});

describe("opening a shared file", () => {
  it("into an empty workspace: prints the same, lands as a saved batch, the current batch is untouched", async () => {
    const { batch } = await sender();
    saveTemplate({ ...tpl("percent"), safeMargin: 3 }); // an edited built-in travels too
    const before = await pdfText(batch, "sender");
    const file = json(exportBatchFile(batch, "Friday sale"));

    receiveEmpty();
    const current = readBatch();
    const preview = inspectBatchFile(parseBatchFile(file));
    expect(preview).toMatchObject({ name: "Friday sale", signs: 4, copies: 8, pages: 1 });
    expect(preview.brands.every((b) => b.status === "new")).toBe(true);
    const res = await importBatchFile(file);
    expect(res.savedName).toBe("Friday sale");
    expect(res.brands.added).toHaveLength(4);
    expect(listBrands().every((b) => b.hasLogo)).toBe(true);
    expect(readBatch()).toEqual(current);
    const saved = listSavedBatches().find((s) => s.id === res.savedId)!;
    expect(await pdfText(saved.batch, "receiver")).toBe(before);
    // the edited built-in came in as a copy (this workspace's own "percent" is the stock one), and the signs use it
    expect(res.templates.renamed.map((x) => x.from)).toEqual(["percent"]);
    expect(saved.batch.items.filter((s) => s.kind === "percent" && s.templateId !== "weekend-special").every((s) => s.templateId === res.templates.idMap.percent)).toBe(true);
  });

  it("a brand with the same name keeps this workspace's logo and settings; its signs point at it", async () => {
    const { batch } = await sender();
    const file = json(exportBatchFile(batch, "Friday sale"));
    receiveEmpty();
    const mine = upsertBrand({ name: "northwind watch co. ", collections: ["Deckhand"], logoScale: 1.2 });
    repo().setBlob(`logos/${mine.id}`, otherLogo);
    const brandsBefore = listBrands().find((b) => b.id === mine.id);
    expect(inspectBatchFile(parseBatchFile(file)).brands.find((b) => b.name === "Northwind Watch Co.")!.status).toBe("yours");
    const res = await importBatchFile(file);
    expect(res.brands.kept).toEqual(["northwind watch co."]);
    expect(readLogo(mine.id)).toEqual(otherLogo);
    expect(listBrands().find((b) => b.id === mine.id)).toEqual(brandsBefore);
    expect(listBrands().filter((b) => /northwind/i.test(b.name))).toHaveLength(1);
    const items = listSavedBatches().find((s) => s.id === res.savedId)!.batch.items;
    expect(items.filter((s) => batch.items.find((x) => x.id === s.id)!.brandId === "northwind").every((s) => s.brandId === mine.id)).toBe(true);
  });

  it("a different brand that already has the id gets a new id; the one here is untouched", async () => {
    const { batch } = await sender();
    const file = json(exportBatchFile(batch, "Friday sale"));
    receiveEmpty();
    // idForName("Northwind Watch Co.") would be "northwind-watch-co": take that id with another name
    upsertBrand({ id: "northwind-watch-co", name: "Harbor Outlet" });
    repo().setBlob("logos/northwind-watch-co", otherLogo);
    const res = await importBatchFile(file);
    expect(res.brands.added).toContain("Northwind Watch Co.");
    expect(listBrands().find((b) => b.id === "northwind-watch-co")!.name).toBe("Harbor Outlet");
    expect(readLogo("northwind-watch-co")).toEqual(otherLogo);
    const added = listBrands().find((b) => b.name === "Northwind Watch Co.")!;
    expect(added.id).toBe("northwind-watch-co-2");
    expect(readLogo(added.id)).toEqual(new Uint8Array(Buffer.from(file.logos.northwind!, "base64")));
  });

  it("a template id that differs here: both are kept, the signs use the copy, this workspace's template is untouched", async () => {
    const { batch } = await sender();
    const file = json(exportBatchFile(batch, "Friday sale"));
    receiveEmpty();
    const mine: Template = saveTemplate({ ...structuredClone(tpl("percent")), id: "weekend-special", name: "Weekend special" });
    const preview = inspectBatchFile(parseBatchFile(file));
    expect(preview.templates.map((t) => [t.id, t.status])).toEqual([["weekend-special", "conflict"]]);
    const res = await importBatchFile(file);
    expect(res.templates.renamed).toEqual([{ from: "weekend-special", to: "weekend-special-imported" }]);
    expect(tpl("weekend-special")).toEqual(mine);
    expect(tpl("weekend-special-imported").name).toBe("Weekend special (imported)");
    expect(tpl("weekend-special-imported").background?.image).toBe(file.templates[0]!.background!.image);
    const items = listSavedBatches().find((s) => s.id === res.savedId)!.batch.items;
    expect(items[0]!.templateId).toBe("weekend-special-imported");
  });

  it("the same file twice: no second copy of any brand or template, and the second saved batch is “(2)”", async () => {
    const { batch } = await sender();
    const file = json(exportBatchFile(batch, "Friday sale"));
    receiveEmpty();
    await importBatchFile(file);
    const brands = listBrands().map((b) => b.id), templates = listTemplates().map((t) => t.id);
    const again = await importBatchFile(file);
    expect(again.brands.added).toEqual([]);
    expect(again.templates.added).toEqual([]);
    expect(again.templates.renamed).toEqual([]);
    expect(listBrands().map((b) => b.id)).toEqual(brands);
    expect(listTemplates().map((t) => t.id)).toEqual(templates);
    expect(listSavedBatches().map((s) => s.name).sort()).toEqual(["Friday sale", "Friday sale (2)"]);
  });

  it("a saved batch with the same name is never written over", async () => {
    const { batch } = await sender();
    const file = json(exportBatchFile(batch, "Harbor week"));
    receiveEmpty();
    const mine = saveNamedBatch("harbor week", { items: [], options: readBatch().options });
    const res = await importBatchFile(file);
    expect(res.savedName).toBe("Harbor week (2)");
    expect(listSavedBatches().find((s) => s.id === mine.id)!.batch.items).toEqual([]);
  });
});

describe("a refused file changes nothing", () => {
  let file: BatchFile;
  beforeAll(async () => { file = json(exportBatchFile((await sender()).batch, "Friday sale")); });

  it("the files people mix up get their own plain message", () => {
    receiveEmpty();
    expect(() => parseBatchFile(json(exportWorkspace()))).toThrow("That's a full backup. Use Restore for it.");
    expect(() => parseBatchFile(json(exportTemplateSet(["bogo"])))).toThrow("That's a template set. Import it on the Templates tab.");
    expect(() => parseBatchFile({ hello: "world" })).toThrow("That file isn't a SignSnip batch");
    expect(() => parseBatchFile(null)).toThrow("That file isn't a SignSnip batch");
    expect(() => parseBatchFile({ ...file, batch: { items: "nope" } })).toThrow(/^The batch file is damaged: batch.items/);
  });

  it("a logo with a PNG header and garbage after it: refused, nothing written", async () => {
    receiveEmpty();
    const before = stored();
    const bad = structuredClone(file);
    bad.logos.northwind = Buffer.concat([Buffer.from(bad.logos.northwind!, "base64").subarray(0, 16), Buffer.from("not really a picture")]).toString("base64");
    await expect(importBatchFile(bad)).rejects.toThrow("The batch file is damaged: the logo for northwind can't be opened as a picture");
    expect(stored()).toEqual(before);
  });

  it("logos or pictures nothing in the file uses, and duplicate ids, are refused as damaged", async () => {
    receiveEmpty();
    const before = stored();
    const stray = { ...file, logos: { ...file.logos, ghost: file.logos.northwind! } };
    await expect(importBatchFile(stray)).rejects.toThrow("The batch file is damaged: logos for unknown brands (ghost)");
    const img = { ...file, images: { ...file.images, abcdef0123: Object.values(file.images)[0]! } };
    await expect(importBatchFile(img)).rejects.toThrow("The batch file is damaged: pictures no template uses (abcdef01)");
    const dup = { ...file, brands: [...file.brands, file.brands[0]!] };
    await expect(importBatchFile(dup)).rejects.toThrow(`two brands share the id ${file.brands[0]!.id}`);
    expect(stored()).toEqual(before);
  });

  it("over the 20-page limit: refused before anything is written", async () => {
    receiveEmpty();
    const before = stored();
    const big = structuredClone(file);
    big.batch.items = big.batch.items.map((s) => ({ ...s, copies: 60 })); // 4 rows x 60 = 240 signs = 24 pages
    expect(() => parseBatchFile(big)).toThrow("That batch is too big to open here: 24 pages (240 signs). The limit is 20 pages.");
    await expect(importBatchFile(big)).rejects.toThrow("too big to open");
    expect(stored()).toEqual(before);
  });

  it("a write that fails part-way takes out everything the import added", async () => {
    class FailOnBatches extends MemoryRepo {
      armed = false;
      override setJson(key: string, value: unknown) { if (this.armed && key.startsWith("batches/")) throw new Error("the disk is full"); super.setJson(key, value); }
    }
    const r = new FailOnBatches();
    setRepo(r);
    startFromScratch();
    const before = stored();
    r.armed = true;
    await expect(importBatchFile(file)).rejects.toThrow("Opening the file failed and nothing was added: the disk is full");
    expect(stored()).toEqual(before);
  });
});

describe("the template-set import reports where each template went", () => {
  it("idMap: added -> itself, unchanged -> itself, kept both -> the copy, look-alike -> the one here", () => {
    receiveEmpty();
    const set = json(exportTemplateSet(["bogo", "percent-long"]));
    set.templates[0] = { ...set.templates[0]!, id: "flyer", name: "Flyer" };
    expect(importTemplateSet(set).idMap).toEqual({ flyer: "flyer", "percent-long": "percent-long" });
    const changed = structuredClone(set);
    changed.templates[0]!.safeMargin = 4;
    expect(importTemplateSet(changed).idMap).toEqual({ flyer: "flyer-imported", "percent-long": "percent-long" });
    expect(importTemplateSet(changed).idMap.flyer).toBe("flyer-imported"); // the same design is already here as the copy
  });
  it("an unchanged example template read back from a file matches the never-saved one here (key order doesn't matter)", async () => {
    const { batch } = await sender(); // writes its templates, so they come back in the schema's key order
    const file = json(exportBatchFile({ ...batch, items: batch.items.map((s) => ({ ...s, templateId: "bogo" })) }, "Two for one"));
    expect(file.templates.map((t) => t.id)).toEqual(["bogo"]);
    receiveEmpty(); // never saved its templates: the raw built-in objects
    expect(inspectBatchFile(parseBatchFile(file)).templates.map((t) => t.status)).toEqual(["same"]);
    const res = await importBatchFile(file);
    expect(res.templates).toMatchObject({ added: [], renamed: [], unchanged: ["bogo"], idMap: { bogo: "bogo" } });
    expect(listTemplates().filter((t) => t.name.includes("imported"))).toEqual([]);
  });
});

describe("the local server", () => {
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  // startServer waits up to 30 s; a shorter hook timeout would leave a started server behind with nothing to stop it
  beforeAll(async () => { server = await startServer(tmpWorkspace("signsnip-batchfile-srv-")); }, 60_000);
  afterAll(async () => { await server?.stop(); });

  it("shares, refuses a damaged file with a 400 and a plain message (nothing changed), then opens a good one", async () => {
    const call = server!.call;
    const state = async () => JSON.parse((await call("GET", "/api/state")).body);
    const batch = (await state()).batch as Batch;
    batch.items = [{ id: "s1", brandId: "northwind", kind: "percent", prefix: "SELECT", collection: "Harbor Line", percent: 40, offLabel: "OFF*", priceLabel: "", footer: "*MSRP", copies: 2 }];
    expect((await call("PUT", "/api/batch", JSON_TYPE, JSON.stringify(batch))).status).toBe(200);
    const exp = await call("POST", "/api/batch-file/export", JSON_TYPE, JSON.stringify({ batch, name: "Harbor weekend" }));
    expect(exp.status, exp.body).toBe(200);
    const file = JSON.parse(exp.body) as BatchFile;
    expect(file.brands.map((b) => b.id)).toEqual(["northwind"]);

    const before = await state();
    const bad = { ...file, logos: { northwind: Buffer.concat([Buffer.from(file.logos.northwind!, "base64").subarray(0, 16), Buffer.alloc(40, 7)]).toString("base64") } };
    const refused = await call("POST", "/api/batch-file/import", JSON_TYPE, JSON.stringify(bad));
    expect(refused.status).toBe(400);
    expect(JSON.parse(refused.body).error).toBe("The batch file is damaged: the logo for northwind can't be opened as a picture");
    const wrong = await call("POST", "/api/batch-file/inspect", JSON_TYPE, JSON.stringify({ format: "signsnip/workspace" }));
    expect(wrong.status).toBe(400);
    expect(JSON.parse(wrong.body).error).toBe("That's a full backup. Use Restore for it.");
    expect(await state()).toEqual(before);

    const preview = await call("POST", "/api/batch-file/inspect", JSON_TYPE, JSON.stringify(file));
    expect(JSON.parse(preview.body).brands).toEqual([{ name: "Northwind Watch Co.", status: "yours" }]);
    const ok = await call("POST", "/api/batch-file/import", JSON_TYPE, JSON.stringify(file));
    expect(ok.status, ok.body).toBe(200);
    const after = await state();
    expect(after.saved.map((s: { name: string }) => s.name)).toEqual(["Harbor weekend"]);
    expect(after.batch).toEqual(before.batch);
    expect(after.brands).toEqual(before.brands);
  });
});
