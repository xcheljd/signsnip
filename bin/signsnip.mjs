#!/usr/bin/env node
// Thin launcher so `signsnip` works from any directory (keeps the caller's cwd for relative file args).
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "package.json"));
const tsx = pathToFileURL(require.resolve("tsx/esm")).href;
const child = spawn(process.execPath, ["--import", tsx, path.join(root, "src/cli/index.ts"), ...process.argv.slice(2)], { stdio: "inherit" });

// Pass stop signals on to the real CLI, so `kill <launcher>` (a service manager, a test) also stops `signsnip serve`
// instead of leaving it running as an orphan. Ctrl+C reaches both anyway; a second SIGINT to a dying child is harmless.
const signals = ["SIGINT", "SIGTERM", "SIGHUP"];
for (const sig of signals) process.on(sig, () => { try { child.kill(sig); } catch { /* already gone */ } });
child.on("error", (e) => { console.error(`signsnip: couldn't start: ${e.message}`); process.exit(1); });
child.on("exit", (code, sig) => {
  // Die the same way the child did, so callers see the real exit status (e.g. 143 after SIGTERM).
  if (sig) { for (const s of signals) process.removeAllListeners(s); process.kill(process.pid, sig); return; }
  process.exit(code ?? 1);
});
