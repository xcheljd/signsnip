import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import { addToBatch, buildSign } from "../src/core/batch";
import { checkSigns, expandCopies, renderPdf } from "../src/core/pdf";
import {
  deleteTemplate, duplicateTemplate, exportTemplateSet, importTemplateSet, listBrands, listTemplates, parseTemplateSet,
  readBatch, saveBackground, saveTemplate, writeBatch,
} from "../src/core/store";
import { backgroundRect } from "../src/core/template";
import { SIGN_H_MM, SIGN_W_MM, type Template } from "../src/core/types";
import { exportWorkspace, restoreWorkspace } from "../src/core/workspace";
import { assertSafeRepo, tmpWorkspace, useNodeWorkspace } from "./helpers";

let pic: string, clear: string;
const bgFiles = (dir: string) => (fs.existsSync(path.join(dir, "backgrounds")) ? fs.readdirSync(path.join(dir, "backgrounds")) : []);
const images = (pdf: Buffer) => (pdf.toString("latin1").match(/\/Subtype\s*\/Image/g) ?? []).length;

beforeAll(async () => {
  const data = tmpWorkspace("signsnip-bg-pics-");
  // a made-up wide stripe pattern (a "photo": opaque, so it's stored as JPEG)
  const w = 2400, h = 1200, raw = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 3, on = ((x + y) >> 6) & 1; raw[i] = on ? 40 : 220; raw[i + 1] = 120; raw[i + 2] = on ? 200 : 60; }
  pic = path.join(data, "stripes.png");
  await sharp(raw, { raw: { width: w, height: h, channels: 3 } }).png().toFile(pic);
  clear = path.join(data, "clear.png");
  await sharp({ create: { width: 50, height: 50, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toFile(clear);
});

describe("backgroundRect", () => {
  it("cover fills the sign (crops the long side), contain shows it all", () => {
    const wide = backgroundRect({ aspect: 2, fit: "cover" });
    expect(wide.h).toBeCloseTo(SIGN_H_MM);
    expect(wide.w).toBeGreaterThan(SIGN_W_MM);
    expect(wide.x + wide.w / 2).toBeCloseTo(SIGN_W_MM / 2);
    const fit = backgroundRect({ aspect: 2, fit: "contain" });
    expect(fit.w).toBeCloseTo(SIGN_W_MM);
    expect(fit.h).toBeLessThan(SIGN_H_MM);
    const tall = backgroundRect({ aspect: 0.3, fit: "cover" });
    expect(tall.w).toBeCloseTo(SIGN_W_MM);
    expect(tall.h).toBeGreaterThan(SIGN_H_MM);
  });
});

describe("template background pictures (core end-to-end)", () => {
  let ws: string, ws2: string, picBytes: Buffer, clearBytes: Buffer;
  beforeAll(async () => {
    ws = await useNodeWorkspace(tmpWorkspace("signsnip-bgc-"));
    ws2 = tmpWorkspace("signsnip-bgc2-");
    assertSafeRepo();
    picBytes = fs.readFileSync(pic); clearBytes = fs.readFileSync(clear);
  });
  const tpl = (id: string) => listTemplates().find((t) => t.id === id)!;
  const setBg = (id: string, bg: Partial<NonNullable<Template["background"]>> | undefined) => {
    const t = tpl(id);
    return saveTemplate({ ...t, background: bg && ({ ...t.background, ...bg } as Template["background"]) });
  };
  const exportBatch = async () => { const b = readBatch(); return (await renderPdf(expandCopies(b.items), b.options, "sheet")).bytes; };

  it("adds a picture, stores it shrunk as JPEG, and the PDF draws it once per picture", async () => {
    writeBatch({ ...readBatch(), items: [] });
    addToBatch([buildSign({ brand: "northwind", collection: "Harbor Line", percent: 50, copies: 4 })]);
    const before = images(Buffer.from(await exportBatch()));
    const { image, aspect } = await saveBackground(picBytes);
    expect(aspect).toBeCloseTo(2, 1);
    setBg("percent", { image, aspect, fit: "cover", opacity: 0.3 });
    expect(tpl("percent").background).toMatchObject({ image, fit: "cover", opacity: 0.3 });
    const files = bgFiles(ws);
    expect(files).toHaveLength(1);
    const stored = fs.readFileSync(path.join(ws, "backgrounds", files[0]!));
    expect([stored[0], stored[1]]).toEqual([0xff, 0xd8]); // JPEG
    expect(stored.length).toBeLessThan(600_000);
    const pdfFile = path.join(ws, "b.pdf");
    fs.writeFileSync(pdfFile, await exportBatch());
    expect(images(fs.readFileSync(pdfFile))).toBe(before + 1); // 4 signs, one embedded picture
    // drawn at 30% strength: render it and check the dark stripes print light
    const png = path.join(ws, "b");
    expect(spawnSync("pdftoppm", ["-r", "50", "-f", "1", "-l", "1", "-png", "-singlefile", pdfFile, png]).status).toBe(0);
    const { data: px, info } = await sharp(`${png}.png`).raw().toBuffer({ resolveWithObject: true });
    const red = (xmm: number, ymm: number) => px[(Math.round(ymm * 50 / 25.4) * info.width + Math.round(xmm * 50 / 25.4)) * info.channels]!;
    let darkest = 255;
    // a strip down the first sign's empty left margin (grid starts at 22.2 mm, 37.95 mm on landscape letter)
    for (let y = 42; y < 104; y += 0.5) darkest = Math.min(darkest, red(23.6, y));
    expect(darkest).toBeGreaterThan(150); // 30% of a dark stripe on white
    expect(darkest).toBeLessThan(235); // ...but the picture is there
  });
  it("changes fit and strength, refuses bad values", async () => {
    expect(setBg("percent", { fit: "contain", opacity: 0.6 }).background).toMatchObject({ fit: "contain", opacity: 0.6 });
    expect(() => setBg("percent", { fit: "stretch" as "cover" })).toThrow(/cover|contain/);
    expect(() => setBg("percent", { opacity: 1.5 })).toThrow(/opacity/);
    expect(() => setBg("percent", { opacity: 0.01 })).toThrow(/opacity/);
    expect(tpl("percent").background).toMatchObject({ fit: "contain", opacity: 0.6 }); // refusals changed nothing
    await expect(saveBackground(clearBytes)).rejects.toThrow("empty");
    setBg("percent", { fit: "cover", opacity: 0.25 });
  });
  it("travels in backups and template sets, into a fresh workspace", async () => {
    const backup = JSON.parse(JSON.stringify(exportWorkspace()));
    expect(Object.keys(backup.backgrounds)).toHaveLength(1);
    const set = JSON.parse(JSON.stringify(exportTemplateSet(["percent"])));
    await useNodeWorkspace(ws2);
    restoreWorkspace(backup);
    expect(tpl("percent").background).toMatchObject({ opacity: 0.25 });
    expect(bgFiles(ws2)).toHaveLength(1);
    const fresh = await useNodeWorkspace(tmpWorkspace("signsnip-bgc3-"));
    expect(listBrands().length).toBeGreaterThan(0); // seeded
    expect(importTemplateSet(parseTemplateSet(set), "replace").replaced).toEqual(["percent"]);
    expect(tpl("percent").background).toMatchObject({ opacity: 0.25 });
    expect(bgFiles(fresh)).toHaveLength(1);
    await useNodeWorkspace(ws); // back to the first workspace for the rest
  });
  it("a logo's white box becomes a warning once the sign has a background", async () => {
    addToBatch([buildSign({ brand: "orbital", collection: "Deep Field", percent: 40 })]);
    const w = (await checkSigns(readBatch().items)).find((x) => x.code === "logo-background" && x.brandId === "orbital");
    expect(w).toMatchObject({ level: "warn" });
    expect(w!.message).toContain("ORBITAL's logo has a white box behind it, which prints as a white rectangle over the background picture");
  });
  it("removing it (or resetting the template) deletes the unused picture", () => {
    duplicateTemplate("percent", "Holiday");
    setBg("percent", undefined);
    expect(bgFiles(ws)).toHaveLength(1); // the copy still uses it
    deleteTemplate("holiday");
    expect(bgFiles(ws)).toHaveLength(0);
    expect(tpl("percent").background).toBeUndefined();
  });
});
