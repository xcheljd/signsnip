#!/usr/bin/env node
// Thin launcher so `signo` works from any directory (keeps the caller's cwd for relative file args).
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "package.json"));
const tsx = pathToFileURL(require.resolve("tsx/esm")).href;
const r = spawnSync(process.execPath, ["--import", tsx, path.join(root, "src/cli/index.ts"), ...process.argv.slice(2)], { stdio: "inherit" });
process.exit(r.status ?? 1);
