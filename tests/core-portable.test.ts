import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MemoryRepo, setRepo } from "../src/core/repo";
import { fromBase64, removeBackground, toBase64, trimRaster } from "../src/core/images";

/** The hosted build runs src/core in the browser, so only the Node wiring may touch Node APIs. */
const NODE_ONLY = new Set(["node.ts", "repo-fs.ts", "paths.ts"]);
const dir = path.resolve(__dirname, "../src/core");

describe("core is browser-safe", () => {
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".ts") && !NODE_ONLY.has(n))) {
    it(`${f} uses no Node-only modules`, () => {
      const src = fs.readFileSync(path.join(dir, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, ""); // code only
      expect(src).not.toMatch(/from "node:|from "(fs|path|sharp|crypto|os)"|require\(|\bBuffer\b|process\./);
      for (const m of src.matchAll(/from "\.\/([\w-]+)\.js"/g)) expect(NODE_ONLY.has(`${m[1]}.ts`), `${f} imports ${m[1]}`).toBe(false);
    });
  }
});

describe("store logic on in-memory storage (what the browser uses)", () => {
  it("brands, templates, rules and the page cap work without a disk", async () => {
    setRepo(new MemoryRepo());
    const store = await import("../src/core/store");
    store.upsertBrand({ name: "Memory Co" });
    expect(store.listBrands().map((b) => b.id)).toEqual(["memory-co"]);
    expect(store.listTemplates().some((t) => t.id === "percent")).toBe(true);
    store.writeRules({ readableMin: 11, abbreviations: [{ from: "A", to: "b" }, { from: "a", to: "c" }] });
    expect(store.readRules().abbreviations).toEqual([{ from: "a", to: "c" }]);
    const sign = { id: "x", brandId: "memory-co", kind: "percent" as const, templateId: "percent", prefix: "", collection: "C", percent: 10, offLabel: "OFF", priceLabel: "", footer: "", copies: 200 };
    store.writeBatch({ items: [sign], options: { grid: "landscape-5x2", paper: "letter", cutMarks: true } });
    expect(() => store.writeBatch({ items: [sign, { ...sign, id: "y", copies: 1 }], options: { grid: "landscape-5x2", paper: "letter", cutMarks: true } })).toThrow(/limit is 20 pages/);
  });
});

describe("pixel helpers", () => {
  it("base64 round-trips every length", () => {
    for (const n of [0, 1, 2, 3, 4, 5, 255, 1000]) {
      const b = Uint8Array.from({ length: n }, (_, i) => (i * 37) % 256);
      expect(Array.from(fromBase64(toBase64(b)))).toEqual(Array.from(b));
    }
    expect(toBase64(new TextEncoder().encode("Man"))).toBe("TWFu");
  });
  it("trims a uniform border and removes a white background", () => {
    const w = 10, h = 6, data = new Uint8Array(w * h * 4).fill(255);
    for (let y = 2; y < 4; y++) for (let x = 3; x < 7; x++) data.set([20, 30, 200, 255], (y * w + x) * 4);
    const t = trimRaster({ data, width: w, height: h }, 12);
    expect([t.width, t.height]).toEqual([4, 2]);
    const cleared = removeBackground({ data, width: w, height: h });
    expect([cleared.width, cleared.height]).toEqual([4, 2]);
    expect(cleared.data[3]).toBe(255);
  });
});
