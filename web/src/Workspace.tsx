import { useEffect, useRef, useState } from "react";
import { ArchiveRestoreIcon, CircleAlertIcon, CircleCheckIcon, DatabaseIcon, DownloadIcon, FilePlus2Icon, InfoIcon, ServerOffIcon, SignpostIcon, SparklesIcon, TriangleAlertIcon } from "lucide-react";
import { toast } from "sonner";
import * as api from "./api";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const describe = (s: api.BackupSummary) =>
  [plural(s.brands, "brand"), plural(s.logos, "logo"), plural(s.templates, "template"), plural(s.presets, "preset"), plural(s.saved, "saved batch"), `${s.signs} signs in the batch`].join(" · ");

export async function downloadBackup() {
  try { api.saveDownload(await api.backup()); toast("Backup downloaded. Keep it somewhere safe (it includes your logos)."); }
  catch (e) { toast.error((e as Error).message); }
}

/**
 * The three ways in: blank, the made-up samples, or a backup file.
 * `replacing` = shown from the menu over an existing workspace (so it warns first).
 */
export function StartChoices({ replacing, onDone }: { replacing: boolean; onDone: () => void }) {
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"" | "scratch" | "samples" | "backup">("");
  const [pending, setPending] = useState<{ raw: unknown; summary: api.BackupSummary; name: string } | null>(null);

  const go = async (from: "scratch" | "samples") => {
    setBusy(from);
    try { await api.start(from); onDone(); } catch (e) { toast.error((e as Error).message); setBusy(""); }
  };
  const pick = async (f: File | undefined) => {
    if (!f) return;
    try {
      const raw = JSON.parse(await f.text());
      setPending({ raw, summary: await api.inspectBackup(raw), name: f.name });
    } catch (e) {
      toast.error(e instanceof SyntaxError ? "That file isn't a Sign-O-Matic backup" : (e as Error).message);
    } finally { if (file.current) file.current.value = ""; }
  };
  const restore = async () => {
    if (!pending) return;
    setBusy("backup");
    try { await api.restoreBackup(pending.raw); onDone(); } catch (e) { toast.error((e as Error).message); setBusy(""); }
  };

  return (
    <div className="flex flex-col gap-4">
      {replacing && (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>This replaces everything here</AlertTitle>
          <AlertDescription>
            Brands, logos, templates, text rules, presets and saved batches. Download a backup first if you might want them back.
            <Button type="button" variant="outline" size="sm" className="mt-2 w-fit" onClick={downloadBackup}><DownloadIcon data-icon="inline-start" />Back up first</Button>
          </AlertDescription>
        </Alert>
      )}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><FilePlus2Icon className="size-4 text-primary" />Start from scratch</CardTitle>
            <CardDescription>An empty workspace with the built-in templates and default text rules. Add your own brands and logos.</CardDescription>
          </CardHeader>
          <CardFooter><Button className="w-full" disabled={!!busy} onClick={() => go("scratch")}>{busy === "scratch" ? "Setting up…" : "Start from scratch"}</Button></CardFooter>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><SparklesIcon className="size-4 text-primary" />Try the samples</CardTitle>
            <CardDescription>Five made-up watch brands with fake logos, presets and a small batch, to see how everything works.</CardDescription>
          </CardHeader>
          <CardFooter><Button className="w-full" variant="outline" disabled={!!busy} onClick={() => go("samples")}>{busy === "samples" ? "Loading…" : "Load samples"}</Button></CardFooter>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><ArchiveRestoreIcon className="size-4 text-primary" />Continue your work</CardTitle>
            <CardDescription>Restore a backup file (<code className="whitespace-nowrap text-xs">.signo-backup.json</code>) from this app, another computer, or the local version.</CardDescription>
          </CardHeader>
          <CardFooter>
            <input ref={file} type="file" accept=".json,application/json" className="sr-only" aria-label="Backup file" onChange={(e) => pick(e.target.files?.[0])} />
            <Button className="w-full" variant="outline" disabled={!!busy} onClick={() => file.current?.click()}>Choose backup file…</Button>
          </CardFooter>
        </Card>
      </div>

      <Dialog open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Restore this backup?</DialogTitle>
            <DialogDescription render={<div />}>
              <p className="break-all font-medium text-foreground">{pending?.name}</p>
              <p className="mt-1">Made {pending ? new Date(pending.summary.exportedAt).toLocaleString() : ""}</p>
              <p className="mt-2">{pending ? describe(pending.summary) : ""}</p>
              {replacing && <p className="mt-2 font-medium text-destructive">Everything currently here is replaced.</p>}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPending(null)}>Cancel</Button>
            <Button disabled={busy === "backup"} onClick={restore}>{busy === "backup" ? "Restoring…" : "Restore"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** The plain-language explanation of where your work lives in the hosted app. */
export function HowSavingWorks({ compact = false }: { compact?: boolean }) {
  const strong = "font-semibold text-foreground";
  return (
    <div className="flex max-w-prose flex-col gap-3 text-sm">
      <p className="flex items-start gap-2 text-base font-semibold text-foreground">
        <ServerOffIcon aria-hidden className="mt-1 size-4 shrink-0 text-primary" />
        This site does not save your work.
      </p>
      <p className="flex items-start gap-2">
        <DownloadIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <span>
          <strong className={strong}>Download a backup to pick up where you left off</strong>: <strong className={`${strong} whitespace-nowrap`}>Workspace → Back up everything</strong> saves
          your brands, logos, templates, text rules, presets and batches to your computer.
          Next time, choose <strong className={`${strong} whitespace-nowrap`}>Continue your work</strong> and pick that file.
        </span>
      </p>
      <div className="flex items-start gap-2">
        <DatabaseIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div>
          There's no server and no account; nothing you make is uploaded. As a convenience, your browser keeps a temporary copy on this device
          so a reload doesn't lose your place. <strong className={strong}>Don't rely on it.</strong> It's erased without warning when:
          <ul className="mt-1 list-disc pl-5">
            <li>you clear your browsing data, or use a private window</li>
            <li>you switch to another browser or device</li>
            <li>the browser frees up space on its own</li>
          </ul>
        </div>
      </div>
      {!compact && <p className="text-muted-foreground">PDFs are separate: download them as usual. The backup is what lets you edit again later.</p>}
    </div>
  );
}

/** "2:14 PM" today, otherwise "Nov 3, 2:14 PM" */
const when = (ms: number) => {
  const d = new Date(ms), today = new Date().toDateString() === d.toDateString();
  return d.toLocaleString(undefined, today ? { hour: "numeric", minute: "2-digit" } : { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};

/** Hosted app only: always-visible line saying the work isn't saved, with backup status. */
export function SavingStatusBar() {
  const read = () => ({ changed: Number(localStorage.getItem("signo.lastChange") ?? 0), backup: Number(localStorage.getItem("signo.lastBackup") ?? 0) });
  const [st, setSt] = useState(read);
  const [, tick] = useState(0);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const on = () => setSt(read());
    window.addEventListener("signo:saved-state", on);
    const t = setInterval(() => tick((n) => n + 1), 60_000); // keep "x min ago" fresh
    return () => { window.removeEventListener("signo:saved-state", on); clearInterval(t); };
  }, []);
  const unsaved = st.changed > st.backup;
  return (
    <div className="border-b bg-card">{/* opaque base: the tint below is translucent, and this bar is sticky */}
    <div role="status" className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-1.5 text-sm sm:px-6 ${unsaved ? "bg-warning/10" : "bg-muted/50"}`}>
      {unsaved ? <CircleAlertIcon aria-hidden className="size-4 shrink-0 text-warning" /> : <CircleCheckIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />}
      <span className="text-foreground">
        <strong className="font-semibold">This site doesn't save your work.</strong>{" "}
        {!st.backup ? (st.changed ? "You haven't backed up yet." : "Back up to your computer to keep it.")
          : unsaved ? `You've made changes since your last backup at ${when(st.backup)}.` : `Last backup ${when(st.backup)}, nothing changed since.`}
      </span>
      <span className="ml-auto flex items-center gap-1">
        <Button type="button" variant="link" size="sm" className="h-auto px-1" onClick={() => setOpen(true)}><InfoIcon data-icon="inline-start" />How saving works</Button>
        <Button type="button" size="sm" variant={unsaved ? "default" : "outline"} onClick={downloadBackup}><DownloadIcon data-icon="inline-start" />Back up now</Button>
      </span>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>How saving works</DialogTitle>
            <DialogDescription render={<div />}><HowSavingWorks /></DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Close</Button>
            <Button onClick={() => { setOpen(false); void downloadBackup(); }}><DownloadIcon data-icon="inline-start" />Back up now</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
    </div>
  );
}

/** First visit to the hosted app. */
export function StartPage({ onDone }: { onDone: () => void }) {
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-5xl flex-col justify-center gap-6 p-4 sm:p-8">
      <div className="flex flex-col gap-2">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight"><SignpostIcon aria-hidden className="size-6 text-primary" />Sign-O-Matic</h1>
        <p className="text-muted-foreground">Print-ready sale signs for 47 × 70 mm holders. How do you want to start?</p>
      </div>
      <section aria-labelledby="saving-title" className="rounded-xl border border-warning/60 bg-warning/10 p-4 text-muted-foreground">
        <h2 id="saving-title" className="mb-3 flex items-center gap-2 text-sm font-medium tracking-wide text-muted-foreground uppercase"><TriangleAlertIcon aria-hidden className="size-4 text-warning" />Before you start</h2>
        <HowSavingWorks compact />
      </section>
      <StartChoices replacing={false} onDone={onDone} />
      <div id="overlays" />
    </main>
  );
}

/** Header menu: back up, restore, start over. */
export function WorkspaceMenu() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button type="button" variant="outline" size="sm" />}>
          <DatabaseIcon data-icon="inline-start" />Workspace
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuGroup>
            <DropdownMenuLabel>{api.MODE === "browser" ? "Not saved by this site: back up to keep it" : "Saved on this computer (data/)"}</DropdownMenuLabel>
            <DropdownMenuItem onClick={downloadBackup}><DownloadIcon />Back up everything</DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setOpen(true)}><ArchiveRestoreIcon />Restore or start over…</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Restore or start over</DialogTitle>
            <DialogDescription>Pick a fresh start, the samples, or a backup file.</DialogDescription>
          </DialogHeader>
          <StartChoices replacing onDone={() => { setOpen(false); window.location.reload(); }} />
        </DialogContent>
      </Dialog>
    </>
  );
}
