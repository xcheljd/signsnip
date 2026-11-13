import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MemoryRepo, setRepo } from "../src/core/repo";
import { dataProblems, listSavedBatches, readBatch, readRules, saveNamedBatch, writeBatch } from "../src/core/store";
import { DEFAULT_OPTIONS, DEFAULT_RULES } from "../src/core/types";
import { assertSafeRepo, startServer, tmpWorkspace, useNodeWorkspace, type Call } from "./helpers";

/**
 * One damaged data file must not stop the app: the part that can't be read starts empty (or at
 * its default), a copy of the damaged file is kept in data/damaged/ before anything can save
 * over it, and /api/state names the problem. Faults on the computer itself answer 500.
 */
const JSON_TYPE = { "content-type": "application/json" };
const damagedFiles = (data: string) => (fs.existsSync(path.join(data, "damaged")) ? fs.readdirSync(path.join(data, "damaged")) : []);
interface State { brands: unknown[]; saved: { id: string }[]; batch: { items: unknown[] }; problems: { key: string; message: string; keptAt?: string }[] }
const state = async (call: Call) => {
  const r = await call("GET", "/api/state");
  expect(r.status, r.body).toBe(200);
  return JSON.parse(r.body) as State;
};
const savedBatch = (id: string, name: string) => ({ id, name, savedAt: "2026-01-02T03:04:05.000Z", batch: { items: [], options: DEFAULT_OPTIONS } });

describe("a damaged brands file (local server)", () => {
  const BROKEN = "{not json";
  let server: Awaited<ReturnType<typeof startServer>> | undefined, data: string;
  beforeAll(async () => {
    data = tmpWorkspace("signsnip-damaged-");
    fs.writeFileSync(path.join(data, "brands.json"), BROKEN);
    server = await startServer(data);
  }, 60_000);
  afterAll(async () => { await server?.stop(); });

  it("the app still starts: no brands, one problem, and a copy of the damaged file", async () => {
    const s = await state(server!.call);
    expect(s.brands).toEqual([]);
    expect(s.problems).toHaveLength(1);
    expect(s.problems[0]).toMatchObject({ key: "brands" });
    expect(s.problems[0]!.message).toContain("isn't valid JSON");
    const files = damagedFiles(data);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^brands-\d+\.json$/);
    expect(fs.readFileSync(path.join(data, "damaged", files[0]!), "utf8")).toBe(BROKEN);
    expect(s.problems[0]!.keptAt).toBe(path.join(data, "damaged", files[0]!));
  });
  it("polling doesn't make another copy each time", async () => {
    for (let i = 0; i < 3; i++) expect((await state(server!.call)).problems).toHaveLength(1);
    expect(damagedFiles(data)).toHaveLength(1);
  });
});

describe("a damaged saved batch and a damaged current batch (local server)", () => {
  const BROKEN_BATCH = '{"items": [ {"id": "half-writ';
  let server: Awaited<ReturnType<typeof startServer>> | undefined, data: string;
  beforeAll(async () => {
    data = tmpWorkspace("signsnip-damaged-");
    fs.writeFileSync(path.join(data, "brands.json"), "[]"); // a brands file present: the seed isn't copied in
    fs.mkdirSync(path.join(data, "batches"));
    fs.writeFileSync(path.join(data, "batches", "bad.json"), '{"x":1}');
    fs.writeFileSync(path.join(data, "batches", "spring-clearance.json"), JSON.stringify(savedBatch("spring-clearance", "Spring clearance")));
    fs.writeFileSync(path.join(data, "batch.json"), BROKEN_BATCH);
    server = await startServer(data);
  }, 60_000);
  afterAll(async () => { await server?.stop(); });

  it("lists only the saved batch that can be read and names the other one", async () => {
    const s = await state(server!.call);
    expect(s.saved.map((b) => b.id)).toEqual(["spring-clearance"]);
    expect(s.problems.map((p) => p.key).sort()).toEqual(["batch", "batches/bad"]);
    expect(s.batch.items).toEqual([]);
  });
  it("saving a new batch works and the copy of the damaged one survives it", async () => {
    const put = await call("PUT", "/api/batch", JSON_TYPE, JSON.stringify({ items: [], options: { ...DEFAULT_OPTIONS, cutMarks: false } }));
    expect(put.status, put.body).toBe(200);
    expect(JSON.parse(fs.readFileSync(path.join(data, "batch.json"), "utf8")).options.cutMarks).toBe(false);
    const copies = damagedFiles(data).filter((f) => f.startsWith("batch-"));
    expect(copies).toHaveLength(1);
    expect(fs.readFileSync(path.join(data, "damaged", copies[0]!), "utf8")).toBe(BROKEN_BATCH);
    // the batch can be read again, so it is no longer reported; the saved batch still is
    expect((await state(server!.call)).problems.map((p) => p.key)).toEqual(["batches/bad"]);
  });
  const call: Call = (...a) => server!.call(...a);
});

describe("server faults are not blamed on the request", () => {
  let server: Awaited<ReturnType<typeof startServer>> | undefined, data: string;
  beforeAll(async () => {
    data = tmpWorkspace("signsnip-damaged-");
    fs.writeFileSync(path.join(data, "brands.json"), "[]");
    server = await startServer(data);
  }, 60_000);
  afterAll(async () => { await server?.stop(); });

  it("a file the server can't read at all answers 500 with a plain message", async () => {
    // a folder where batch.json should be: reading it fails with EISDIR, a fault on this computer
    fs.mkdirSync(path.join(data, "batch.json"));
    const r = await server!.call("GET", "/api/state");
    expect(r.status, r.body).toBe(500);
    expect(JSON.parse(r.body).error).toBe("SignSnip couldn't read or save its data. Ask whoever set up SignSnip on this computer to have a look.");
    fs.rmdirSync(path.join(data, "batch.json"));
    expect((await server!.call("GET", "/api/state")).status).toBe(200);
  });
  it("a mistake in the request is still 400 with its own message", async () => {
    const r = await server!.call("POST", "/api/brands/no-such-brand/logo", { "content-type": "image/png" }, "x");
    expect(r.status).toBe(400);
    expect(JSON.parse(r.body).error).toBe('Unknown brand "no-such-brand"');
    const bad = await server!.call("POST", "/api/brands", JSON_TYPE, JSON.stringify({ name: "" }));
    expect(bad.status).toBe(400);
  });
});

describe("store on disk: damaged files are kept before anything is saved over them", () => {
  let data: string;
  beforeAll(async () => { data = await useNodeWorkspace(tmpWorkspace("signsnip-damaged-")); assertSafeRepo(); });

  it("a save that comes before any read still keeps a copy of the damaged batch", () => {
    fs.writeFileSync(path.join(data, "brands.json"), "[]");
    fs.writeFileSync(path.join(data, "batch.json"), "{oops");
    writeBatch({ items: [], options: DEFAULT_OPTIONS });
    const copies = damagedFiles(data).filter((f) => f.startsWith("batch-"));
    expect(copies).toHaveLength(1);
    expect(fs.readFileSync(path.join(data, "damaged", copies[0]!), "utf8")).toBe("{oops");
    expect(readBatch().items).toEqual([]);
  });
  it("a saved batch that is deleted or saved again stops being reported", () => {
    fs.mkdirSync(path.join(data, "batches"), { recursive: true });
    fs.writeFileSync(path.join(data, "batches", "gone.json"), "[1,");
    fs.writeFileSync(path.join(data, "batches", "holiday-sale.json"), '{"name": 5}');
    expect(listSavedBatches()).toEqual([]);
    expect(dataProblems().map((p) => p.key).sort()).toEqual(["batches/gone", "batches/holiday-sale"]);
    fs.rmSync(path.join(data, "batches", "gone.json"));
    // saving under the damaged one's name replaces it (its copy is already kept) instead of failing
    expect(saveNamedBatch("Holiday sale", { items: [], options: DEFAULT_OPTIONS })).toMatchObject({ id: "holiday-sale", replaced: true });
    expect(listSavedBatches().map((b) => b.id)).toEqual(["holiday-sale"]);
    expect(dataProblems().filter((p) => p.key.startsWith("batches/"))).toEqual([]);
    expect(damagedFiles(data).filter((f) => f.startsWith("batches-")).sort()).toEqual([
      expect.stringMatching(/^batches-gone-\d+\.json$/), expect.stringMatching(/^batches-holiday-sale-\d+\.json$/),
    ]);
  });
});

describe("store in memory (what the hosted build uses)", () => {
  it("rules that don't fit the format fall back to the defaults, with one problem and no copy claimed", () => {
    const mem = new MemoryRepo();
    setRepo(mem);
    mem.setJson("rules", { readableMin: "big", abbreviations: "none" });
    expect(readRules()).toEqual(DEFAULT_RULES);
    expect(readRules()).toEqual(DEFAULT_RULES);
    const rules = dataProblems().filter((p) => p.key === "rules");
    expect(rules).toHaveLength(1);
    expect(rules[0]!.keptAt).toBeUndefined();
    expect(rules[0]!.message.length).toBeLessThanOrEqual(200);
    // fixed: the problem goes away
    mem.setJson("rules", DEFAULT_RULES);
    expect(readRules()).toEqual(DEFAULT_RULES);
    expect(dataProblems().filter((p) => p.key === "rules")).toEqual([]);
  });
});
