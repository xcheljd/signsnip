import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import { addToBatch, buildSign, csvToSigns, money } from "../src/core/batch";
import { pageFill, sheetGeometry } from "../src/core/geometry";
import { checkSigns, expandCopies, renderCalibration, renderPdf } from "../src/core/pdf";
import {
  addBrand, deleteTemplate, duplicateTemplate, exportTemplateSet, importTemplateSet, listBrands, listSavedBatches, listTemplates,
  logoInfo, parseTemplateSet, readBatch, readRules, removeLogoBackground, resetTemplate, restoreLogo, saveLogo, saveNamedBatch,
  savedBatchMatches, saveTemplate, writeBatch, writeRules,
} from "../src/core/store";
import type { Template, TextObject } from "../src/core/types";
import { exportWorkspace, parseWorkspace, restoreWorkspace, startFromScratch, startWithSamples, summarizeWorkspace } from "../src/core/workspace";
import { assertSafeRepo, root, seedSamples, tmpWorkspace, useNodeWorkspace } from "./helpers";

/** End-to-end over the core functions (what the web app and the server call), on a temp data dir. */
let data: string;
beforeAll(async () => {
  data = await useNodeWorkspace(tmpWorkspace("signsnip-ws-"));
  assertSafeRepo();
});

const add = (input: Parameters<typeof buildSign>[0]) => addToBatch([buildSign(input)]);
const clear = () => writeBatch({ ...readBatch(), items: [] });
/** what Download / Print / the server's /api/pdf do with the batch */
const exportBatch = async (file?: string) => {
  const b = readBatch();
  const pdf = await renderPdf(expandCopies(b.items), b.options, "sheet");
  if (file) fs.writeFileSync(file, pdf.bytes);
  return pdf;
};
const tpl = (id: string) => listTemplates().find((t) => t.id === id)!;
const textObj = (t: Template, id: string) => t.objects.find((o) => o.id === id) as TextObject;
/** set props on one text object of a template and save it */
const edit = (id: string, objectId: string, props: Partial<TextObject>) => {
  const t = tpl(id);
  return saveTemplate({ ...t, objects: t.objects.map((o) => (o.id === objectId ? { ...o, ...props } as typeof o : o)) });
};
const codes = async () => (await checkSigns(readBatch().items));
const json = (x: unknown) => JSON.parse(JSON.stringify(x)) as unknown; // what a file on disk gives back

describe("core end-to-end (isolated data dir)", () => {
  it("lists the seeded fake brands", () => {
    const brands = listBrands();
    expect(brands.map((b) => b.name)).toContain("Northwind Watch Co.");
    expect(brands).toHaveLength(5);
    expect(brands.every((b) => b.hasLogo)).toBe(true);
    expect(fs.existsSync(path.join(data, "brands.json"))).toBe(true); // seeded into the temp dir, not anywhere else
  });
  it("adds signs, then exports a valid 1-page PDF", async () => {
    add({ brand: "northwind", collection: "Harbor Line", percent: 50, copies: 3 });
    add({ brand: "orbital", collection: "Deep Field Chronograph", percent: 80, copies: 2 });
    const out = path.join(data, "o.pdf");
    const pdf = await exportBatch(out);
    expect(pdf).toMatchObject({ signs: 5, pages: 1 });
    expect(fs.readFileSync(out).subarray(0, 5).toString()).toBe("%PDF-");
    const text = spawnSync("pdftotext", ["-layout", out, "-"], { encoding: "utf8" });
    expect(text.status).toBe(0);
    expect(text.stdout).toContain("HARBOR LINE");
    expect(text.stdout).toContain("80%");
  });
  it("spills onto a second page after 10 signs", async () => {
    add({ brand: "tidemark", collection: "Tidepool", percent: 40, copies: 6 });
    expect(await exportBatch()).toMatchObject({ signs: 11, pages: 2 });
  });
  it("imports CSV rows and rejects bad input with a clear error", () => {
    const signs = csvToSigns('brand,collection,percent,copies\nlumen,Dusk,30,2\n"Kestrel & Vale","Field Master, Auto",60%,1\n');
    expect(signs.map((s) => [s.brandId, s.collection, s.percent, s.copies])).toEqual([["lumen-atelier", "Dusk", 30, 2], ["kestrel-vale", "Field Master, Auto", 60, 1]]);
    const before = readBatch().items.length;
    expect(addToBatch(signs).items).toHaveLength(before + 2);
    expect(() => buildSign({ brand: "nope", percent: 50 })).toThrow('No brand matching "nope"');
    expect(() => buildSign({ brand: "northwind", percent: 150 })).toThrow(/percent/);
    expect(readBatch().items).toHaveLength(before + 2); // nothing half-added
  });
  it("makes price signs, counts the empty slots, saves and reloads a batch", async () => {
    clear();
    expect(money("$1,295")).toBe(1295);
    const s = add({ brand: "kestrel", collection: "Falcon", price: money("$1,295"), wasPrice: money("1595"), priceLabel: "now" }).items[0]!;
    expect(s).toMatchObject({ kind: "price", price: 1295, wasPrice: 1595, priceLabel: "now", brandId: "kestrel-vale", footer: "" });
    add({ brand: "tidemark", collection: "Tidepool", percent: 40 });
    const b = readBatch();
    expect(pageFill(expandCopies(b.items).length, sheetGeometry(b.options).perPage)).toEqual({ pages: 1, lastUsed: 2, empty: 8 });
    expect(saveNamedBatch("Holiday sale").replaced).toBe(false);
    clear();
    const found = savedBatchMatches("holiday");
    expect(found.map((x) => x.name)).toEqual(["Holiday sale"]);
    writeBatch(found[0]!.batch);
    expect(readBatch().items.map((x) => x.collection)).toEqual(["Falcon", "Tidepool"]);
    expect(listSavedBatches().map((x) => x.name)).toContain("Holiday sale");
  });
  it("writes a calibration page and runs pre-print checks", async () => {
    expect(Buffer.from(await renderCalibration()).subarray(0, 5).toString()).toBe("%PDF-");
    add({ brand: "orbital", collection: "Deep Field Chronograph Extraordinaire Edition", percent: 50 });
    const ws = await codes();
    const orbital = ws.find((w) => w.code === "logo-background" && w.brandId === "orbital");
    expect(orbital).toMatchObject({ level: "info" });
    expect(orbital!.message).toContain("white background");
    const row = readBatch().items.length - 1;
    expect(ws.some((w) => w.items.includes(row) && ["auto-abbrev", "small-text", "spill"].includes(w.code))).toBe(true);
  });
  it("removes a logo background and restores it", async () => {
    expect((await logoInfo("orbital"))!.background).toBe("white");
    const info = await removeLogoBackground("orbital");
    expect(info).toMatchObject({ background: "transparent", hasOriginal: true });
    expect((await logoInfo("orbital"))!.background).toBe("transparent");
    await restoreLogo("orbital");
    expect(await logoInfo("orbital")).toMatchObject({ background: "white", hasOriginal: false });
  });
  it("edits, duplicates, exports and re-imports templates", async () => {
    clear();
    expect(tpl("percent")).toBeDefined();
    const t = tpl("percent");
    saveTemplate({ ...t, objects: t.objects.map((o) => (o.id === "offer" ? { ...o, size: 34 } : o.id === "footer" ? { ...o, weight: "regular" } : o)) as Template["objects"] });
    expect(textObj(tpl("percent"), "offer").size).toBe(34);
    expect(textObj(tpl("percent"), "footer").weight).toBe("regular");
    expect(() => edit("percent", "offer", { weight: "italic" as "bold" })).toThrow(/bold|regular/);
    expect(textObj(tpl("percent"), "offer").weight).toBe("bold"); // the refused edit changed nothing
    expect(duplicateTemplate("bogo", "Holiday BOGO").id).toBe("holiday-bogo");
    const sign = add({ template: "holiday", brand: "orbital", collection: "Comet", percent: 50 }).items.at(-1)!;
    expect(sign.templateId).toBe("holiday-bogo");
    edit("holiday-bogo", "offer", { size: 26 });
    edit("holiday-bogo", "static-1", { text: "TREAT ONE" });
    const file = path.join(data, "set.signsnip.json");
    const set = exportTemplateSet(["percent", "holiday-bogo"], "My set");
    expect(set.templates.map((x) => x.id)).toEqual(["percent", "holiday-bogo"]);
    fs.writeFileSync(file, JSON.stringify(set, null, 2));
    const fromFile = () => parseTemplateSet(JSON.parse(fs.readFileSync(file, "utf8")));
    // change mine, then import: the differing one is kept as a copy, re-import adds nothing more
    edit("holiday-bogo", "offer", { size: 20 });
    expect(importTemplateSet(fromFile()).renamed).toEqual([{ from: "holiday-bogo", to: "holiday-bogo-imported" }]);
    const again = importTemplateSet(fromFile());
    expect(again.renamed).toEqual([]);
    expect(again.added).toEqual([]);
    expect(importTemplateSet(fromFile(), "replace").replaced).toContain("holiday-bogo");
    expect(textObj(tpl("holiday-bogo"), "offer").size).toBe(26);
    expect(textObj(tpl("holiday-bogo"), "static-1").text).toBe("TREAT ONE");
    expect((await exportBatch()).pages).toBe(1);
    expect(() => deleteTemplate("percent")).toThrow("built in");
    resetTemplate("percent");
    expect(textObj(tpl("percent"), "offer").size).toBe(30);
    expect(() => parseTemplateSet({ hello: 1 })).toThrow("isn't a SignSnip template set");
  });
  it("readable-minimum rules: abbreviations and fallback template", async () => {
    clear();
    expect(readRules().readableMin).toBe(10);
    writeRules({ ...readRules(), readableMin: 12 });
    add({ brand: "orbital", collection: "Field Master Automatic Moonphase", percent: 50 });
    const small = (await codes()).filter((w) => w.code === "small-text");
    expect(small.map((w) => w.message).join("\n")).toContain("below your 12pt readable minimum");
    saveTemplate({ ...tpl("percent"), fallbackId: "percent-long" });
    const ws = await codes();
    expect(ws.find((w) => w.code === "auto-template")!.message).toContain("prints with “Percent off · long name”");
    expect(ws.filter((w) => w.code === "small-text")).toEqual([]); // what export --strict / the print gate look at
    saveTemplate({ ...tpl("percent"), fallbackId: undefined });
    writeRules({ ...readRules(), abbreviations: [...readRules().abbreviations, { from: "Moonphase", to: "Moon" }, { from: "Automatic", to: "Auto" }] });
    expect((await codes()).find((w) => w.code === "auto-abbrev")!.message).toMatch(/shortened to fit .*(Moonphase → Moon|Automatic → Auto)/);
    writeRules({ ...readRules(), abbreviations: readRules().abbreviations.filter((a) => a.from.toLowerCase() !== "moonphase") });
    expect(readRules().abbreviations.map((a) => a.from)).not.toContain("Moonphase");
    writeRules({ ...readRules(), readableMin: 10 }); clear();
  });
  it("edge cases from the QA sweep give clear answers", async () => {
    clear();
    // a partial brand name that matches several brands is refused, not silently guessed
    expect(() => buildSign({ brand: "a", percent: 50 })).toThrow("matches several brands");
    add({ brand: "kestrel", collection: "P", price: 300, wasPrice: 200 });
    add({ brand: "kestrel", collection: "Q", price: 100 });
    expect((await codes()).find((w) => w.code === "was-price")!.message).toContain("isn't higher than the sale price");
    expect(() => csvToSigns('brand,collection,percent\nnorthwind,"Open,50\n')).toThrow("never closed");
    expect(() => csvToSigns("brand,collection\nnorthwind,X\n")).toThrow("needs a percent or price value");
    expect(() => saveTemplate({ ...tpl("bogo"), name: "" })).toThrow(/name/);
    // deleting a template clears fallbacks that pointed at it
    const copy = duplicateTemplate("percent", "Long copy");
    saveTemplate({ ...tpl("percent"), fallbackId: copy.id });
    deleteTemplate(copy.id);
    expect(tpl("percent").fallbackId).toBeUndefined();
    expect(saveNamedBatch("Twice").replaced).toBe(false);
    expect(saveNamedBatch("Twice").replaced).toBe(true);
    clear();
  });
  it("refuses an empty logo and won't erase a solid-colour logo", async () => {
    const blank = await sharp({ create: { width: 200, height: 80, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    const solid = await sharp({ create: { width: 200, height: 80, channels: 4, background: { r: 10, g: 20, b: 120, alpha: 1 } } }).png().toBuffer();
    await expect(saveLogo("lumen-atelier", blank)).rejects.toThrow("empty");
    await saveLogo("lumen-atelier", solid);
    await expect(removeLogoBackground("lumen-atelier")).rejects.toThrow("erase the whole logo");
  });
  it("caps a batch at 20 pages (copies count) but lets an over-limit batch shrink", async () => {
    clear();
    const rows = ["brand,collection,percent,copies", ...Array.from({ length: 20 }, (_, i) => `orbital,Line ${i},${10 + i},10`)];
    expect(addToBatch(csvToSigns(rows.join("\n"))).items).toHaveLength(20); // exactly 200 signs = 20 pages
    expect(() => add({ brand: "orbital", percent: 5 })).toThrow("The limit is 20 pages, 200 signs");
    const b = readBatch();
    expect(() => writeBatch({ ...b, items: b.items.map((s, i) => (i === 0 ? { ...s, copies: 11 } : s)) })).toThrow("21 pages");
    expect(await exportBatch()).toMatchObject({ pages: 20, signs: 200 });
    expect(writeBatch({ ...b, items: b.items.slice(1) }).items).toHaveLength(19); // shrinking is always allowed
    clear();
  });
  it("backs up and restores the whole workspace, and starts over from scratch or samples", async () => {
    const file = path.join(data, "ws.signsnip-backup.json");
    writeRules({ ...readRules(), abbreviations: [...readRules().abbreviations, { from: "Moonphase", to: "Moon" }] });
    duplicateTemplate("bogo", "Backup check");
    clear(); add({ brand: "orbital", collection: "Round trip", percent: 33 });
    const ws = exportWorkspace();
    fs.writeFileSync(file, JSON.stringify(ws));
    const sum = summarizeWorkspace(ws);
    expect(sum.brands).toBeGreaterThan(0);
    expect(sum.logos).toBeGreaterThan(0);
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(saved.format).toBe("signsnip/workspace");
    expect(Object.keys(saved.logos).length).toBeGreaterThan(0);
    // refuses a template set
    const setFile = path.join(data, "set.json");
    fs.writeFileSync(setFile, JSON.stringify(exportTemplateSet()));
    expect(() => restoreWorkspace(JSON.parse(fs.readFileSync(setFile, "utf8")))).toThrow("template set, not a full backup");
    expect(readBatch().items.map((s) => s.collection)).toEqual(["Round trip"]); // the refusal touched nothing
    // scratch really is empty
    startFromScratch();
    expect(listBrands()).toEqual([]);
    expect(listTemplates().map((t) => t.name)).not.toContain("Backup check");
    // restore brings everything back, logos included
    expect(restoreWorkspace(JSON.parse(fs.readFileSync(file, "utf8")))).toMatchObject({ brands: sum.brands, logos: sum.logos });
    expect(readBatch().items.map((s) => s.collection)).toContain("Round trip");
    expect(readRules().abbreviations).toContainEqual({ from: "Moonphase", to: "Moon" });
    expect(listTemplates().map((t) => t.name)).toContain("Backup check");
    expect((await exportBatch()).pages).toBe(1);
    expect((await codes()).filter((w) => w.code === "no-logo")).toEqual([]);
    // files made before the rename still restore / import
    expect(() => restoreWorkspace(json({ ...saved, format: "sign-o-matic/workspace" }))).not.toThrow();
    const set = JSON.parse(fs.readFileSync(setFile, "utf8"));
    expect(set.format).toBe("signsnip/template-set");
    expect(() => importTemplateSet(parseTemplateSet(json({ ...set, format: "sign-o-matic/template-set" })))).not.toThrow();
    expect(parseWorkspace(json({ ...saved, format: "sign-o-matic/workspace" })).brands).toHaveLength(sum.brands);
    // samples: made-up brands + a small batch
    startWithSamples(await seedSamples());
    expect(listBrands()).toHaveLength(5);
    expect(readBatch().items).toHaveLength(5);
    // put the original data back for the remaining tests
    restoreWorkspace(JSON.parse(fs.readFileSync(file, "utf8"))); clear();
  });
  it("accepts a JPG logo and fits it", async () => {
    const br = await addBrand({ name: "Test Co", collections: ["A", "B"] }, fs.readFileSync(path.join(root, "tests/fixtures/orbital.jpg")));
    expect(br).toMatchObject({ id: "test-co", created: true, hasLogo: true, collections: ["A", "B"] });
    expect(fs.existsSync(path.join(data, "logos/test-co.png"))).toBe(true);
    expect((await logoInfo("test-co"))!.width).toBeGreaterThan(0);
  });
});
