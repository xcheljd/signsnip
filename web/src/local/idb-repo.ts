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

/**
 * Each tab works from its own in-memory copy, so a second tab that keeps editing would save
 * over this one's changes. Every write is announced; other tabs stop and ask for a reload.
 */
const tabs = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("signsnip");
/**
 * Set the moment another tab says it saved. From then on this tab writes nothing: its copy is
 * out of date, and a write still waiting (an autosave due a few ms later, before the notice is
 * drawn) would replace the other tab's newer work.
 */
let otherTabSaved = false;
tabs?.addEventListener("message", () => { otherTabSaved = true; });
/**
 * Why this tab's copy is out of date: "changed" = another tab saved something;
 * "closed" = this tab can't save at all any more (the browser's storage for SignSnip was
 * cleared or deleted while the tab was open), so its work exists only in memory.
 */
export type Stale = "changed" | "closed";
/** listeners told when this tab can no longer save (our database was closed or deleted) */
const staleHere = new Set<(why: Stale) => void>();
export function onChangedElsewhere(fn: (why: Stale) => void): () => void {
  const h = () => fn("changed");
  staleHere.add(fn);
  tabs?.addEventListener("message", h);
  return () => { staleHere.delete(fn); tabs?.removeEventListener("message", h); };
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
    // A newer SignSnip in another tab (or "clear site data") needs the database: let go of it so
    // that tab doesn't hang. This tab can't save any more, so show the reload notice.
    // `onclose` is the browser closing it for us ("clear site data", storage evicted).
    const lost = () => { if (r.closed) return; r.closed = true; for (const f of staleHere) f("closed"); };
    db.onversionchange = () => { db.close(); lost(); };
    db.onclose = lost;
    const tx = db.transaction(["json", "blobs"], "readonly");
    const [jk, jv, bk, bv] = await Promise.all([
      req(tx.objectStore("json").getAllKeys()), req(tx.objectStore("json").getAll()),
      req(tx.objectStore("blobs").getAllKeys()), req(tx.objectStore("blobs").getAll()),
    ]);
    jk.forEach((k, i) => r.json.set(String(k), jv[i]));
    bk.forEach((k, i) => r.blobs.set(String(k), new Uint8Array(bv[i] as ArrayBuffer)));
    return r;
  }

  /** writes dropped because another tab saved first (see otherTabSaved) */
  skipped = 0;
  /** the database was closed for another tab; every later write fails (reload to reopen) */
  closed = false;
  /** Queue one write. A failed write is reported (onError, then flush) and never blocks the next one. */
  private persist(fn: (tx: IDBTransaction) => void) {
    markChanged();
    this.queue = this.queue.then(() => new Promise<void>((res) => {
      let done = false;
      const fail = (e: unknown) => {
        if (done) return;
        done = true;
        this.failed = e instanceof Error ? e : new Error("Saving to browser storage failed");
        this.onError?.(this.failed);
        res();
      };
      if (this.closed) return fail(new Error("This browser's storage for SignSnip was cleared while this tab was open"));
      if (otherTabSaved) { done = true; this.skipped++; return res(); } // the reload notice is already on its way
      let tx: IDBTransaction;
      try { tx = this.db.transaction(["json", "blobs"], "readwrite"); } catch (e) { return fail(e); }
      tx.oncomplete = () => { if (done) return; done = true; tabs?.postMessage("changed"); res(); };
      tx.onerror = tx.onabort = () => fail(tx.error ?? new Error("Saving to browser storage failed"));
      try { fn(tx); } catch (e) { fail(e); try { tx.abort(); } catch { /* already finished */ } }
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
  /** forget an earlier failure, so the next flush() reports only writes made after this */
  async clearFailure(): Promise<void> { await this.queue; this.failed = null; }
  /** resolves once every queued write has finished, whether or not it reached IndexedDB */
  settled(): Promise<void> { return this.queue; }
}
