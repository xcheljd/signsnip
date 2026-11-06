import { MemoryRepo } from "../../../src/core/repo";

/**
 * Browser storage: everything lives in memory for instant, synchronous reads (the shared
 * store logic is synchronous), and every write is queued to IndexedDB in the background.
 * One database, two object stores: "json" (structured values) and "blobs" (logo PNGs).
 */
const DB = "signsnip", VERSION = 1;

/** "Changed since the last backup?" lives in localStorage so the reminder survives reloads. */
export const BACKUP_KEYS = { changed: "signsnip.lastChange", backup: "signsnip.lastBackup" } as const;
let quiet = false; // restore/start write a lot; they set the timestamps themselves
export function quietly<T>(fn: () => Promise<T>): Promise<T> { quiet = true; return fn().finally(() => { quiet = false; }); }
function markChanged() {
  if (quiet) return;
  localStorage.setItem(BACKUP_KEYS.changed, String(Date.now()));
  window.dispatchEvent(new Event("signsnip:saved-state"));
}
export function markBackedUp(at = Date.now()) {
  localStorage.setItem(BACKUP_KEYS.backup, String(at));
  window.dispatchEvent(new Event("signsnip:saved-state"));
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}

export class BrowserRepo extends MemoryRepo {
  private queue: Promise<void> = Promise.resolve();
  private failed: Error | null = null;
  onError?: (e: Error) => void;
  private constructor(private db: IDBDatabase) { super(); }

  static async open(): Promise<BrowserRepo> {
    const open = indexedDB.open(DB, VERSION);
    open.onupgradeneeded = () => {
      for (const s of ["json", "blobs"]) if (!open.result.objectStoreNames.contains(s)) open.result.createObjectStore(s);
    };
    const db = await req(open);
    const r = new BrowserRepo(db);
    const tx = db.transaction(["json", "blobs"], "readonly");
    const [jk, jv, bk, bv] = await Promise.all([
      req(tx.objectStore("json").getAllKeys()), req(tx.objectStore("json").getAll()),
      req(tx.objectStore("blobs").getAllKeys()), req(tx.objectStore("blobs").getAll()),
    ]);
    jk.forEach((k, i) => r.json.set(String(k), jv[i]));
    bk.forEach((k, i) => r.blobs.set(String(k), new Uint8Array(bv[i] as ArrayBuffer)));
    return r;
  }

  private persist(fn: (tx: IDBTransaction) => void) {
    markChanged();
    this.queue = this.queue.then(() => new Promise<void>((res) => {
      const tx = this.db.transaction(["json", "blobs"], "readwrite");
      fn(tx);
      tx.oncomplete = () => res();
      tx.onerror = tx.onabort = () => {
        this.failed = tx.error ?? new Error("Saving to browser storage failed");
        this.onError?.(this.failed);
        res();
      };
    }));
  }
  override setJson(key: string, value: unknown) {
    super.setJson(key, value);
    const v = structuredClone(value);
    this.persist((tx) => tx.objectStore("json").put(v, key));
  }
  override setBlob(key: string, bytes: Uint8Array) {
    super.setBlob(key, bytes);
    const copy = bytes.slice().buffer; // store an ArrayBuffer (structured-clonable everywhere)
    this.persist((tx) => tx.objectStore("blobs").put(copy, key));
  }
  override remove(key: string) {
    super.remove(key);
    this.persist((tx) => { tx.objectStore("json").delete(key); tx.objectStore("blobs").delete(key); });
  }
  /** resolves when every write so far has reached IndexedDB; throws if any failed */
  async flush(): Promise<void> {
    await this.queue;
    if (this.failed) { const e = this.failed; this.failed = null; throw e; }
  }
}
