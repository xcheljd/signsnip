import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { Batch } from "../../src/core/types";
import * as api from "./api";
import { batchPages, pageLimitError } from "../../src/core/geometry";

const EMPTY: Batch = { items: [], options: { grid: "landscape-5x2", paper: "letter", cutMarks: true } };
const MAX_HISTORY = 100;

/**
 * The batch, with undo history and two-way sync to data/batch.json (shared with the CLI).
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

  const refresh = useCallback(async (initial = false) => {
    const s = await api.getState();
    onRemote(s);
    const theirs = JSON.stringify(s.batch);
    // adopt CLI-side changes only when nothing local is waiting to be saved
    if (initial || (theirs !== serverJson.current && JSON.stringify(ref.current) === serverJson.current)) {
      serverJson.current = theirs;
      commit(s.batch);
    }
    loaded.current = true;
    return s;
  }, [onRemote]);

  // autosave
  useEffect(() => {
    if (!loaded.current) return;
    const mine = JSON.stringify(batch);
    if (mine === serverJson.current) return;
    const t = setTimeout(() => {
      api.putBatch(batch).then(() => { serverJson.current = mine; }).catch((e) => toast.error(e.message));
    }, 300);
    return () => clearTimeout(t);
  }, [batch]);

  // poll for CLI changes
  useEffect(() => {
    const tick = () => { refresh().catch(() => {}); };
    const t = setInterval(tick, 2500);
    window.addEventListener("focus", tick);
    return () => { clearInterval(t); window.removeEventListener("focus", tick); };
  }, [refresh]);

  return { batch, update, undo, canUndo, refresh };
}
