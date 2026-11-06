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
    expect(r.stdout).toMatch(/shortened to fit|readable minimum|doesn't fit its box/);
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
  it("readable-minimum rules: abbreviations, fallback template, strict export", () => {
    signo("clear");
    expect(signo("rules").stdout).toContain("readable minimum: 10pt");
    expect(signo("rules", "min", "12").status).toBe(0);
    signo("add", "--brand", "orbital", "--collection", "Field Master Automatic Moonphase", "--percent", "50");
    expect(signo("check").stdout).toContain("below your 12pt readable minimum");
    expect(signo("export", "--strict", "-o", path.join(data, "s.pdf")).status).toBe(1);
    expect(signo("templates", "fallback", "percent", "price").stderr).toContain("same kind");
    expect(signo("templates", "fallback", "percent", "percent-long").status).toBe(0);
    expect(signo("templates", "show", "percent").stdout).toContain('too small → "Percent off · long name"');
    const r = signo("check").stdout;
    expect(r).toContain("prints with “Percent off · long name”");
    expect(r).not.toContain("readable minimum.");
    expect(signo("export", "--strict", "-o", path.join(data, "s.pdf")).status).toBe(0);
    signo("templates", "fallback", "percent", "none");
    expect(signo("rules", "abbr", "Moonphase", "Moon").status).toBe(0);
    expect(signo("rules", "abbr", "Automatic", "Auto").status).toBe(0);
    expect(signo("check").stdout).toMatch(/shortened to fit .*(Moonphase → Moon|Automatic → Auto)/);
    expect(signo("rules", "abbr-rm", "moonphase").status).toBe(0);
    expect(signo("rules").stdout).not.toContain("Moonphase");
    signo("rules", "min", "10"); signo("clear");
  });
  it("edge cases from the QA sweep give clear answers", () => {
    signo("clear");
    // a partial brand name that matches several brands is refused, not silently guessed
    const amb = signo("add", "--brand", "a", "--percent", "50");
    expect(amb.status).toBe(1);
    expect(amb.stderr).toContain("matches several brands");
    signo("add", "--brand", "kestrel", "--collection", "P", "--price", "300", "--was", "200");
    signo("add", "--brand", "kestrel", "--collection", "Q", "--price", "100");
    expect(signo("check").stdout).toContain("isn't higher than the sale price");
    expect(signo("bulk", "--rows", "2-1", "--percent", "10").stderr).toContain("runs backwards");
    fs.writeFileSync(path.join(data, "q.csv"), 'brand,collection,percent\nnorthwind,"Open,50\n');
    expect(signo("import", path.join(data, "q.csv")).stderr).toContain("never closed");
    fs.writeFileSync(path.join(data, "n.csv"), "brand,collection\nnorthwind,X\n");
    expect(signo("import", path.join(data, "n.csv")).stderr).toContain("needs a percent or price value");
    expect(signo("import", path.join(data, "missing.csv")).stderr).toContain("can't find");
    expect(signo("templates", "rename", "bogo", "").stderr).toMatch(/name: .*>=1|Too small/);
    // deleting a template clears fallbacks that pointed at it
    signo("templates", "duplicate", "percent", "Long copy");
    signo("templates", "fallback", "percent", "long-copy");
    signo("templates", "rm", "long-copy");
    expect(signo("templates", "show", "percent").stdout).not.toContain("too small →");
    expect(signo("save", "Twice").stdout).not.toContain("replaced");
    expect(signo("save", "Twice").stdout).toContain("replaced the earlier batch");
    signo("clear");
  });
  it("refuses an empty logo and won't erase a solid-colour logo", async () => {
    const sharp = (await import("sharp")).default;
    const blank = path.join(data, "blank.png"), solid = path.join(data, "solid.png");
    await sharp({ create: { width: 200, height: 80, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toFile(blank);
    await sharp({ create: { width: 200, height: 80, channels: 4, background: { r: 10, g: 20, b: 120, alpha: 1 } } }).png().toFile(solid);
    expect(signo("brands", "logo", "lumen", blank).stderr).toContain("empty");
    expect(signo("brands", "logo", "lumen", solid).status).toBe(0);
    expect(signo("brands", "fix-bg", "lumen").stderr).toContain("erase the whole logo");
  });
  it("caps a batch at 20 pages (copies count) but lets an over-limit batch shrink", () => {
    signo("clear");
    const rows = ["brand,collection,percent,copies", ...Array.from({ length: 20 }, (_, i) => `orbital,Line ${i},${10 + i},10`)];
    fs.writeFileSync(path.join(data, "cap.csv"), rows.join("\n"));
    expect(signo("import", path.join(data, "cap.csv")).status).toBe(0); // exactly 200 signs = 20 pages
    const more = signo("add", "--brand", "orbital", "--percent", "5");
    expect(more.status).toBe(1);
    expect(more.stderr).toContain("The limit is 20 pages, 200 signs");
    expect(signo("bulk", "--rows", "1", "--copies", "11").stderr).toContain("21 pages");
    expect(signo("export", "-o", path.join(data, "cap.pdf")).status).toBe(0);
    expect(signo("rm", "1").status).toBe(0); // shrinking is always allowed
    signo("clear");
  });
  it("backs up and restores the whole workspace, and starts over from scratch or samples", () => {
    const file = path.join(data, "ws.signo-backup.json");
    signo("rules", "abbr", "Moonphase", "Moon");
    signo("templates", "duplicate", "bogo", "Backup check");
    signo("clear"); signo("add", "--brand", "orbital", "--collection", "Round trip", "--percent", "33");
    expect(signo("backup", "-o", file).stdout).toMatch(/backed up \d+ brands \(\d+ logos\)/);
    const ws = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(ws.format).toBe("sign-o-matic/workspace");
    expect(Object.keys(ws.logos).length).toBeGreaterThan(0);
    // refuses without --yes, and refuses a template set
    expect(signo("start", "scratch").status).toBe(1);
    expect(signo("restore", file).stderr).toContain("--yes");
    signo("templates", "export", "-o", path.join(data, "set.json"));
    expect(signo("restore", path.join(data, "set.json"), "--yes").stderr).toContain("template set, not a full backup");
    // scratch really is empty
    expect(signo("start", "scratch", "--yes").status).toBe(0);
    expect(signo("brands").stdout).not.toContain("orbital");
    expect(signo("templates").stdout).not.toContain("Backup check");
    // restore brings everything back, logos included
    expect(signo("restore", file, "--yes").stdout).toContain("restored");
    expect(signo("batch").stdout).toContain("Round trip");
    expect(signo("rules").stdout).toContain("Moonphase -> Moon");
    expect(signo("templates").stdout).toContain("Backup check");
    expect(signo("export", "-o", path.join(data, "after-restore.pdf")).status).toBe(0);
    expect(signo("check").stdout).not.toContain("has no logo");
    // samples: made-up brands + a small batch
    expect(signo("start", "samples", "--yes").stdout).toMatch(/started with samples: 5 made-up brands and a 5-row batch/);
    // put the original data back for the remaining tests
    signo("restore", file, "--yes"); signo("clear");
  });
  it("accepts a JPG logo and fits it", () => {
    const r = signo("brands", "add", "Test Co", "--logo", path.join(root, "tests/fixtures/orbital.jpg"), "--collections", "A,B");
    expect(r.status).toBe(0);
    expect(fs.existsSync(path.join(data, "logos/test-co.png"))).toBe(true);
  });
});
