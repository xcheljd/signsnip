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
  it("accepts a JPG logo and fits it", () => {
    const r = signo("brands", "add", "Test Co", "--logo", path.join(root, "tests/fixtures/orbital.jpg"), "--collections", "A,B");
    expect(r.status).toBe(0);
    expect(fs.existsSync(path.join(data, "logos/test-co.png"))).toBe(true);
  });
});
