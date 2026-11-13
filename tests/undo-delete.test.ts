import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MemoryRepo, setRepo } from "../src/core/repo";
import {
  deleteSavedBatch, listPresets, listSavedBatches, restorePreset, restoreSavedBatch, saveNamedBatch, savePresets, upsertPreset,
} from "../src/core/store";
import { DEFAULT_OPTIONS, type Abbreviation, type Batch, type Preset, type SavedBatch } from "../src/core/types";
import { putBack, sameWord } from "../web/src/undoDelete";
import { assertSafeRepo, root, startServer, tmpWorkspace, type Call } from "./helpers";

const sign = (percent: number): Preset["sign"] => ({
  brandId: "northwind", kind: "percent", prefix: "SELECT", collection: "MODELS", percent, offLabel: "OFF*", priceLabel: "", footer: "*MSRP",
});
const batchOf = (n: number): Batch => ({
  items: Array.from({ length: n }, (_, i) => ({ id: `s${i}`, ...sign(10 + i), copies: 1 })), options: DEFAULT_OPTIONS,
});

describe("undo a preset delete (store)", () => {
  beforeEach(() => { setRepo(new MemoryRepo()); assertSafeRepo(); });
  const three: Preset[] = [
    { id: "spring", name: "Spring", sign: sign(10) },
    { id: "50-off-", name: "50% off!", sign: sign(50) }, // an old-style id: must come back as it was
    { id: "clearance", name: "Clearance", sign: sign(70) },
  ];
  it("comes back exactly: same id, name, sign and place; nothing else changes", () => {
    savePresets(three);
    const gone = three[1]!;
    savePresets(three.filter((p) => p.id !== gone.id));
    const back = restorePreset(gone, 1);
    expect(back).toEqual({ ...gone, renamed: false });
    expect(listPresets()).toEqual(three);
  });
  it("first and last places too, and an index past the end goes last", () => {
    savePresets(three.slice(1));
    restorePreset(three[0]!, 0);
    expect(listPresets()).toEqual(three);
    savePresets(three.slice(0, 2));
    restorePreset(three[2]!, 99);
    expect(listPresets()).toEqual(three);
  });
  it("a preset made since under the same name is kept; the deleted one comes back next to it, renamed", () => {
    savePresets(three);
    const gone = three[0]!;
    savePresets(three.slice(1));
    const newer = upsertPreset("spring", sign(25)); // same name, any case: gets the same id back
    expect(newer.id).toBe("spring");
    const back = restorePreset(gone, 0);
    expect(back.renamed).toBe(true);
    expect(back.name).toBe("Spring (2)");
    expect(back.id).toBe("spring-2");
    expect(back.sign).toEqual(gone.sign);
    const all = listPresets();
    expect(all[0]).toEqual({ id: "spring-2", name: "Spring (2)", sign: gone.sign });
    expect(all.find((p) => p.id === "spring")).toEqual({ id: "spring", name: "spring", sign: sign(25) });
    expect(all).toHaveLength(4);
  });
});

describe("undo a saved-batch delete (store)", () => {
  beforeEach(() => { setRepo(new MemoryRepo()); assertSafeRepo(); });
  it("comes back exactly: same id, name, savedAt and contents", () => {
    const s = saveNamedBatch("Holiday sale", batchOf(3));
    const { replaced: _r, ...full } = s;
    deleteSavedBatch(s.id);
    expect(listSavedBatches()).toEqual([]);
    const back = restoreSavedBatch(full);
    expect(back).toEqual({ ...full, renamed: false });
    expect(listSavedBatches()).toEqual([full]);
  });
  it("a batch saved under the same name since is not written over: the deleted one comes back as a copy", () => {
    const old = (({ replaced: _r, ...x }) => x)(saveNamedBatch("Holiday sale", batchOf(3)));
    deleteSavedBatch(old.id);
    const newer = (({ replaced: _r, ...x }) => x)(saveNamedBatch("holiday sale", batchOf(1)));
    expect(newer.id).toBe(old.id); // the name is reused, so the id is too
    const back = restoreSavedBatch(old);
    expect(back.renamed).toBe(true);
    expect(back.name).toBe("Holiday sale (2)");
    expect(back.id).not.toBe(old.id);
    expect(back.savedAt).toBe(old.savedAt);
    expect(back.batch).toEqual(old.batch);
    const list = listSavedBatches();
    expect(list.find((x) => x.id === newer.id)).toEqual(newer); // untouched
    expect(list.find((x) => x.id === back.id)).toEqual((({ renamed: _n, ...x }) => x)(back));
    expect(list).toHaveLength(2);
  });
  it("a file under the id that can't be read still owns it", () => {
    const r = new MemoryRepo(); setRepo(r);
    const old: SavedBatch = { id: "spring", name: "Spring", savedAt: "2026-01-01T00:00:00.000Z", batch: batchOf(1) };
    r.setJson("batches/spring", { nonsense: true });
    const back = restoreSavedBatch(old);
    expect(back.id).not.toBe("spring");
    expect(r.getJson("batches/spring")).toEqual({ nonsense: true });
  });
});

describe("undo an abbreviation removal (putBack)", () => {
  const list: Abbreviation[] = [{ from: "Chronograph", to: "Chrono" }, { from: "Automatic", to: "Auto" }, { from: "Collection", to: "Coll." }];
  it("back in its place", () => {
    const removed = list.filter((_, i) => i !== 1);
    expect(putBack(removed, 1, list[1]!, sameWord)).toEqual(list);
    expect(putBack(list.slice(1), 0, list[0]!, sameWord)).toEqual(list);
    expect(putBack(list.slice(0, 2), 7, list[2]!, sameWord)).toEqual(list);
  });
  it("the same word added again since (any capitals): nothing is put back", () => {
    const again = [list[0]!, { from: "AUTOMATIC", to: "Aut." }, list[2]!];
    expect(putBack(again, 1, list[1]!, sameWord)).toBeNull();
  });
});

describe("the server's restore routes", () => {
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  const call: Call = (...a) => server!.call(...a);
  const json = { "content-type": "application/json" };
  const state = async () => JSON.parse((await call("GET", "/api/state")).body) as { presets: Preset[]; saved: { id: string; name: string; savedAt: string }[] };

  beforeAll(async () => {
    const dir = tmpWorkspace("signsnip-undo-");
    fs.cpSync(path.join(root, "seed"), dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "presets.json"), JSON.stringify([
      { id: "a", name: "A", sign: sign(10) }, { id: "50-off-", name: "50% off!", sign: sign(50) }, { id: "c", name: "C", sign: sign(30) },
    ]));
    server = await startServer(dir);
  }, 60_000);
  afterAll(async () => { await server?.stop(); });

  it("a deleted preset comes back exactly in its place", async () => {
    const before = (await state()).presets;
    const gone = before[1]!;
    expect((await call("DELETE", `/api/presets/${gone.id}`)).status).toBe(200);
    const r = await call("POST", "/api/presets/restore", json, JSON.stringify({ preset: gone, index: 1 }));
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ ...gone, renamed: false });
    expect((await state()).presets).toEqual(before);
  });
  it("refuses a broken preset or index", async () => {
    expect((await call("POST", "/api/presets/restore", json, JSON.stringify({ preset: { id: "x" }, index: 0 }))).status).toBe(400);
    expect((await call("POST", "/api/presets/restore", json, JSON.stringify({ preset: { id: "x", name: "X", sign: sign(5) }, index: -1 }))).status).toBe(400);
  });
  it("a deleted saved batch comes back exactly; a name reused since is kept", async () => {
    const saved = JSON.parse((await call("POST", "/api/batches", json, JSON.stringify({ name: "Friday", batch: batchOf(2) }))).body) as SavedBatch;
    const full = JSON.parse((await call("GET", `/api/batches/${saved.id}`)).body) as SavedBatch;
    expect((await call("DELETE", `/api/batches/${saved.id}`)).status).toBe(200);
    const r = await call("POST", "/api/batches/restore", json, JSON.stringify(full));
    expect(r.status).toBe(200);
    expect(JSON.parse((await call("GET", `/api/batches/${saved.id}`)).body)).toEqual(full);

    // delete again, save a new one under the same name, then undo: both are kept
    await call("DELETE", `/api/batches/${saved.id}`);
    const newer = JSON.parse((await call("POST", "/api/batches", json, JSON.stringify({ name: "Friday", batch: batchOf(1) }))).body) as SavedBatch;
    const r2 = JSON.parse((await call("POST", "/api/batches/restore", json, JSON.stringify(full))).body) as SavedBatch & { renamed: boolean };
    expect(r2).toMatchObject({ renamed: true, name: "Friday (2)", savedAt: full.savedAt, batch: full.batch });
    expect(JSON.parse((await call("GET", `/api/batches/${newer.id}`)).body).batch).toEqual(batchOf(1));
    expect((await state()).saved.map((s) => s.name).sort()).toEqual(["Friday", "Friday (2)"]);
  });
});
