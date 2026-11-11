import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startOnce, startServer, tmpWorkspace } from "./helpers";

/**
 * Test files run in parallel and several start a server. Each must get its own port and only ever
 * talk to its own workspace, or one file's requests land in another file's server (and fail with
 * "socket hang up" when that file stops it).
 */
const JSON_TYPE = { "content-type": "application/json" };
type Server = Awaited<ReturnType<typeof startServer>>;
const brandNames = async (s: Server) => (JSON.parse((await s.call("GET", "/api/state")).body).brands as { name: string }[]).map((b) => b.name);

describe("test servers never share a port", () => {
  let a: Server | undefined, b: Server | undefined;
  beforeAll(async () => {
    [a, b] = await Promise.all([startServer(tmpWorkspace("signsnip-srv-a-")), startServer(tmpWorkspace("signsnip-srv-b-"))]);
  }, 60_000);
  afterAll(async () => { await Promise.all([a?.stop(), b?.stop()]); });

  it("two servers started at once get different ports and each answers from its own workspace", async () => {
    expect(a!.port).not.toBe(b!.port);
    expect((await a!.call("POST", "/api/brands", JSON_TYPE, JSON.stringify({ name: "Only In A Co" }))).status).toBe(200);
    expect((await b!.call("POST", "/api/brands", JSON_TYPE, JSON.stringify({ name: "Only In B Co" }))).status).toBe(200);
    const [inA, inB] = [await brandNames(a!), await brandNames(b!)];
    expect(inA).toContain("Only In A Co");
    expect(inA).not.toContain("Only In B Co");
    expect(inB).toContain("Only In B Co");
    expect(inB).not.toContain("Only In A Co");
  });

  it("a server whose port is already taken fails to start instead of borrowing the other one", async () => {
    // the old helper reported ready within milliseconds here, answered by the server already on the port
    await expect(startOnce(tmpWorkspace("signsnip-srv-c-"), a!.port)).rejects.toThrow(/exited early/);
    expect(await brandNames(a!)).toContain("Only In A Co"); // the first server is untouched
  }, 60_000);
});
