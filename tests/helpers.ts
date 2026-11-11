import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { afterAll } from "vitest";
import { repo, setRepo } from "../src/core/repo";
import { FsRepo } from "../src/core/repo-fs";

/**
 * Test plumbing that never touches the owner's real data folder (<repo>/data).
 * Every data dir a test uses comes from tmpWorkspace(), lives under os.tmpdir() and is removed
 * after the file's tests. Nothing here spawns the CLI.
 */
export const root = path.resolve(__dirname, "..");
const SEED_DIR = path.join(root, "seed");
const REAL_DATA = path.join(root, "data");
const tmpRoot = fs.realpathSync(os.tmpdir());

const made: string[] = [];
const envBefore = process.env.SIGNSNIP_DATA;
afterAll(() => {
  for (const d of made.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  // vitest reuses a worker process for several files: leave the env as this file found it
  if (envBefore === undefined) delete process.env.SIGNSNIP_DATA; else process.env.SIGNSNIP_DATA = envBefore;
});

/** A fresh, empty dir under os.tmpdir(), deleted after this file's tests. */
export function tmpWorkspace(prefix = "signsnip-test-"): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  made.push(d);
  return d;
}
/** Also delete this path after the file's tests (a file a test wrote next to a workspace). */
export const removeLater = (p: string) => { made.push(p); };

function isUnderTmp(dir: string): boolean {
  const abs = path.resolve(dir);
  const real = fs.existsSync(abs) ? fs.realpathSync(abs) : abs;
  const rel = path.relative(tmpRoot, real);
  return !!rel && !rel.startsWith("..") && !path.isAbsolute(rel);
}
export function assertTempDir(dir: string): void {
  if (!isUnderTmp(dir) || path.resolve(dir).startsWith(REAL_DATA)) throw new Error(`refusing to use ${dir}: test data must live under ${tmpRoot}`);
}

/** The folder the active storage reads and writes, or null for in-memory storage. */
export function activeDataDir(): string | null {
  const r = repo();
  return r instanceof FsRepo ? (r as unknown as { dir: string }).dir : null;
}
/** Throws unless the active storage is in memory or under os.tmpdir(). Call it in every file's beforeAll. */
export function assertSafeRepo(): void {
  const dir = activeDataDir();
  if (dir !== null) assertTempDir(dir);
}

/**
 * Node backends (sharp, Carlito fonts) with storage in `dir`, seeded with the fake sample brands
 * on first use. SIGNSNIP_DATA is set before node.ts is imported, and the repo is replaced
 * explicitly afterwards: node.ts may already have run in this worker with another path.
 */
export async function useNodeWorkspace(dir: string): Promise<string> {
  assertTempDir(dir);
  process.env.SIGNSNIP_DATA = dir;
  await import("../src/core/node");
  setRepo(new FsRepo(dir, SEED_DIR));
  assertSafeRepo();
  return dir;
}

/** The fake sample data as node.ts reads it from ./seed (for startWithSamples). */
export async function seedSamples() {
  return (await import("../src/core/node")).seedSamples();
}

export type Call = (method: string, url: string, headers?: Record<string, string>, body?: string | Uint8Array) => Promise<{ status: number; body: string }>;

/**
 * The local server, started the way `pnpm start` does (tsx + src/server/index.ts), without the CLI.
 * `stop` waits until it has really exited (SIGKILL after 5 s).
 */
export async function startServer(dir: string): Promise<{ port: number; call: Call; stop: () => Promise<void> }> {
  assertTempDir(dir);
  const port = 7900 + Math.floor(Math.random() * 90);
  const tsx = pathToFileURL(createRequire(path.join(root, "package.json")).resolve("tsx/esm")).href;
  const server = spawn(process.execPath, ["--import", tsx, path.join(root, "src/server/index.ts")], {
    env: { ...process.env, SIGNSNIP_DATA: dir, SIGNSNIP_PORT: String(port) }, stdio: "ignore",
  });
  const call: Call = (method, url, headers = {}, body) =>
    new Promise((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port, path: url, method, headers }, (res) => {
        let text = ""; res.on("data", (d) => (text += d)); res.on("end", () => resolve({ status: res.statusCode ?? 0, body: text }));
      });
      req.on("error", reject); req.end(body);
    });
  const stop = async () => {
    if (server.exitCode !== null || server.signalCode !== null) return;
    const gone = new Promise((r) => server.once("exit", r));
    server.kill();
    const t = setTimeout(() => server.kill("SIGKILL"), 5000);
    await gone; clearTimeout(t);
  };
  for (let i = 0; i < 200; i++) {
    if (server.exitCode !== null) throw new Error(`server exited early (code ${server.exitCode})`);
    if (await call("GET", "/api/state").then((r) => r.status === 200, () => false)) return { port, call, stop };
    await new Promise((r) => setTimeout(r, 150));
  }
  await stop();
  throw new Error("server didn't start");
}
