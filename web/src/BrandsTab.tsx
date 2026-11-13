import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { CheckIcon, ChevronDownIcon, ImageUpIcon, PlusIcon, RotateCcwIcon, SearchIcon, Trash2Icon, TriangleAlertIcon, WandSparklesIcon } from "lucide-react";
import { toast } from "sonner";
import { fitLogo, maxLogoScale } from "../../src/core/layout";
import type { Sign } from "../../src/core/types";
import { count } from "../../src/core/words";
import * as api from "./api";
import { brandSaveDecision, type BrandFields } from "./brandEdit";
import { LOW_DPI, brandProblems, filterBrands, nextOpen, printedDpi, refusedJustNow, showBrandSearch, tapTarget, type EditorFlush } from "./brandList";
import { logoVersion, logosKey } from "./logoVersion";
import { usePdf } from "./App";
import { RowLogo, useHeaderHeight } from "./BatchPanel";
import { PdfView } from "./PdfView";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type Run = (fn: () => Promise<unknown>, ok?: string) => Promise<void>;
const OPTIONS = { grid: "landscape-5x2", paper: "letter", cutMarks: false } as const;

/** The open editor, for the list: save what is typed, then say whether it may close. */
interface EditorHandle { flush: () => Promise<EditorFlush> }

/**
 * Brands & logos: a compact list (logo, name, how many collections, problem badges), one row per
 * brand. A tap opens that brand's editor in place; opening another first saves the open one and
 * closes it only when nothing typed is left unsaved (brandList.ts decides). A search box shows
 * from 7 brands. `focusBrand` (a warning's "Open brand" on Make signs) opens and scrolls to a row.
 */
export function BrandsTab({ brands, refresh, focusBrand, onFocused }: {
  brands: api.BrandWithLogo[]; refresh: () => Promise<void>;
  focusBrand: { id: string; n: number } | null; onFocused: () => void;
}) {
  const [newName, setNewName] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  /** the open editor holds text that isn't stored (typed, or refused): it stays in the list whatever the search */
  const [held, setHeld] = useState(false);
  /** the row to bring into view after the next render (a jump from another tab, or a brand just added) */
  const [scrollTo, setScrollTo] = useState<{ id: string; n: number } | null>(null);
  /** the row a jump landed on: ringed until another one opens */
  const [landed, setLanded] = useState<string | null>(null);
  const editor = useRef<EditorHandle | null>(null);
  const openRef = useRef(open);
  openRef.current = open;
  const busy = useRef(false);
  const headerH = useHeaderHeight();

  const run: Run = async (fn, ok) => {
    try { await fn(); await refresh(); if (ok) toast(ok); } catch (e) { toast.error((e as Error).message); }
  };

  /** open `want` (null: close), after the open editor saved; it stays open if it must (nextOpen) */
  const go = async (want: string | null) => {
    if (busy.current) return openRef.current;
    busy.current = true;
    try {
      const cur = openRef.current;
      const f = cur && editor.current ? await editor.current.flush() : null;
      const next = nextOpen(cur, want, f);
      setOpen(next);
      if (next !== landed) setLanded(null);
      return next;
    } finally { busy.current = false; }
  };

  const add = () => newName.trim() && run(async () => {
    const b = await api.saveBrand({ name: newName.trim() });
    setNewName("");
    toast(b.created ? "Brand added. Now drop its logo in the box below its name." : `“${b.name}” is already a brand, so nothing new was added`);
    await refresh();
    setQuery("");
    if ((await go(b.id)) === b.id) setScrollTo({ id: b.id, n: Date.now() });
  });

  // "Open brand" from a warning on Make signs: open that row and bring it into view
  useEffect(() => {
    if (!focusBrand) return;
    const id = focusBrand.id;
    onFocused();
    setQuery("");
    void go(id).then((next) => { if (next === id) { setLanded(id); setScrollTo({ id, n: Date.now() }); } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusBrand?.n]);

  useLayoutEffect(() => {
    if (!scrollTo) return;
    const row = document.querySelector<HTMLElement>(`[data-brand-row="${CSS.escape(scrollTo.id)}"]`);
    if (!row) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    row.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
  }, [scrollTo]);

  const searching = showBrandSearch(brands.length);
  const shown = searching ? filterBrands(brands, query, held ? open : null) : brands;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Add a brand</CardTitle>
          <CardDescription>Then drop a logo (PNG, JPG, WebP or SVG) in its box. Empty margins are trimmed and the logo is fitted to the sign; use the size slider if it looks too small.</CardDescription>
        </CardHeader>
        <CardContent>
          <InputGroup className="max-w-md">
            <InputGroupInput aria-label="Brand name" placeholder="Brand name" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
            <InputGroupAddon align="inline-end">
              <InputGroupButton variant="default" disabled={!newName.trim()} onClick={add}><PlusIcon data-icon="inline-start" />Add</InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        </CardContent>
      </Card>

      {searching && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <InputGroup className="max-w-md">
            <InputGroupAddon><SearchIcon /></InputGroupAddon>
            <InputGroupInput type="search" aria-label="Search brands" placeholder="Search brands" value={query} onChange={(e) => setQuery(e.target.value)} />
          </InputGroup>
          {query.trim() && <span role="status" className="text-sm text-muted-foreground">{shown.length} of {count(brands.length, "brand")}</span>}
        </div>
      )}

      {shown.length === 0 && (
        <Empty className="border border-dashed">
          <EmptyHeader>
            <EmptyTitle>{brands.length ? "No brand matches" : "No brands yet"}</EmptyTitle>
            <EmptyDescription>{brands.length ? `Nothing is called “${query.trim()}”.` : "Add one above."}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      <ul className="flex flex-col gap-2" aria-label="Brands">
        {shown.map((b) => (
          <BrandRow key={b.id} b={b} open={open === b.id} landed={landed === b.id} scrollMargin={headerH + 12} onTap={() => void go(tapTarget(open, b.id))}>
            {open === b.id && (
              <BrandEditor b={b} run={run} refresh={refresh} handle={editor} onHeld={setHeld}
                onDeleted={() => { editor.current = null; setHeld(false); setOpen(null); }} />
            )}
          </BrandRow>
        ))}
      </ul>
    </div>
  );
}

/** One brand in the list: a row that opens and closes its editor (the editor sits right under it). */
function BrandRow({ b, open, landed, scrollMargin, onTap, children }: {
  b: api.BrandWithLogo; open: boolean; landed: boolean; scrollMargin: number; onTap: () => void; children: React.ReactNode;
}) {
  const panel = useId();
  const problems = brandProblems(b);
  return (
    <li data-brand-row={b.id} style={{ scrollMarginTop: scrollMargin }}>
      <Card className={cn("gap-0 py-0", landed && "ring-3 ring-primary")}>
        <button type="button" aria-expanded={open} aria-controls={open ? panel : undefined} onClick={onTap}
          className={cn("flex w-full items-center gap-3 rounded-xl px-4 py-2.5 text-left outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50", open && "rounded-b-none border-b")}>
          <RowLogo brand={b} className="h-8 w-20" />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span data-slot="brand-name" className="line-clamp-2 font-medium wrap-break-word" title={b.name}>{b.name}</span>
            <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              {count(b.collections.length, "collection")}
              {problems.map((p) => <Badge key={p} variant="destructive">{p}</Badge>)}
            </span>
          </span>
          <ChevronDownIcon aria-hidden className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
        </button>
        {open && <div id={panel}>{children}</div>}
      </Card>
    </li>
  );
}

type BrandField = "name" | "collections";

/** The quiet confirmation next to a field that saved by itself (a live region, so screen readers hear it too). */
function SavedNote({ show }: { show: boolean }) {
  return (
    <span role="status" className="flex items-center gap-1 text-xs text-muted-foreground">
      {show && <><CheckIcon aria-hidden className="size-3.5" />Saved</>}
    </span>
  );
}

function BrandEditor({ b, run, refresh, handle, onHeld, onDeleted }: {
  b: api.BrandWithLogo; run: Run; refresh: () => Promise<void>;
  handle: React.MutableRefObject<EditorHandle | null>; onHeld: (held: boolean) => void; onDeleted: () => void;
}) {
  const colsText = b.collections.join("\n");
  const [name, setName] = useState(b.name);
  const [cols, setCols] = useState(colsText);
  const [scale, setScale] = useState(b.logoScale);
  const [over, setOver] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  /** which fields just saved (the "Saved" note), and which failed and why (`empty`: the name box was emptied) */
  const [saved, setSaved] = useState<{ fields: BrandField[]; at: number } | null>(null);
  const [error, setError] = useState<{ fields: BrandField[]; message: string; empty?: boolean } | null>(null);
  useEffect(() => { setScale(b.logoScale); }, [b.logoScale]);
  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(null), 2500);
    return () => clearTimeout(t);
  }, [saved]);

  // Name and Collections save by themselves: on blur, when the tab or the page is left with an
  // edit pending, and before the list opens another brand. `stored` is what the brand has, or what is
  // already on its way there, so a blur and a flush never send the same edit twice. Saves run one
  // after another (`queue`).
  const stored = useRef<BrandFields>({ name: b.name, collections: b.collections });
  const typed = useRef({ name, collections: cols });
  typed.current = { name, collections: cols };
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const alive = useRef(true);
  /** when an edit was last refused (0: not since the last switch); one just before a switch keeps this editor open, to show why */
  const refusedAt = useRef(0);
  // follow the stored brand (after a save, or a change in another window) in each field without an edit of its own
  useEffect(() => {
    const prev = stored.current;
    if (typed.current.name.trim() === prev.name.trim()) setName(b.name);
    if (brandSaveDecision(prev, { name: prev.name, collections: typed.current.collections }).save === null) setCols(colsText);
    stored.current = { name: b.name, collections: b.collections };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [b.name, colsText]);

  /** how: "blur" (still on screen), "closing" (page hidden or closed: the save must outlive it), "gone" (the editor unmounted) */
  const commit = (how: "blur" | "closing" | "gone") => {
    const d = brandSaveDecision(stored.current, typed.current);
    const before = stored.current;
    if (d.emptyName) {
      typed.current = { ...typed.current, name: before.name }; // once: a flush right after this blur doesn't refuse it again
      const message = `A brand needs a name, so it stays “${before.name}”`;
      if (how !== "gone") { setName(before.name); setError({ fields: ["name"], message, empty: true }); refusedAt.current = Date.now(); }
      toast(message);
    }
    if (!d.save) {
      // the fields hold what is stored again (e.g. a refused name was put back by hand): no error to show
      if (how !== "gone" && !d.emptyName && error && !error.empty) setError(null);
      return;
    }
    const next = d.save;
    stored.current = next;
    if (how !== "gone" && !d.emptyName) setError(null);
    queue.current = queue.current.then(async () => {
      // the editor went away because the brand was deleted: don't bring it back
      if (how === "gone" && !(await api.getState()).brands.some((x) => x.id === b.id)) return;
      await api.saveBrand({ id: b.id, name: next.name, collections: next.collections }, how === "closing");
      if (alive.current) setSaved({ fields: d.changed, at: Date.now() });
      await refresh().catch(() => {});
    }).catch((e: Error) => {
      // keep what was typed; the next blur tries again
      if (stored.current === next) stored.current = before;
      refusedAt.current = Date.now();
      toast.error(`Couldn't save ${before.name}: ${e.message}`);
      if (alive.current) setError({ fields: d.changed, message: e.message });
    });
  };
  const commitRef = useRef(commit);
  commitRef.current = commit;
  useEffect(() => {
    alive.current = true;
    const hide = () => { if (document.visibilityState === "hidden") commitRef.current("closing"); };
    const leave = () => commitRef.current("closing");
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("pagehide", leave);
    handle.current = {
      flush: async () => {
        commitRef.current("blur");
        await queue.current; // never rejects: a failed save is caught above
        const pending = brandSaveDecision(stored.current, typed.current).save !== null;
        const refused = refusedJustNow(refusedAt.current, Date.now());
        refusedAt.current = 0;
        return { pending, refused };
      },
    };
    const mine = handle.current;
    return () => {
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("pagehide", leave);
      alive.current = false;
      if (handle.current === mine) handle.current = null;
      commitRef.current("gone"); // another tab was picked (or the search hid this brand) with an edit still in a field
      onHeld(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const failed = (f: BrandField) => (error?.fields.includes(f) ? error.message : null);
  // what the list must not filter away: text that isn't stored, or an error on screen
  const held = brandSaveDecision(stored.current, { name, collections: cols }).save !== null || !name.trim() || !!error;
  useEffect(() => { onHeld(held); }, [held, onHeld]);

  const upload = (f?: File) => f && run(() => api.uploadLogo(b.id, f), "Logo updated");
  const logo = b.logo;
  const maxScale = logo ? maxLogoScale(logo.aspect) : 1.6;
  const dpi = printedDpi(b, scale);

  // live sign preview for this brand (shows the current slider value before it's saved)
  const sample: Sign = {
    id: `preview-${b.id}`, brandId: b.id, kind: "percent", prefix: "SELECT", collection: b.collections[0] ?? "MODELS",
    percent: 50, offLabel: "OFF*", priceLabel: "", footer: "*MSRP", copies: 1,
  };
  const preview = usePdf([sample], OPTIONS, "single", logosKey([b]));

  return (
    <>
      <CardContent className="flex flex-col gap-4 pt-4">
        <div className="flex flex-wrap gap-1.5">
          {logo ? (
            <>
              <Badge variant="secondary">{logo.width}×{logo.height}px</Badge>
              <Badge variant={dpi < LOW_DPI ? "destructive" : "secondary"}>~{dpi} dpi printed</Badge>
              {logo.background !== "transparent" && <Badge variant={logo.background === "solid" ? "destructive" : "outline"}>{logo.background} background</Badge>}
            </>
          ) : <Badge variant="destructive">no logo</Badge>}
        </div>
        <div className="grid grid-cols-[1fr_auto] gap-3">
          <label
            className={cn("flex min-h-28 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed bg-background p-3 text-center text-xs text-muted-foreground transition-colors", over && "border-primary bg-accent")}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); upload(e.dataTransfer.files[0]); }}
          >
            {logo ? <img className="max-h-16 max-w-full rounded-sm bg-white object-contain p-1" src={api.logoUrl(b.id, logoVersion(b))} alt={`${b.name} logo`} /> : <ImageUpIcon className="size-6" />}
            <span>{logo ? "Drop a new logo to replace" : "Drop a logo here or click to choose"}</span>
            <input type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; upload(f); }} />
          </label>
          <div className="rounded-lg bg-muted p-2">
            <PdfView bytes={preview.pdf?.bytes ?? null} width={80} label={`${b.name} sample sign`} aspect={47 / 70} />
          </div>
        </div>

        {logo && dpi < LOW_DPI && (
          <p className="flex gap-2 text-xs text-destructive"><TriangleAlertIcon className="size-4 shrink-0" />Low resolution: may print soft. Upload a file at least {Math.ceil((fitLogo(logo.aspect, undefined, scale).w / 25.4) * 300)} px wide.</p>
        )}
        {logo && (logo.background !== "transparent" || logo.hasOriginal) && (
          <div className="flex flex-wrap gap-2">
            {logo.background !== "transparent" && (
              <Button type="button" size="sm" variant="outline" onClick={() => run(() => api.removeLogoBg(b.id), "Background removed")}><WandSparklesIcon data-icon="inline-start" />Remove background</Button>
            )}
            {logo.hasOriginal && (
              <Button type="button" size="sm" variant="ghost" onClick={() => run(() => api.restoreLogo(b.id), "Original logo restored")}><RotateCcwIcon data-icon="inline-start" />Restore original</Button>
            )}
          </div>
        )}

        <FieldGroup>
          {logo && (
            <Field>
              <div className="flex items-center justify-between">
                <FieldLabel>Logo size on sign</FieldLabel>
                <span className="text-xs tabular-nums text-muted-foreground">{Math.round(scale * 100)}%</span>
              </div>
              <Slider min={0.5} max={maxScale} step={0.05} value={[Math.min(scale, maxScale)]} aria-label="Logo size" thumbLabel={`${b.name} logo size`}
                onValueChange={(v) => setScale(Array.isArray(v) ? v[0]! : (v as number))}
                onValueCommitted={(v) => {
                  const k = Math.round((Array.isArray(v) ? v[0]! : (v as number)) * 100) / 100;
                  // after any name save still on its way, and with that name (not the one on screen before it)
                  if (k !== b.logoScale) queue.current = queue.current.then(() => run(() => api.saveBrand({ id: b.id, name: stored.current.name, logoScale: k })));
                }} />
              <FieldDescription>Applies to every sign for this brand. Max {Math.round(maxScale * 100)}%: past that it would run into the text.</FieldDescription>
            </Field>
          )}
          <Field data-invalid={!!failed("name") || undefined}>
            <div className="flex items-center justify-between gap-2">
              <FieldLabel htmlFor={`n-${b.id}`}>Name</FieldLabel>
              <SavedNote show={!!saved?.fields.includes("name")} />
            </div>
            <Input id={`n-${b.id}`} value={name} aria-invalid={!!failed("name") || undefined} aria-describedby={failed("name") ? `n-${b.id}-error` : undefined}
              onChange={(e) => { setName(e.target.value); if (error?.empty) { setError(null); refusedAt.current = 0; } }} onBlur={() => commit("blur")}
              onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} />
            {failed("name") && <FieldError id={`n-${b.id}-error`}>Not saved: {failed("name")}</FieldError>}
          </Field>
          <Field data-invalid={!!failed("collections") || undefined}>
            <div className="flex items-center justify-between gap-2">
              <FieldLabel htmlFor={`c-${b.id}`}>Collections</FieldLabel>
              <SavedNote show={!!saved?.fields.includes("collections")} />
            </div>
            <Textarea id={`c-${b.id}`} rows={4} className="resize-none" value={cols} aria-invalid={!!failed("collections") || undefined}
              aria-describedby={failed("collections") ? `c-${b.id}-error` : undefined}
              onChange={(e) => setCols(e.target.value)} onBlur={() => commit("blur")} />
            {failed("collections") && <FieldError id={`c-${b.id}-error`}>Not saved: {failed("collections")}</FieldError>}
            <FieldDescription>One per line. These show up as suggestions when you type a collection. Changes save by themselves.</FieldDescription>
          </Field>
        </FieldGroup>
      </CardContent>
      <CardFooter className="mt-4 gap-2">
        <Button variant="outline" className="text-destructive" onClick={() => setConfirmDelete(true)}><Trash2Icon data-icon="inline-start" />Delete</Button>
      </CardFooter>
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {b.name}?</AlertDialogTitle>
            <AlertDialogDescription>Its logo file is deleted too, and this can't be undone. Signs already in the batch will print without a logo.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => { setConfirmDelete(false); run(async () => { await api.removeBrand(b.id); onDeleted(); }, `Deleted “${b.name}”`); }}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
