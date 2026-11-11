import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { DEFAULT_OPTIONS, type Batch } from "../../src/core/types";
import * as api from "./api";
import { batchPages, pageLimitError } from "../../src/core/geometry";

const EMPTY: Batch = { items: [], options: DEFAULT_OPTIONS };
const OFFLINE_TOAST = "signsnip-offline";
const UNSAVED_TOAST = "signsnip-unsaved";
const MAX_HISTORY = 100;

/**
 * The batch, with undo history and two-way sync to data/batch.json (shared by every window on the local server).
 * `update(fn, { undo: "Removed 3 signs" })` shows a toast with an Undo button.
 * `coalesce` merges rapid edits of one field (typing a quantity) into one undo step.
 */
export function useBatch(onRemote: (s: api.State) => void) {
  const [batch, setBatch] = useState<Batch>(EMPTY);
  const ref = useRef<Batch>(EMPTY);
  const past = useRef<{ id: number; batch: Batch }[]>([]);
  const nextId = useRef(1);
  const lastCoalesce = useRef<{ key: string; at: number } | null>(null);
  const serverJson = useRef("");
  const loaded = useRef(false);
  const [canUndo, setCanUndo] = useState(false);

  const commit = (next: Batch) => { ref.current = next; setBatch(next); };

  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (!prev) { toast("Nothing to undo"); return; }
    lastCoalesce.current = null;
    commit(prev.batch);
    setCanUndo(past.current.length > 0);
  }, []);

  const update = useCallback((fn: (b: Batch) => Batch, opts: { undo?: string; coalesce?: string } = {}) => {
    const prev = ref.current;
    const next = fn(prev);
    if (next === prev) return true;
    // page cap: refuse changes that grow the batch past it (shrinking is always fine)
    const over = pageLimitError(next);
    if (over && batchPages(next) > batchPages(prev)) { toast.error(over); return false; }
    const now = Date.now();
    const merge = opts.coalesce && lastCoalesce.current?.key === opts.coalesce && now - lastCoalesce.current.at < 1500;
    const id = nextId.current++;
    if (!merge) {
      past.current.push({ id, batch: prev });
      if (past.current.length > MAX_HISTORY) past.current.shift();
    }
    lastCoalesce.current = opts.coalesce ? { key: opts.coalesce, at: now } : null;
    commit(next);
    setCanUndo(true);
    if (opts.undo) {
      // a toast's Undo only undoes *its own* change; if something newer happened, say so
      toast(opts.undo, {
        action: {
          label: "Undo",
          onClick: () => {
            if (past.current.at(-1)?.id === id) undo();
            else toast("You've changed things since. Use the Undo button (or Ctrl+Z) to step back.");
          },
        },
      });
    }
    return true;
  }, [undo]);

  /** the batch as last read from the server (it can differ from serverJson while an edit is unsaved) */
  const seenJson = useRef("");
  /** bumped by every finished save, so a poll that started before it can't undo it */
  const saves = useRef(0);
  const refresh = useCallback(async (initial = false) => {
    const gen = saves.current;
    const s = await api.getState();
    onRemote(s);
    const theirs = JSON.stringify(s.batch);
    // a save finished while this read was on its way: the read may predate it, so skip this round
    if (!initial && gen !== saves.current) return s;
    seenJson.current = theirs;
    // adopt changes from another window only when nothing local is waiting to be saved
    if (initial || (theirs !== serverJson.current && JSON.stringify(ref.current) === serverJson.current)) {
      serverJson.current = theirs;
      commit(s.batch);
    }
    loaded.current = true;
    return s;
  }, [onRemote]);

  /** the save still on its way, so the same batch isn't sent twice */
  const sending = useRef<{ json: string; closing: boolean } | null>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  /** a batch the server answered with an error: not retried on its own (a new edit sends again) */
  const refused = useRef("");
  /**
   * Write the batch now if it has unsaved edits. Resolves true when it saved something.
   * Conflict rule (unchanged): this tab's unsaved edit wins over a change made elsewhere
   * (another window shares batch.json) - but never silently: a warning says the other change was replaced.
   */
  const save = useCallback((closing = false, retry = false): Promise<boolean> => {
    // never after unmount: a poll still on its way when the hosted app's "changed in another tab"
    // notice replaces the app would otherwise save this stale copy over the other tab's change
    if (!loaded.current || !alive.current) return Promise.resolve(false);
    const b = ref.current;
    const mine = JSON.stringify(b);
    if (mine === serverJson.current) return Promise.resolve(false);
    if (retry && mine === refused.current) return Promise.resolve(false);
    // Closing a tab fires both visibilitychange and pagehide: send that batch once. An ordinary
    // autosave of the same batch still in flight is re-sent as a closing save, which can outlive the tab.
    const s = sending.current;
    if (s && s.json === mine && (s.closing || !closing)) return Promise.resolve(false);
    const mark = { json: mine, closing };
    sending.current = mark;
    // the server's copy changed since this tab last matched it: saving replaces that change
    const replaces = seenJson.current !== "" && seenJson.current !== serverJson.current;
    return api.putBatch(b, closing)
      .then(() => {
        serverJson.current = mine; seenJson.current = mine; saves.current++;
        if (ref.current === b) toast.dismiss(UNSAVED_TOAST);
        if (replaces) toast.warning("Your edits replaced a change made elsewhere", { duration: 15000, description: "The batch was also changed outside this tab (for example with the signsnip command) before your edits were saved. This tab's version was kept." });
        return true;
      })
      .catch((e: Error) => {
        // fetch throws TypeError when the server can't be reached; anything else is the server's answer
        if (!(e instanceof TypeError)) { refused.current = mine; toast.error(e.message); }
        else toast.error("Couldn't save: SignSnip isn't answering", { id: UNSAVED_TOAST, duration: Infinity, description: "Your edits are kept in this tab and saved as soon as it answers again. Don't close this tab until then." });
        return false;
      })
      .finally(() => { if (sending.current === mark) sending.current = null; });
  }, []);

  // autosave shortly after each edit...
  useEffect(() => {
    const t = setTimeout(save, 300);
    return () => clearTimeout(t);
  }, [batch, save]);
  // ...and at once when the tab is hidden or closed, so the last edit isn't lost in those 300 ms
  useEffect(() => {
    const flush = () => { if (document.visibilityState === "hidden") save(true); };
    const leave = () => save(true);
    document.addEventListener("visibilitychange", flush);
    window.addEventListener("pagehide", leave);
    return () => { document.removeEventListener("visibilitychange", flush); window.removeEventListener("pagehide", leave); };
  }, [save]);

  // poll for changes from another window; say so when the local server stops answering (edits can't be saved then)
  useEffect(() => {
    let misses = 0;
    const tick = () => refresh().then(
      async () => {
        const wasOffline = misses >= 3;
        if (wasOffline) toast.dismiss(OFFLINE_TOAST);
        misses = 0;
        // the server answers again: save what was edited while it couldn't be reached
        const saved = await save(false, true);
        if (JSON.stringify(ref.current) === serverJson.current) toast.dismiss(UNSAVED_TOAST);
        if (saved && wasOffline) toast.success("SignSnip is back - your edits are saved");
      },
      () => { if (++misses === 3) toast.error("SignSnip isn't answering", { id: OFFLINE_TOAST, duration: Infinity, description: "Keep this tab open: edits you make now are saved when it's back. If you closed it, start it again (pnpm start)." }); },
    );
    const t = setInterval(tick, 2500);
    window.addEventListener("focus", tick);
    return () => { clearInterval(t); window.removeEventListener("focus", tick); };
  }, [refresh, save]);

  return { batch, update, undo, canUndo, refresh };
}
