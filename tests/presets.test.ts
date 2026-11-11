import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MemoryRepo, setRepo } from "../src/core/repo";
import { listPresets, savePresets, upsertPreset } from "../src/core/store";
import type { Preset } from "../src/core/types";
import { assertSafeRepo, root, startServer, tmpWorkspace, type Call } from "./helpers";

const sign = (percent: number): Preset["sign"] => ({
  brandId: "northwind", kind: "percent", prefix: "SELECT", collection: "MODELS", percent, offLabel: "OFF*", priceLabel: "", footer: "*MSRP",
});

describe("preset ids are made in one place", () => {
  beforeEach(() => { setRepo(new MemoryRepo()); assertSafeRepo(); });
  it("no trailing dash", () => {
    const p = upsertPreset("50% off!", sign(50));
    expect(p.id).toBe("50-off");
    expect(p.created).toBe(true);
  });
  it("names made only of symbols never share an id", () => {
    expect(upsertPreset("!!!", sign(10)).id).toBe("preset");
    expect(upsertPreset("???", sign(20)).id).toBe("preset-2");
    expect(listPresets().map((p) => [p.id, p.name])).toEqual([["preset", "!!!"], ["preset-2", "???"]]);
  });
  it("the same name again updates that preset", () => {
    upsertPreset("Holiday", sign(10));
    const again = upsertPreset(" holiday ", sign(30));
    expect(again.created).toBe(false);
    expect(again.id).toBe("holiday");
    expect(listPresets()).toHaveLength(1);
    expect(listPresets()[0]!.sign.percent).toBe(30);
  });
  it("a preset saved earlier under an old-style id keeps it and is updated in place", () => {
    savePresets([{ id: "50-off-", name: "50% off!", sign: sign(50) }]);
    const r = upsertPreset("50% OFF!", sign(45));
    expect(r).toMatchObject({ id: "50-off-", created: false });
    expect(listPresets()).toEqual([{ id: "50-off-", name: "50% OFF!", sign: sign(45) }]);
  });
});

describe("the server saves presets by name", () => {
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  const call: Call = (...a) => server!.call(...a);
  const json = { "content-type": "application/json" };
  const presets = async () => (JSON.parse((await call("GET", "/api/state")).body) as { presets: Preset[] }).presets;

  beforeAll(async () => {
    const dir = tmpWorkspace("signsnip-presets-");
    fs.cpSync(path.join(root, "seed"), dir, { recursive: true });
    // what an older version of the web app stored: an id with a trailing dash
    fs.writeFileSync(path.join(dir, "presets.json"), JSON.stringify([{ id: "50-off-", name: "50% off!", sign: sign(50) }]));
    server = await startServer(dir);
  });
  afterAll(async () => { await server?.stop(); });

  it("an old preset still loads, can be edited and deleted", async () => {
    expect((await presets()).map((p) => p.id)).toEqual(["50-off-"]);
    const r = await call("POST", "/api/presets", json, JSON.stringify({ name: "50% off!", sign: sign(40) }));
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toMatchObject({ id: "50-off-", created: false });
    expect(await presets()).toEqual([{ id: "50-off-", name: "50% off!", sign: sign(40) }]);
    expect((await call("DELETE", "/api/presets/50-off-")).status).toBe(200);
    expect(await presets()).toEqual([]);
  });
  it("ignores an id sent by an older open tab and makes its own", async () => {
    const r = await call("POST", "/api/presets", json, JSON.stringify({ id: "-", name: "Tom & Co", sign: sign(30) }));
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body).id).toBe("tom-and-co");
    expect((await presets()).map((p) => p.id)).toContain("tom-and-co");
    expect((await presets()).map((p) => p.id)).not.toContain("-");
  });
  it("refuses a blank name", async () => {
    const r = await call("POST", "/api/presets", json, JSON.stringify({ name: "   ", sign: sign(30) }));
    expect(r.status).toBe(400);
  });
});
