import { useEffect, useRef, useState } from "react";
import { CheckIcon, ImageUpIcon, PlusIcon, RotateCcwIcon, Trash2Icon, TriangleAlertIcon, WandSparklesIcon } from "lucide-react";
import { toast } from "sonner";
import { fitLogo, maxLogoScale } from "../../src/core/layout";
import type { Sign } from "../../src/core/types";
import * as api from "./api";
import { brandSaveDecision, type BrandFields } from "./brandEdit";
import { logoVersion, logosKey } from "./logoVersion";
import { usePdf } from "./App";
import { PdfView } from "./PdfView";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
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

export function BrandsTab({ brands, refresh, focusBrand }: { brands: api.BrandWithLogo[]; refresh: () => Promise<void>; focusBrand: string | null }) {
  const [newName, setNewName] = useState("");
  const run: Run = async (fn, ok) => {
    try { await fn(); await refresh(); if (ok) toast(ok); } catch (e) { toast.error((e as Error).message); }
  };
  const add = () => newName.trim() && run(async () => {
    const b = await api.saveBrand({ name: newName.trim() });
    setNewName("");
    toast(b.created ? "Brand added - now drop its logo on the card" : `"${b.name}" is already a brand - nothing new added`);
  });
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Add a brand</CardTitle>
          <CardDescription>Then drop a logo (PNG, JPG, WebP or SVG) on its card. Empty margins are trimmed and the logo is fitted to the sign; use the size slider if it looks too small.</CardDescription>
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
      <div className="grid grid-cols-[repeat(auto-fill,minmax(19rem,1fr))] gap-4">
        {brands.map((b) => <BrandCard key={b.id} b={b} run={run} refresh={refresh} focused={focusBrand === b.id} />)}
      </div>
    </div>
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

function BrandCard({ b, run, refresh, focused }: { b: api.BrandWithLogo; run: Run; refresh: () => Promise<void>; focused: boolean }) {
  const colsText = b.collections.join("\n");
  const [name, setName] = useState(b.name);
  const [cols, setCols] = useState(colsText);
  const [scale, setScale] = useState(b.logoScale);
  const [over, setOver] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  /** which fields just saved (the "Saved" note), and which failed and why */
  const [saved, setSaved] = useState<{ fields: BrandField[]; at: number } | null>(null);
  const [error, setError] = useState<{ fields: BrandField[]; message: string } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { setScale(b.logoScale); }, [b.logoScale]);
  useEffect(() => { if (focused) ref.current?.scrollIntoView({ behavior: "smooth", block: "center" }); }, [focused]);
  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(null), 2500);
    return () => clearTimeout(t);
  }, [saved]);

  // Name and Collections save by themselves: on blur, and when the tab or the page is left with an
  // edit pending. `stored` is what the brand has, or what is already on its way there, so a blur and
  // the flush on leaving never send the same edit twice. Saves run one after another (`queue`).
  const stored = useRef<BrandFields>({ name: b.name, collections: b.collections });
  const typed = useRef({ name, collections: cols });
  typed.current = { name, collections: cols };
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const alive = useRef(true);
  // follow the stored brand (after a save, or a change in another window) in each field without an edit of its own
  useEffect(() => {
    const prev = stored.current;
    if (typed.current.name.trim() === prev.name.trim()) setName(b.name);
    if (brandSaveDecision(prev, { name: prev.name, collections: typed.current.collections }).save === null) setCols(colsText);
    stored.current = { name: b.name, collections: b.collections };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [b.name, colsText]);

  /** how: "blur" (still on screen), "closing" (page hidden or closed: the save must outlive it), "gone" (the card unmounted) */
  const commit = (how: "blur" | "closing" | "gone") => {
    const d = brandSaveDecision(stored.current, typed.current);
    const before = stored.current;
    if (d.emptyName) {
      if (how !== "gone") setName(before.name);
      toast(`A brand needs a name, so it stays “${before.name}”`);
    }
    if (!d.save) return;
    const next = d.save;
    stored.current = next;
    if (how !== "gone") setError(null);
    queue.current = queue.current.then(async () => {
      // the card went away because the brand was deleted: don't bring it back
      if (how === "gone" && !(await api.getState()).brands.some((x) => x.id === b.id)) return;
      await api.saveBrand({ id: b.id, name: next.name, collections: next.collections }, how === "closing");
      if (alive.current) setSaved({ fields: d.changed, at: Date.now() });
      await refresh().catch(() => {});
    }).catch((e: Error) => {
      // keep what was typed; the next blur tries again
      if (stored.current === next) stored.current = before;
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
    return () => {
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("pagehide", leave);
      alive.current = false;
      commitRef.current("gone"); // another tab was picked with an edit still in a field
    };
  }, []);
  const failed = (f: BrandField) => (error?.fields.includes(f) ? error.message : null);

  const upload = (f?: File) => f && run(() => api.uploadLogo(b.id, f), "Logo updated");
  const logo = b.logo;
  const maxScale = logo ? maxLogoScale(logo.aspect) : 1.6;
  const dpi = logo ? Math.round(logo.width / (fitLogo(logo.aspect, undefined, scale).w / 25.4)) : 0;

  // live sign preview for this brand (shows the current slider value before it's saved)
  const sample: Sign = {
    id: `preview-${b.id}`, brandId: b.id, kind: "percent", prefix: "SELECT", collection: b.collections[0] ?? "MODELS",
    percent: 50, offLabel: "OFF*", priceLabel: "", footer: "*MSRP", copies: 1,
  };
  const preview = usePdf([sample], OPTIONS, "single", logosKey([b]));

  return (
    <Card ref={ref} className={cn(focused && "ring-3 ring-primary")}>
      <CardHeader>
        <CardTitle className="truncate">{b.name}</CardTitle>
        <CardDescription className="flex flex-wrap gap-1.5">
          {logo ? (
            <>
              <Badge variant="secondary">{logo.width}×{logo.height}px</Badge>
              <Badge variant={dpi < 250 ? "destructive" : "secondary"}>~{dpi} dpi printed</Badge>
              {logo.background !== "transparent" && <Badge variant={logo.background === "solid" ? "destructive" : "outline"}>{logo.background} background</Badge>}
            </>
          ) : <Badge variant="destructive">no logo</Badge>}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
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

        {logo && dpi < 250 && (
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
              onChange={(e) => setName(e.target.value)} onBlur={() => commit("blur")}
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
      <CardFooter className="flex gap-2">
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
            <AlertDialogAction variant="destructive" onClick={() => { setConfirmDelete(false); run(() => api.removeBrand(b.id), "Brand removed"); }}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
