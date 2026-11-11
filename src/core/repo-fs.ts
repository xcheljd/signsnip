import fs from "node:fs";
import path from "node:path";
import { DamagedData, type Repo } from "./repo.js";

/**
 * Files on disk: JSON keys -> <dir>/<key>.json, blobs -> <dir>/<key>.png.
 * Writes are atomic (write tmp + rename), so a crash never leaves a half-written file.
 * On first use the seed folder is copied in (fake sample brands + logos).
 */
export class FsRepo implements Repo {
  constructor(private dir: string, private seedDir?: string) {}
  private seeded = false;
  private ensure() {
    if (this.seeded) return;
    this.seeded = true;
    const s = this.seedDir;
    if (!s || s === this.dir || !fs.existsSync(s) || fs.existsSync(path.join(this.dir, "brands.json"))) return;
    fs.mkdirSync(this.dir, { recursive: true });
    fs.cpSync(s, this.dir, { recursive: true });
  }
  /** Keys become file paths, so none may climb out of the data folder ("../x", "/etc/x", "a\\b"). */
  private file(k: string, ext: string) {
    if (!k.split("/").every((seg) => seg !== "" && seg !== "." && seg !== ".." && !/[\\\0:]/.test(seg))) throw new Error(`"${k}" isn't a valid name`);
    return path.join(this.dir, `${k}.${ext}`);
  }
  private jsonFile = (k: string) => this.file(k, "json");
  private blobFile = (k: string) => this.file(k, "png");
  private write(file: string, data: string | Uint8Array) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, file);
  }
  getJson(key: string) {
    this.ensure();
    const f = this.jsonFile(key);
    if (!fs.existsSync(f)) return undefined;
    const text = fs.readFileSync(f, "utf8");
    try { return JSON.parse(text); } catch (e) {
      if (e instanceof SyntaxError) throw new DamagedData(key, "isn't valid JSON");
      throw e;
    }
  }
  /** Copy a file that can't be read to <dir>/damaged/, so a later save can't destroy it. */
  setAside(key: string) {
    const f = this.jsonFile(key);
    if (!fs.existsSync(f)) return undefined;
    const to = path.join(this.dir, "damaged", `${key.replace(/\//g, "-")}-${Date.now()}.json`);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(f, to);
    return to;
  }
  setJson(key: string, value: unknown) { this.ensure(); this.write(this.jsonFile(key), JSON.stringify(value, null, 2) + "\n"); }
  getBlob(key: string) {
    this.ensure();
    const f = this.blobFile(key);
    return fs.existsSync(f) ? new Uint8Array(fs.readFileSync(f)) : null;
  }
  setBlob(key: string, bytes: Uint8Array) { this.ensure(); this.write(this.blobFile(key), bytes); }
  remove(key: string) { fs.rmSync(this.jsonFile(key), { force: true }); fs.rmSync(this.blobFile(key), { force: true }); }
  list(prefix: string) {
    this.ensure();
    const d = path.join(this.dir, prefix);
    if (!fs.existsSync(d)) return [];
    return [...new Set(fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isFile() && /\.(json|png)$/.test(e.name)).map((e) => e.name.replace(/\.(json|png)$/, "")))].sort();
  }
  stamp(key: string) {
    for (const f of [this.blobFile(key), this.jsonFile(key)]) if (fs.existsSync(f)) return fs.statSync(f).mtimeMs;
    return 0;
  }
}
