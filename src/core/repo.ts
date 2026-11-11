/**
 * Where SignSnip keeps its data. All business logic (store.ts) talks to this
 * interface only, so the same code runs on two backends:
 *  - FsRepo (repo-fs.ts): JSON + PNG files in data/, used by the local server and the tests
 *  - BrowserRepo (web/src/local): IndexedDB, for the hosted, no-server version
 *
 * Keys look like paths: "brands", "batches/holiday-sale", "logos/orbital".
 * JSON values and binary blobs live in separate namespaces.
 * Everything is synchronous: the browser backend keeps an in-memory copy and persists
 * writes in the background.
 */
export interface Repo {
  getJson(key: string): unknown;
  setJson(key: string, value: unknown): void;
  getBlob(key: string): Uint8Array | null;
  setBlob(key: string, bytes: Uint8Array): void;
  /** delete a JSON value or blob (no error if missing) */
  remove(key: string): void;
  /** keys directly under a prefix, without the prefix: list("batches/") -> ["holiday-sale"] */
  list(prefix: string): string[];
  /** changes whenever the key is rewritten (mtime on disk, a counter in memory) */
  stamp(key: string): number;
}

let current: Repo | null = null;
export function setRepo(r: Repo): void { current = r; }
export function repo(): Repo {
  if (!current) throw new Error("No storage configured (call setRepo first)");
  return current;
}

/** Plain in-memory repo. Used by tests, and as the base of the browser backend. */
export class MemoryRepo implements Repo {
  json = new Map<string, unknown>();
  blobs = new Map<string, Uint8Array>();
  stamps = new Map<string, number>();
  private tick = 0;
  protected touch(key: string) { this.stamps.set(key, ++this.tick); }
  getJson(key: string) { const v = this.json.get(key); return v === undefined ? undefined : structuredClone(v); }
  setJson(key: string, value: unknown) { this.json.set(key, structuredClone(value)); this.touch(key); }
  getBlob(key: string) { return this.blobs.get(key) ?? null; }
  setBlob(key: string, bytes: Uint8Array) { this.blobs.set(key, bytes); this.touch(key); }
  remove(key: string) { this.json.delete(key); this.blobs.delete(key); this.touch(key); }
  list(prefix: string) {
    const out = new Set<string>();
    for (const k of [...this.json.keys(), ...this.blobs.keys()]) {
      if (k.startsWith(prefix) && !k.slice(prefix.length).includes("/")) out.add(k.slice(prefix.length));
    }
    return [...out].sort();
  }
  stamp(key: string) { return this.stamps.get(key) ?? 0; }
}
