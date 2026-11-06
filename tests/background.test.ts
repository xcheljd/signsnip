import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import { backgroundRect } from "../src/core/template";
import { SIGN_H_MM, SIGN_W_MM } from "../src/core/types";

const root = path.resolve(__dirname, "..");
const bin = path.join(root, "bin/signsnip.mjs");
let data: string, data2: string, pic: string, clear: string;
const run = (dir: string, ...a: string[]) => spawnSync(process.execPath, [bin, ...a], { env: { ...process.env, SIGNSNIP_DATA: dir }, encoding: "utf8" });
const signo = (...a: string[]) => run(data, ...a);
const bgFiles = (dir: string) => (fs.existsSync(path.join(dir, "backgrounds")) ? fs.readdirSync(path.join(dir, "backgrounds")) : []);
const images = (pdf: Buffer) => (pdf.toString("latin1").match(/\/Subtype\s*\/Image/g) ?? []).length;

beforeAll(async () => {
  data = fs.mkdtempSync(path.join(os.tmpdir(), "signsnip-bg-"));
  data2 = fs.mkdtempSync(path.join(os.tmpdir(), "signsnip-bg2-"));
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

describe("template background pictures (CLI end-to-end)", () => {
  it("adds a picture, stores it shrunk as JPEG, and the PDF draws it once per picture", async () => {
    signo("clear");
    signo("add", "--brand", "northwind", "--collection", "Harbor Line", "--percent", "50", "--copies", "4");
    const before = images(fs.readFileSync((signo("export", "-o", path.join(data, "a.pdf")), path.join(data, "a.pdf"))));
    const r = signo("templates", "background", "percent", pic);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("fills the sign at 30% strength");
    expect(signo("templates", "show", "percent").stdout).toMatch(/background +fills the sign · 30% strength/);
    const files = bgFiles(data);
    expect(files).toHaveLength(1);
    const stored = fs.readFileSync(path.join(data, "backgrounds", files[0]!));
    expect([stored[0], stored[1]]).toEqual([0xff, 0xd8]); // JPEG
    expect(stored.length).toBeLessThan(600_000);
    signo("export", "-o", path.join(data, "b.pdf"));
    const pdf = fs.readFileSync(path.join(data, "b.pdf"));
    expect(images(pdf)).toBe(before + 1); // 4 signs, one embedded picture
    // drawn at 30% strength: render it and check the dark stripes print light
    const png = path.join(data, "b");
    expect(spawnSync("pdftoppm", ["-r", "50", "-f", "1", "-l", "1", "-png", "-singlefile", path.join(data, "b.pdf"), png]).status).toBe(0);
    const { data: px, info } = await sharp(`${png}.png`).raw().toBuffer({ resolveWithObject: true });
    const red = (xmm: number, ymm: number) => px[(Math.round(ymm * 50 / 25.4) * info.width + Math.round(xmm * 50 / 25.4)) * info.channels]!;
    let darkest = 255;
    // a strip down the first sign's empty left margin (grid starts at 22.2 mm, 37.95 mm on landscape letter)
    for (let y = 42; y < 104; y += 0.5) darkest = Math.min(darkest, red(23.6, y));
    expect(darkest).toBeGreaterThan(150); // 30% of a dark stripe on white
    expect(darkest).toBeLessThan(235); // ...but the picture is there
  });
  it("changes fit and strength, warns when it's strong, refuses bad values", () => {
    expect(signo("templates", "background", "percent", "--fit", "contain", "--strength", "60").stdout).toContain("shows the whole picture at 60% strength (strong");
    expect(signo("templates", "background", "percent", "--fit", "stretch").stderr).toContain('--fit is "cover"');
    expect(signo("templates", "background", "percent", "--strength", "150").stderr).toContain("5 to 100");
    expect(signo("templates", "background", "percent", clear).stderr).toContain("empty");
    expect(signo("templates", "background", "price").stderr).toContain("usage");
    signo("templates", "background", "percent", "--fit", "cover", "--strength", "25");
  });
  it("travels in backups and template sets, into a fresh workspace", () => {
    const bk = path.join(data, "w.signsnip-backup.json");
    expect(signo("backup", "-o", bk).status).toBe(0);
    expect(Object.keys(JSON.parse(fs.readFileSync(bk, "utf8")).backgrounds)).toHaveLength(1);
    expect(run(data2, "restore", bk, "--yes").status).toBe(0);
    expect(run(data2, "templates", "show", "percent").stdout).toContain("25% strength");
    expect(bgFiles(data2)).toHaveLength(1);
    const set = path.join(data, "s.signsnip.json");
    expect(signo("templates", "export", "percent", "-o", set).status).toBe(0);
    const fresh = fs.mkdtempSync(path.join(os.tmpdir(), "signsnip-bg3-"));
    run(fresh, "brands");
    expect(run(fresh, "templates", "import", set, "--replace").status).toBe(0);
    expect(run(fresh, "templates", "show", "percent").stdout).toContain("25% strength");
    expect(bgFiles(fresh)).toHaveLength(1);
  });
  it("a logo's white box becomes a warning once the sign has a background", () => {
    signo("add", "--brand", "orbital", "--collection", "Deep Field", "--percent", "40");
    const r = signo("check").stdout;
    expect(r).toContain("ORBITAL's logo has a white box behind it, which prints as a white rectangle over the background picture");
  });
  it("removing it (or resetting the template) deletes the unused picture", () => {
    signo("templates", "duplicate", "percent", "Holiday");
    signo("templates", "background", "percent", "none");
    expect(bgFiles(data)).toHaveLength(1); // the copy still uses it
    signo("templates", "rm", "holiday");
    expect(bgFiles(data)).toHaveLength(0);
    expect(signo("templates", "show", "percent").stdout).not.toContain("background");
  });
});
