import { afterAll, beforeAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { exportWorkspace, restoreWorkspace } from "../src/core/workspace";
import { logoInfo, removeLogoBackground, restoreLogo, saveLogo } from "../src/core/store";
import { assertSafeRepo, startServer, tmpWorkspace, useNodeWorkspace } from "./helpers";

/**
 * A logo of one colour on a white box, 400 x 100. Dark dots in two corners keep the upload trim
 * from cropping the white away, so every variant stores at exactly the same size and background.
 */
async function logo(rgb: [number, number, number]): Promise<Uint8Array> {
  const w = 400, h = 100, px = new Uint8Array(w * h * 4).fill(255);
  const paint = (x: number, y: number, c: [number, number, number]) => { const i = (y * w + x) * 4; px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; };
  for (let y = 30; y < 70; y++) for (let x = 100; x < 300; x++) paint(x, y, rgb);
  paint(0, h - 1, [0, 0, 0]); paint(w - 1, 0, [0, 0, 0]);
  return new Uint8Array(await sharp(px, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer());
}
const without = <T extends { version: string }>(i: T) => { const { version: _v, ...rest } = i; return rest; };

describe("logo version (core)", () => {
  let red: Uint8Array, blue: Uint8Array;
  beforeAll(async () => {
    await useNodeWorkspace(tmpWorkspace());
    assertSafeRepo();
    [red, blue] = await Promise.all([logo([220, 20, 20]), logo([20, 20, 220])]);
  });

  it("a different picture of the same size gets a different version, and only that differs", async () => {
    await saveLogo("northwind", red);
    const a = (await logoInfo("northwind"))!;
    await saveLogo("northwind", blue);
    const b = (await logoInfo("northwind"))!;
    expect(a.version).toMatch(/^[0-9a-f]{16}$/);
    expect(b.version).not.toBe(a.version);
    expect(without(b)).toEqual(without(a));
    expect(without(a)).toEqual({ width: 400, height: 100, aspect: 4, background: "white", hasOriginal: false });
  });

  it("the same bytes give the same version, on every read", async () => {
    await saveLogo("northwind", red);
    const a = (await logoInfo("northwind"))!;
    await saveLogo("northwind", red);
    expect((await logoInfo("northwind"))!.version).toBe(a.version);
    expect((await logoInfo("northwind"))!.version).toBe(a.version); // cached read
  });

  it("remove background changes it; restore original brings it back", async () => {
    await saveLogo("northwind", blue);
    const before = (await logoInfo("northwind"))!;
    const cleared = await removeLogoBackground("northwind");
    expect(cleared).toMatchObject({ background: "transparent", hasOriginal: true });
    expect(cleared.version).not.toBe(before.version);
    expect((await logoInfo("northwind"))!.version).toBe(cleared.version);
    await restoreLogo("northwind");
    expect(await logoInfo("northwind")).toEqual(before);
  });

  it("a workspace restore that swaps the logo bytes changes the version back", async () => {
    await saveLogo("northwind", red);
    const redVersion = (await logoInfo("northwind"))!.version;
    const backup = JSON.parse(JSON.stringify(exportWorkspace()));
    await saveLogo("northwind", blue);
    expect((await logoInfo("northwind"))!.version).not.toBe(redVersion);
    restoreWorkspace(backup);
    expect((await logoInfo("northwind"))!.version).toBe(redVersion);
    expect(JSON.stringify(backup)).not.toContain(redVersion); // never stored in a backup
  });
});

describe("logo version (server)", () => {
  let server: Awaited<ReturnType<typeof startServer>>;
  beforeAll(async () => { server = await startServer(tmpWorkspace("signsnip-logo-v-")); }, 60_000);
  afterAll(async () => { await server?.stop(); });

  it("/api/state brand JSON changes after a same-size logo swap", async () => {
    const brandJson = async () => {
      const r = await server.call("GET", "/api/state");
      expect(r.status).toBe(200);
      return JSON.parse(r.body).brands.find((b: { id: string }) => b.id === "northwind");
    };
    const up = (png: Uint8Array) => server.call("POST", "/api/brands/northwind/logo", { "content-type": "image/png" }, png);
    expect((await up(await logo([220, 20, 20]))).status).toBe(200);
    const a = await brandJson();
    expect((await up(await logo([20, 20, 220]))).status).toBe(200);
    const b = await brandJson();
    expect(JSON.stringify(b)).not.toBe(JSON.stringify(a));
    expect(b.logo.version).not.toBe(a.logo.version);
    expect({ ...b, logo: without(b.logo) }).toEqual({ ...a, logo: without(a.logo) });
  });
});
