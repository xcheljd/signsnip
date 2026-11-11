import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MemoryRepo, repo, setRepo } from "../src/core/repo";
import { FsRepo } from "../src/core/repo-fs";
import {
  dataProblems, duplicateTemplate, listBrands, listPresets, listSavedBatches, listTemplates, readBatch, readRules, saveNamedBatch, upsertBrand,
} from "../src/core/store";
import { checkWorkspacePictures, exportWorkspace, restoreWorkspace, startFromScratch, startWithSamples, summarizeWorkspace, workspaceMeta, type Workspace } from "../src/core/workspace";
import { assertSafeRepo, seedSamples, startServer, tmpWorkspace, useNodeWorkspace } from "./helpers";

/**
 * A restore replaces everything the user made. It must either finish or leave the workspace
 * exactly as it was: bad backups are refused before anything is deleted, and a write that
 * fails part-way is rolled back.
 */
const JSON_TYPE = { "content-type": "application/json" };
let backup: Workspace;
let pinecrestLogo: Uint8Array;

/** Everything stored, compared by value; exportedAt is the only field that changes between exports. */
const stored = () => { const { exportedAt: _, ...rest } = exportWorkspace(); return { ...rest, meta: workspaceMeta() }; };

/** The "current" workspace a restore would replace: one made-up brand with a logo, a saved batch. */
function currentWorkspace<R extends MemoryRepo>(r: R = new MemoryRepo() as R): R {
  setRepo(r);
  startFromScratch();
  upsertBrand({ name: "Pinecrest", collections: ["Ridge"] });
  repo().setBlob("logos/pinecrest", pinecrestLogo);
  saveNamedBatch("Pinecrest week", { items: [], options: readBatch().options });
  return r;
}

/** A repo whose writes start failing on a chosen key (once, or for good). */
class FailingRepo extends MemoryRepo {
  failed = false;
  constructor(private key: string, private forGood: boolean) { super(); }
  armed = false;
  private check(key: string) {
    if (!this.armed) return;
    if (this.failed && this.forGood) throw new Error("the disk is full");
    if (!this.failed && key === this.key) { this.failed = true; throw new Error("the disk is full"); }
  }
  override setJson(key: string, value: unknown) { this.check(key); super.setJson(key, value); }
  override setBlob(key: string, bytes: Uint8Array) { this.check(key); super.setBlob(key, bytes); }
  override remove(key: string) { if (this.armed && this.failed && this.forGood) throw new Error("the disk is full"); super.remove(key); }
}

beforeAll(async () => {
  await useNodeWorkspace(tmpWorkspace("signsnip-restore-")); // sharp image ops + fonts
  assertSafeRepo();
  pinecrestLogo = new Uint8Array(await sharp({ create: { width: 40, height: 20, channels: 4, background: { r: 20, g: 90, b: 60, alpha: 1 } } }).png().toBuffer());
  // the backup: the fake samples, a saved batch and a copied template
  setRepo(new MemoryRepo());
  startWithSamples(await seedSamples());
  saveNamedBatch("Harbor weekend", readBatch());
  duplicateTemplate("bogo", "Restore check");
  backup = exportWorkspace();
  expect(Object.keys(backup.logos).length).toBeGreaterThan(0);
});

describe("a bad backup is refused before anything is deleted", () => {
  it("duplicate brand ids: refused as damaged, nothing changed", () => {
    currentWorkspace();
    const before = stored();
    const bad = structuredClone(backup);
    bad.brands.push({ ...bad.brands[0]! });
    expect(() => restoreWorkspace(bad)).toThrow(`The backup is damaged: two brands share the id ${bad.brands[0]!.id}`);
    expect(stored()).toEqual(before);
  });
  it("duplicate template, preset and saved-batch ids are refused too", () => {
    currentWorkspace();
    const before = stored();
    const t = structuredClone(backup); t.templates.push({ ...t.templates[0]! });
    expect(() => restoreWorkspace(t)).toThrow("two templates share the id");
    const p = structuredClone(backup); p.presets.push({ ...p.presets[0]! });
    expect(() => restoreWorkspace(p)).toThrow("two presets share the id");
    const s = structuredClone(backup); s.saved.push({ ...s.saved[0]! });
    expect(() => restoreWorkspace(s)).toThrow("two saved batches share the id");
    expect(stored()).toEqual(before);
  });
  it("a logo with a PNG header and garbage after it can't be opened as a picture", async () => {
    const bad = structuredClone(backup);
    const id = Object.keys(bad.logos)[0]!;
    const junk = Buffer.concat([Buffer.from(bad.logos[id]!, "base64").subarray(0, 16), Buffer.from("not really a picture, just some bytes")]);
    bad.logos[id] = junk.toString("base64");
    await expect(checkWorkspacePictures(bad)).rejects.toThrow(`The backup is damaged: the logo for ${id} can't be opened as a picture`);
    await expect(checkWorkspacePictures(backup)).resolves.toBeUndefined();
  });
});

describe("a write that fails part-way is rolled back", () => {
  it("rollback: everything is back as it was, and the error says nothing was changed", () => {
    const r = currentWorkspace(new FailingRepo("templates", false));
    const before = stored();
    const blobs = new Map(r.blobs);
    r.armed = true;
    expect(() => restoreWorkspace(backup)).toThrow("Restore failed and nothing was changed: the disk is full");
    expect(stored()).toEqual(before);
    expect(listBrands().map((b) => b.id)).toEqual(["pinecrest"]);
    expect(r.blobs).toEqual(blobs); // logos byte for byte, nothing from the backup left behind
    expect(listSavedBatches().map((s) => s.name)).toEqual(["Pinecrest week"]);
    expect(workspaceMeta()?.startedFrom).toBe("scratch");
  });
  it("when the rollback fails too, the error says part-way and never 'nothing was changed'", () => {
    const r = currentWorkspace(new FailingRepo("templates", true));
    r.armed = true;
    let message = "";
    try { restoreWorkspace(backup); } catch (e) { message = (e as Error).message; }
    expect(message).toContain("Restore failed part-way: the disk is full");
    expect(message).toContain("Restore your last backup file again once the problem is fixed.");
    expect(message).not.toContain("nothing was changed");
  });
});

describe("the happy path is unchanged", () => {
  it("restores everything and returns the backup's summary", () => {
    currentWorkspace();
    expect(restoreWorkspace(backup)).toEqual(summarizeWorkspace(backup));
    expect(listBrands().map((b) => b.id).sort()).toEqual(backup.brands.map((b) => b.id).sort());
    expect(listBrands().every((b) => b.hasLogo)).toBe(true);
    expect(listTemplates().map((t) => t.name)).toContain("Restore check");
    expect(listSavedBatches().map((s) => s.name)).toEqual(["Harbor weekend"]);
    expect(listPresets()).toHaveLength(backup.presets.length);
    expect(readRules()).toEqual(backup.rules);
    expect(workspaceMeta()?.startedFrom).toBe("backup");
    expect(repo().getBlob("logos/pinecrest")).toBeNull();
  });
});

describe("a damaged data file and a restore (data on disk)", () => {
  it("after a restore no stale problem is reported", () => {
    const dir = tmpWorkspace("signsnip-restore-fs-");
    fs.writeFileSync(path.join(dir, "brands.json"), "{not json");
    setRepo(new FsRepo(dir));
    assertSafeRepo();
    expect(listBrands()).toEqual([]);
    expect(dataProblems().map((p) => p.key)).toEqual(["brands"]);
    restoreWorkspace(backup);
    listBrands(); listPresets(); readBatch(); listTemplates(); readRules(); listSavedBatches(); // what /api/state reads
    expect(dataProblems()).toEqual([]);
    expect(listBrands()).toHaveLength(backup.brands.length);
  });
  it("a failed restore can't put back a file it couldn't read, so it says part-way (a copy is kept aside)", () => {
    const dir = tmpWorkspace("signsnip-restore-fs-");
    fs.writeFileSync(path.join(dir, "brands.json"), "{not json");
    class FailingFs extends FsRepo {
      override setJson(key: string, value: unknown) { if (key === "templates") throw new Error("the disk is full"); super.setJson(key, value); }
    }
    setRepo(new FailingFs(dir));
    assertSafeRepo();
    expect(() => restoreWorkspace(backup)).toThrow("Restore failed part-way: the disk is full");
    expect(fs.readdirSync(path.join(dir, "damaged")).some((f) => /^brands-\d+\.json$/.test(f))).toBe(true);
    listBrands(); listPresets(); readBatch(); listTemplates(); readRules(); listSavedBatches();
    expect(dataProblems()).toEqual([]); // the damaged file is gone from its place; nothing stale is reported
  });
});

describe("the local server checks the pictures before it restores", () => {
  let server: Awaited<ReturnType<typeof startServer>> | undefined, data: string;
  beforeAll(async () => {
    data = tmpWorkspace("signsnip-restore-srv-");
    server = await startServer(data); // starts with the seeded fake brands
  }, 60_000);
  afterAll(async () => { await server?.stop(); });
  it("a damaged picture answers 400 with a plain message and leaves the workspace as it was", async () => {
    const before = JSON.parse((await server!.call("GET", "/api/state")).body);
    const bad = structuredClone(backup);
    bad.brands = bad.brands.map((b) => ({ ...b, name: `${b.name} (from backup)` }));
    const id = Object.keys(bad.logos)[0]!;
    bad.logos[id] = Buffer.concat([Buffer.from(bad.logos[id]!, "base64").subarray(0, 16), Buffer.alloc(64, 7)]).toString("base64");
    const res = await server!.call("POST", "/api/workspace/restore", JSON_TYPE, JSON.stringify(bad));
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body).error).toBe(`The backup is damaged: the logo for ${id} can't be opened as a picture`);
    const after = JSON.parse((await server!.call("GET", "/api/state")).body);
    expect(after).toEqual(before);
    const ok = await server!.call("POST", "/api/workspace/restore", JSON_TYPE, JSON.stringify(backup));
    expect(ok.status, ok.body).toBe(200);
    expect(JSON.parse(ok.body)).toEqual(summarizeWorkspace(backup));
  });
});
