import { useEffect, useState, type RefObject } from "react";
import { FileDownIcon, FileUpIcon, InfoIcon } from "lucide-react";
import { toast } from "sonner";
import { count } from "../../src/core/words";
import type { Batch } from "../../src/core/types";
import * as api from "./api";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

type Update = (fn: (b: Batch) => Batch, opts?: { undo?: string; coalesce?: string }) => boolean | void;

/** "Share as a file": name the batch, then download one file with its signs, brands, logos and templates. */
export function ShareBatchDialog({ open, onClose, batch, defaultName }: { open: boolean; onClose: () => void; batch: Batch; defaultName: string }) {
  const [name, setName] = useState(defaultName);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setName(defaultName); }, [open, defaultName]);
  const share = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      api.saveDownload(await api.shareBatch(batch, name.trim()));
      toast(`Downloaded “${name.trim()}” as a file`);
      onClose();
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };
  const signs = batch.items.reduce((n, s) => n + s.copies, 0);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Share this batch as a file</DialogTitle>
          <DialogDescription>
            {count(signs, "sign")}. The file holds the signs plus the brands, logos and templates they use, so it prints the same on another computer, phone or store. Send it by email, chat or AirDrop.
          </DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor="share-batch-name">Name</FieldLabel>
          <Input id="share-batch-name" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void share(); } }} />
          <FieldDescription>The other person sees it under this name in their saved batches.</FieldDescription>
        </Field>
        <Alert>
          <InfoIcon />
          <AlertDescription>This file contains the logos of the brands in this batch. Share it only with people who may have them.</AlertDescription>
        </Alert>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="button" disabled={!name.trim() || busy} onClick={share}><FileDownIcon data-icon="inline-start" />{busy ? "Making the file…" : "Download file"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const BRAND = { new: { label: "New", variant: "secondary" }, yours: { label: "Already here: yours is kept", variant: "outline" } } as const;
const TEMPLATE = { new: { label: "New", variant: "secondary" }, same: { label: "Already here", variant: "outline" }, conflict: { label: "Differs from yours: both kept", variant: "outline" } } as const;

/**
 * "Open a shared file": the hidden picker (opened by the button in Saved batches), the preview
 * of what would be added, then the import. The file becomes a new saved batch; the current batch
 * changes only if the user presses "Open it now".
 */
export function OpenBatchFile({ fileRef, update, refresh }: { fileRef: RefObject<HTMLInputElement | null>; update: Update; refresh: () => Promise<unknown> }) {
  const [pending, setPending] = useState<{ raw: unknown; preview: api.BatchFilePreview; file: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const pick = async (f: File | undefined) => {
    if (!f) return;
    try {
      let raw: unknown;
      try { raw = JSON.parse(await f.text()); } catch { toast.error("That file isn't a SignSnip batch"); return; }
      setPending({ raw, preview: await api.inspectBatchFile(raw), file: f.name });
    } catch (e) { toast.error((e as Error).message); }
    finally { if (fileRef.current) fileRef.current.value = ""; } // the same file can be picked again
  };
  const add = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      const res = await api.importBatchFile(pending.raw);
      setPending(null);
      await refresh();
      toast(`Added “${res.savedName}” to your saved batches`, {
        duration: 15_000,
        action: {
          label: "Open it now",
          onClick: async () => {
            try { const s = await api.loadSaved(res.savedId); update(() => s.batch, { undo: `Opened “${res.savedName}”` }); }
            catch (e) { toast.error((e as Error).message); }
          },
        },
      });
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };
  const p = pending?.preview;
  return (
    <>
      <input ref={fileRef} type="file" accept=".json,application/json" className="sr-only" tabIndex={-1} aria-label="Shared batch file" onChange={(e) => pick(e.target.files?.[0])} />
      <Dialog open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="break-words">Open “{p?.name}”?</DialogTitle>
            <DialogDescription render={<div />}>
              <p className="break-all">{pending?.file}</p>
              <p className="mt-1">{p ? `${count(p.copies, "sign")} on ${count(p.pages, "page")} · shared ${new Date(p.exportedAt).toLocaleString()}` : ""}</p>
            </DialogDescription>
          </DialogHeader>
          {p && (
            <div className="flex max-h-[45svh] flex-col gap-3 overflow-y-auto">
              {p.brands.length > 0 && (
                <section aria-label="Brands in the file" className="flex flex-col gap-1.5 rounded-lg border p-3">
                  <h3 className="text-xs font-medium text-muted-foreground uppercase">{count(p.brands.length, "brand")}</h3>
                  {p.brands.map((b, i) => (
                    <div key={i} className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                      <span className="min-w-0 break-words">{b.name}</span>
                      <Badge variant={BRAND[b.status].variant}>{BRAND[b.status].label}</Badge>
                    </div>
                  ))}
                </section>
              )}
              {p.templates.length > 0 && (
                <section aria-label="Templates in the file" className="flex flex-col gap-1.5 rounded-lg border p-3">
                  <h3 className="text-xs font-medium text-muted-foreground uppercase">{count(p.templates.length, "template")}</h3>
                  {p.templates.map((t) => (
                    <div key={t.id} className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                      <span className="min-w-0 break-words">{t.name}</span>
                      <Badge variant={TEMPLATE[t.status].variant}>{TEMPLATE[t.status].label}</Badge>
                    </div>
                  ))}
                </section>
              )}
              <ul className="flex list-disc flex-col gap-1 pl-5 text-muted-foreground">
                <li>It's added to your saved batches. Your current batch stays as it is until you open it.</li>
                <li>Nothing you already have is replaced: your own brands, logos and templates are kept.</li>
                <li>Brands with the same name use your logo.</li>
                <li>Text rules (abbreviations) aren't part of the file, so long names may be shortened differently here.</li>
              </ul>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPending(null)}>Cancel</Button>
            <Button type="button" disabled={busy} onClick={add}><FileUpIcon data-icon="inline-start" />{busy ? "Adding…" : "Add to saved batches"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
