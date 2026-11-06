import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
/** Working data (brands, logos, batch). Gitignored; seeded from ./seed on first run. */
export const DATA_DIR = process.env.SIGNO_DATA ? path.resolve(process.env.SIGNO_DATA) : path.join(ROOT, "data");
export const SEED_DIR = path.join(ROOT, "seed");
export const OUT_DIR = path.join(ROOT, "out");
export const API_PORT = Number(process.env.SIGNO_PORT ?? 7047);
