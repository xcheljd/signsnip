import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..");
const bin = path.join(root, "bin/signo.mjs");
let data: string;
const signo = (...a: string[]) => spawnSync(process.execPath, [bin, ...a], { env: { ...process.env, SIGNO_DATA: data }, encoding: "utf8" });

beforeAll(() => { data = fs.mkdtempSync(path.join(os.tmpdir(), "signo-")); });

describe("signo CLI end-to-end (isolated data dir)", () => {
  it("lists the seeded fake brands", () => {
    const r = signo("brands");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Northwind Watch Co.");
  });
  it("adds signs, then exports a valid 1-page PDF", () => {
    expect(signo("add", "--brand", "northwind", "--collection", "Harbor Line", "--percent", "50", "--copies", "3").status).toBe(0);
    expect(signo("add", "--brand", "orbital", "--collection", "Deep Field Chronograph", "--percent", "80%", "--copies", "2").status).toBe(0);
    const out = path.join(data, "o.pdf");
    const r = signo("export", "-o", out);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("5 signs, 1 page");
    const pdf = fs.readFileSync(out);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  });
  it("spills onto a second page after 10 signs", () => {
    signo("add", "--brand", "tidemark", "--collection", "Tidepool", "--percent", "40", "--copies", "6");
    expect(signo("export", "-o", path.join(data, "p.pdf")).stdout).toContain("11 signs, 2 pages");
  });
  it("imports CSV rows and rejects bad input with a clear error", () => {
    const csv = path.join(data, "in.csv");
    fs.writeFileSync(csv, 'brand,collection,percent,copies\nlumen,Dusk,30,2\n"Kestrel & Vale","Field Master, Auto",60,1\n');
    expect(signo("import", csv).status).toBe(0);
    const bad = signo("add", "--brand", "nope", "--percent", "50");
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain('No brand matching "nope"');
    expect(signo("add", "--brand", "northwind", "--percent", "150").status).toBe(1);
  });
  it("makes price signs, bulk-edits rows, fills the page, saves and reloads a batch", () => {
    signo("clear");
    expect(signo("add", "--brand", "kestrel", "--collection", "Falcon", "--price", "$1,295", "--was", "1595", "--price-label", "now").status).toBe(0);
    expect(signo("batch").stdout).toContain("NOW $1,295 (was $1,595)");
    signo("add", "--brand", "tidemark", "--collection", "Tidepool", "--percent", "40");
    expect(signo("bulk", "--rows", "2", "--percent", "60").stdout).toContain("updated 1 row");
    expect(signo("batch").stdout).toMatch(/2\. tidemark .*60% OFF\*/);
    expect(signo("batch").stdout).toContain("8 empty");
    expect(signo("fill").stdout).toContain("added 8 copies");
    expect(signo("batch").stdout).toContain("10 signs · 1 page");
    expect(signo("save", "Holiday sale").status).toBe(0);
    signo("clear");
    expect(signo("load", "holiday").stdout).toContain('loaded "Holiday sale" (2 rows)');
    expect(signo("batches").stdout).toContain("Holiday sale");
    const bad = signo("bulk", "--rows", "9", "--percent", "10");
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain("out of range");
  });
  it("writes a calibration page and runs pre-print checks", () => {
    const out = path.join(data, "cal.pdf");
    expect(signo("calibrate", "-o", out).status).toBe(0);
    expect(fs.readFileSync(out).subarray(0, 5).toString()).toBe("%PDF-");
    signo("add", "--brand", "orbital", "--collection", "Deep Field Chronograph Extraordinaire Edition", "--percent", "50");
    const r = signo("check");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("white background");
    expect(r.stdout).toMatch(/shrink to fit|doesn't fit its box/);
  });
  it("removes a logo background and restores it", () => {
    expect(signo("brands", "fix-bg", "orbital").stdout).toContain("now transparent");
    expect(signo("brands").stdout).not.toMatch(/ORBITAL.*white bg/);
    expect(signo("brands", "restore", "orbital").status).toBe(0);
    expect(signo("brands").stdout).toMatch(/ORBITAL.*white bg/);
  });
  it("edits, duplicates, exports and re-imports templates", () => {
    signo("clear");
    expect(signo("templates").stdout).toMatch(/percent .*built-in/);
    const set = signo("templates", "set", "percent", "offer.size=34", "footer.weight=regular");
    expect(set.status).toBe(0);
    expect(signo("templates", "show", "percent").stdout).toMatch(/offer .*34pt .*\n.*footer .*regular/);
    expect(signo("templates", "set", "percent", "offer.weight=italic").stderr).toContain("bold, regular");
    expect(signo("templates", "duplicate", "bogo", "Holiday BOGO").stdout).toContain("holiday-bogo");
    expect(signo("add", "--template", "holiday", "--brand", "orbital", "--collection", "Comet", "--percent", "50").stdout).toContain("[Holiday BOGO]");
    signo("templates", "set", "holiday-bogo", "offer.size=26", "static-1.text=TREAT ONE");
    const file = path.join(data, "set.signo.json");
    expect(signo("templates", "export", "percent", "holiday-bogo", "--name", "My set", "-o", file).stdout).toContain("2 templates");
    // change mine, then import: differing one is kept as a copy, re-import adds nothing more
    signo("templates", "set", "holiday-bogo", "offer.size=20");
    expect(signo("templates", "import", file).stdout).toContain("holiday-bogo → holiday-bogo-imported");
    expect(signo("templates", "import", file).stdout).not.toContain("→");
    expect(signo("templates", "import", file, "--replace").stdout).toContain("replaced holiday-bogo");
    expect(signo("templates", "show", "holiday-bogo").stdout).toContain("26pt");
    expect(signo("templates", "show", "holiday-bogo").stdout).toContain('"TREAT ONE"');
    expect(signo("export", "-o", path.join(data, "t.pdf")).status).toBe(0);
    expect(signo("templates", "rm", "percent").stderr).toContain("built in");
    expect(signo("templates", "reset", "percent").status).toBe(0);
    expect(signo("templates", "show", "percent").stdout).toMatch(/offer .*30pt/);
    fs.writeFileSync(path.join(data, "bad.json"), '{"hello":1}');
    expect(signo("templates", "import", path.join(data, "bad.json")).stderr).toContain("isn't a Sign-O-Matic template set");
  });
  it("accepts a JPG logo and fits it", () => {
    const r = signo("brands", "add", "Test Co", "--logo", path.join(root, "tests/fixtures/orbital.jpg"), "--collections", "A,B");
    expect(r.status).toBe(0);
    expect(fs.existsSync(path.join(data, "logos/test-co.png"))).toBe(true);
  });
});
