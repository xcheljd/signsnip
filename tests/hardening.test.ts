import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addToBatch, buildSign } from "../src/core/batch";
import { checkSigns } from "../src/core/pdf";
import { MemoryRepo, setRepo } from "../src/core/repo";
import { FsRepo } from "../src/core/repo-fs";
import {
  MAX_ID, addBrand, brandMatches, deleteBrand, getBrand, listBrands, listSavedBatches, readBatch, readLogo, saveNamedBatch,
  savedBatchMatches, templateMatches, upsertBrand, writeBatch,
} from "../src/core/store";
import { DEFAULT_OPTIONS } from "../src/core/types";
import { describeSummary, exportWorkspace, startFromScratch, summarizeWorkspace } from "../src/core/workspace";
import { assertSafeRepo, assertTempDir, removeLater, root, startServer, tmpWorkspace, useNodeWorkspace, type Call } from "./helpers";

describe("names never overwrite each other", () => {
  beforeEach(() => setRepo(new MemoryRepo()));
  it("different brand names that slug the same get their own id", () => {
    expect(upsertBrand({ name: "Tom & Co" }).id).toBe("tom-and-co");
    expect(upsertBrand({ name: "Tom and Co" }).id).toBe("tom-and-co-2");
    expect(upsertBrand({ name: "日本" }).id).toBe("brand");
    expect(upsertBrand({ name: "中文" }).id).toBe("brand-2");
    expect(listBrands().map((b) => b.name)).toEqual(expect.arrayContaining(["Tom & Co", "Tom and Co", "日本", "中文"]));
  });
  it("the same name again updates that brand instead of adding one", () => {
    upsertBrand({ name: "Tom & Co", collections: ["A"] });
    expect(upsertBrand({ name: "tom & co ", collections: ["B"] }).id).toBe("tom-and-co");
    expect(listBrands()).toHaveLength(1);
    expect(listBrands()[0]!.collections).toEqual(["B"]);
  });
  it("generated ids always fit the server's limit, suffix included", () => {
    const many = "&".repeat(30); // "&" becomes "and": a 30-character name, a 119-character slug
    const a = upsertBrand({ name: many }), b = upsertBrand({ name: `${many}!` }), c = upsertBrand({ name: `${many}?` });
    for (const x of [a, b, c]) {
      expect(x.id.length).toBeLessThanOrEqual(MAX_ID);
      expect(x.id).toMatch(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/);
    }
    expect([b.id, c.id]).toEqual([`${a.id}-2`, `${a.id}-3`]);
    expect(upsertBrand({ name: many }).id).toBe(a.id); // same name, same id
  });
  it("adding a name that exists keeps the name it has; names are trimmed", () => {
    expect(upsertBrand({ name: "  Tom & Co  " })).toMatchObject({ id: "tom-and-co", name: "Tom & Co", created: true });
    expect(upsertBrand({ name: "tom & co " })).toMatchObject({ id: "tom-and-co", name: "Tom & Co", created: false });
    expect(listBrands().map((b) => b.name)).toEqual(["Tom & Co"]);
    // saving by id is an edit: that may rename (trimmed)
    expect(upsertBrand({ id: "tom-and-co", name: " TOM & CO " }).name).toBe("TOM & CO");
    expect(() => upsertBrand({ name: "   " })).toThrow("A brand needs a name");
  });
  it("says whether a save added a brand or updated one", () => {
    expect(upsertBrand({ name: "Lumen!" })).toMatchObject({ id: "lumen", created: true });
    expect(upsertBrand({ name: "Lumen" })).toMatchObject({ id: "lumen-2", created: true });
    expect(upsertBrand({ name: "lumen" })).toMatchObject({ id: "lumen-2", created: false });
  });
  it("saved batches follow the same rule", () => {
    const batch = { items: [], options: DEFAULT_OPTIONS };
    expect(saveNamedBatch("Sale & more", batch).id).toBe("sale-and-more");
    expect(saveNamedBatch("Sale and more", batch).id).toBe("sale-and-more-2");
    expect(saveNamedBatch("Sale & more", batch).replaced).toBe(true);
    expect(saveNamedBatch("セール", batch).id).toBe("batch");
    expect(listSavedBatches()).toHaveLength(3);
  });
});

describe("typed lookups", () => {
  beforeEach(() => {
    setRepo(new MemoryRepo());
    upsertBrand({ name: "Northwind Watch Co." }); upsertBrand({ name: "North Star" });
    saveNamedBatch("Alpha", { items: [], options: DEFAULT_OPTIONS }); saveNamedBatch("Beta", { items: [], options: DEFAULT_OPTIONS });
  });
  it("nothing typed matches nothing", () => {
    for (const ref of ["", "   "]) {
      expect(brandMatches(ref)).toEqual([]);
      expect(savedBatchMatches(ref)).toEqual([]);
      expect(templateMatches(ref)).toEqual([]);
    }
  });
  it("an exact id or name wins; a vague name returns every candidate", () => {
    expect(brandMatches("north star").map((b) => b.id)).toEqual(["north-star"]);
    expect(brandMatches("north")).toHaveLength(2);
    expect(savedBatchMatches("a")).toHaveLength(2); // Alpha, Beta
    expect(savedBatchMatches("alp").map((b) => b.name)).toEqual(["Alpha"]);
    expect(templateMatches("percent").map((t) => t.id)).toEqual(["percent"]);
  });
});

describe("data folder", () => {
  it("the test helpers refuse the owner's real data folder", async () => {
    expect(() => assertTempDir(path.join(root, "data"))).toThrow(/refusing/);
    await expect(useNodeWorkspace(path.join(root, "data"))).rejects.toThrow(/refusing/);
    await expect(startServer(path.join(root, "data"))).rejects.toThrow(/refusing/);
    expect(fs.existsSync(path.join(root, "data"))).toBe(false);
  });
  it("refuses keys that would leave it", () => {
    const dir = tmpWorkspace("signsnip-hard-");
    // data folder = dir/data, so batches/../../victim would be dir/victim.json: put the victim exactly there
    const outside = path.join(dir, "victim.json");
    fs.writeFileSync(outside, "{}");
    const repo = new FsRepo(path.join(dir, "data"));
    const key = "batches/../../victim";
    expect(path.resolve(dir, "data", `${key}.json`)).toBe(outside);
    expect(() => repo.remove(key)).toThrow(/valid name/);
    expect(() => repo.setJson(key, { x: 1 })).toThrow(/valid name/);
    expect(() => repo.getJson("../x")).toThrow(/valid name/);
    expect(() => repo.setBlob("logos/a\\b", new Uint8Array(1))).toThrow(/valid name/);
    expect(fs.readFileSync(outside, "utf8")).toBe("{}");
    repo.setJson("batches/ok", { x: 1 });
    expect(repo.getJson("batches/ok")).toEqual({ x: 1 });
  });
});

describe("brand guards (core, on disk)", () => {
  let data: string;
  beforeAll(async () => { data = await useNodeWorkspace(tmpWorkspace("signsnip-hard-")); assertSafeRepo(); });
  const notAPicture = new TextEncoder().encode("not a picture");
  it("a logo that can't be read changes no brand, old or new", async () => {
    const logo = fs.readFileSync(path.join(root, "seed/logos/kestrel-vale.png"));
    expect(await addBrand({ name: "Lumen!" })).toMatchObject({ id: "lumen", created: true, hasLogo: false });
    expect(await addBrand({ name: "Lumen" }, logo)).toMatchObject({ id: "lumen-2", created: true, hasLogo: true });
    const before = JSON.stringify(listBrands()), logoBefore = readLogo("lumen-2");
    for (const name of ["Lumen", "lumen", "Lumen!"]) {
      await expect(addBrand({ name }, notAPicture), name).rejects.toThrow("isn't a picture SignSnip can read");
    }
    expect(JSON.stringify(listBrands())).toBe(before);
    expect(readLogo("lumen-2")).toEqual(logoBefore);
    expect(readLogo("lumen")).toBeNull();
    expect(await addBrand({ name: "Lumen", collections: ["Dawn"] })).toMatchObject({ id: "lumen-2", created: false, collections: ["Dawn"] });
  });
  it("adding an existing brand again says so and keeps its name", async () => {
    expect(await addBrand({ name: "Tom & Co" })).toMatchObject({ id: "tom-and-co", created: true });
    expect(await addBrand({ name: "tom & co " })).toMatchObject({ id: "tom-and-co", name: "Tom & Co", created: false });
    const names = listBrands().map((b) => b.name);
    expect(names).toContain("Tom & Co");
    expect(names).not.toContain("tom & co");
  });
  it("counts read as words: 1 brand, 0 saved batches, 1 sign", async () => {
    await useNodeWorkspace(tmpWorkspace("signsnip-hard-own-"));
    startFromScratch();
    await addBrand({ name: "Solo" });
    addToBatch([buildSign({ brand: "solo", collection: "One", percent: 10 })]);
    const text = describeSummary(summarizeWorkspace(exportWorkspace()));
    expect(text).toContain("1 brand · 0 logos");
    expect(text).toContain("0 saved batches · 1 sign in the batch");
    await useNodeWorkspace(data);
  });
  it("a logo that can't be read doesn't leave a brand behind", async () => {
    await expect(addBrand({ name: "Ghost Co" }, notAPicture)).rejects.toThrow("isn't a picture");
    expect(listBrands().map((b) => b.name)).not.toContain("Ghost Co");
  });
  it("a sign whose brand was deleted is shown as deleted, not as a look-alike brand", async () => {
    writeBatch({ ...readBatch(), items: [] });
    addToBatch([buildSign({ brand: "kestrel", collection: "K", percent: 20 })]);
    deleteBrand("kestrel-vale");
    // a look-alike whose id contains the deleted one: a partial lookup of "kestrel-vale" would pick it
    expect((await addBrand({ name: "Kestrel Vale Outlet" })).id).toBe("kestrel-vale-outlet");
    const sign = readBatch().items[0]!;
    expect(sign.brandId).toBe("kestrel-vale");
    expect(getBrand(sign.brandId)).toBeUndefined();
    const w = (await checkSigns(readBatch().items)).filter((x) => x.code === "no-logo");
    expect(w).toHaveLength(1);
    expect(w[0]!.message).toContain("a brand that was deleted");
    expect(w[0]!.message).toContain("kestrel-vale");
    expect(w[0]!.message).not.toContain("Kestrel Vale Outlet");
  });
});

describe("local server only answers this computer's own pages", () => {
  // started the way `pnpm start` does (tsx + src/server/index.ts), on a temp data dir and a random port
  let server: Awaited<ReturnType<typeof startServer>> | undefined, data: string, port = 0;
  const call: Call = (...a) => server!.call(...a);
  const brands = async () => (JSON.parse((await call("GET", "/api/state")).body) as { brands: unknown[] }).brands.length;

  beforeAll(async () => {
    data = tmpWorkspace("signsnip-hard-srv-");
    server = await startServer(data);
    port = server.port;
  });
  // Wait until the server has really exited (SIGKILL after 5s) before the temp data dir is removed.
  afterAll(async () => { await server?.stop(); });

  it("refuses writes sent by another website", async () => {
    const before = await brands();
    expect(before).toBeGreaterThan(0);
    const wipe = await call("POST", "/api/workspace/start", { origin: "https://evil.example", "content-type": "text/plain" }, '{"from":"scratch"}');
    expect(wipe.status).toBe(403);
    const noOrigin = await call("POST", "/api/workspace/start", { "sec-fetch-site": "cross-site", "content-type": "text/plain" }, '{"from":"scratch"}');
    expect(noOrigin.status).toBe(403);
    expect(await brands()).toBe(before);
  });
  it("refuses form-style writes with no Origin (an old browser's cross-site form post)", async () => {
    const before = await brands();
    for (const type of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x", "Text/Plain;charset=UTF-8"]) {
      const r = await call("POST", "/api/brands", { "content-type": type }, '{"name":"Form Post Co"}');
      expect(r.status, type).toBe(403);
    }
    expect(await brands()).toBe(before);
  });
  it("refuses other pages on this computer (another port)", async () => {
    for (const origin of ["http://127.0.0.1:9999", "http://localhost", `https://127.0.0.1:${port}`, "null"]) {
      const r = await call("POST", "/api/brands", { origin, "content-type": "application/json" }, '{"name":"Other Page Co"}');
      expect(r.status, origin).toBe(403);
    }
  });
  it("a brand the app made from a long name stays editable", async () => {
    const made = JSON.parse((await call("POST", "/api/brands", { "content-type": "application/json" }, JSON.stringify({ name: "&".repeat(30) }))).body) as { id: string; name: string };
    const edit = await call("POST", "/api/brands", { "content-type": "application/json" }, JSON.stringify({ id: made.id, name: made.name, logoScale: 1.2 }));
    expect(edit.status, edit.body).toBe(200);
    const upload = await call("POST", `/api/brands/${made.id}/logo`, { "content-type": "image/png" }, fs.readFileSync(path.join(root, "seed/logos/kestrel-vale.png")) as unknown as string);
    expect(upload.status, upload.body).toBe(200);
  });
  it("adding an existing brand name again updates it and keeps the name it has", async () => {
    const post = async (name: string) => JSON.parse((await call("POST", "/api/brands", { "content-type": "application/json" }, JSON.stringify({ name }))).body) as { id: string; name: string; created: boolean };
    expect(await post(" Quill & Co ")).toMatchObject({ id: "quill-and-co", name: "Quill & Co", created: true });
    expect(await post("quill & co")).toMatchObject({ id: "quill-and-co", name: "Quill & Co", created: false });
  });
  it("refuses a hostile domain pointed at 127.0.0.1 (wrong Host)", async () => {
    expect((await call("GET", "/api/state", { host: `evil.example:${port}` })).status).toBe(403);
  });
  it("still serves its own page, the dev page and tools that send no Origin", async () => {
    expect((await call("GET", "/api/state", { origin: `http://127.0.0.1:${port}` })).status).toBe(200);
    expect((await call("GET", "/api/state", { host: `localhost:${port}`, origin: "http://localhost:7048" })).status).toBe(200);
    // the app's own writes (JSON, and a logo upload with the file's type) from its page or the dev page
    for (const origin of [`http://127.0.0.1:${port}`, "http://localhost:7048", "http://[::1]:7048"]) {
      const r = await call("POST", "/api/brands", { origin, "content-type": "application/json" }, JSON.stringify({ name: `Page Co ${origin.length}` }));
      expect(r.status, origin).toBe(200);
    }
    const put = await call("PUT", "/api/batch", { "content-type": "application/json" }, JSON.stringify({ items: [], options: DEFAULT_OPTIONS }));
    expect(put.status).toBe(200);
  });
  it("can't be steered outside the data folder through an id in the URL", async () => {
    const victim = path.join(path.dirname(data), `${path.basename(data)}-victim.json`);
    fs.writeFileSync(victim, "{}"); removeLater(victim);
    const r = await call("DELETE", `/api/batches/..%2F..%2F${path.basename(victim, ".json")}`);
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(fs.existsSync(victim)).toBe(true);
  });
});
