import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CopyIcon, DownloadIcon, FilePlus2Icon, GridIcon, ImageIcon, PlusIcon, Redo2Icon, RotateCcwIcon, SaveIcon,
  ScanEyeIcon, SquareDashedIcon, Trash2Icon, TriangleAlertIcon, TypeIcon, Undo2Icon, UploadIcon,
} from "lucide-react";
import { toast } from "sonner";
import { DEFAULT_TEMPLATES, FIELD_LABELS, describeOverflow, fitSign, isBuiltin, newObjectId, overflowDetails, resolveTemplate, templateIssues } from "../../../src/core/template";
import { fitLogo } from "../../../src/core/layout";
import { DEFAULT_RULES, TEXT_FIELDS, type Rules, type Sign, type Template, type TemplateObject, type TextField } from "../../../src/core/types";
import * as api from "../api";
import { usePdf } from "../App";
import { PdfView } from "../PdfView";
import { Inspector } from "./InspectorPanel";
import { browserMeasure, useSignFonts } from "./measure";
import { SignCanvas, TemplateThumb, type LogoSource } from "./SignCanvas";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Toggle } from "@/components/ui/toggle";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

/** key-order-independent fingerprint (server JSON and local objects list keys in different orders) */
const canon = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(canon) : v && typeof v === "object"
    ? Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([k, x]) => x !== undefined && k !== "updatedAt").sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, canon(x)]))
    : v;
const strip = (t: Template | null | undefined) => (t ? JSON.stringify(canon(t)) : "");
const OPTIONS = { grid: "landscape-5x2", paper: "letter", cutMarks: false } as const;
const LONG = "Deep Field Chronograph Automatic Edition";

function slugId(name: string, taken: Template[]) {
  const root = name.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 34) || "template";
  if (!taken.some((t) => t.id === root)) return root;
  let n = 2;
  while (taken.some((t) => t.id === `${root}-${n}`)) n++;
  return `${root}-${n}`;
}

export function sampleSign(t: Template, brand: api.BrandWithLogo | undefined, long: boolean): Sign {
  return {
    id: "sample", brandId: brand?.id ?? "sample", kind: t.kind, templateId: t.id, prefix: "SELECT",
    collection: long ? LONG : brand?.collections[0] ?? "Harbor Line", percent: 50, offLabel: "OFF*",
    price: 199, wasPrice: 395, priceLabel: "NOW", footer: "*MSRP", copies: 1,
  };
}
export const logoSource = (b: api.BrandWithLogo | undefined): LogoSource | null =>
  b?.logo ? { url: api.logoUrl(b.id, `${b.logo.width}-${b.logo.background}-${b.logo.hasOriginal}`), aspect: b.logo.aspect, scale: b.logoScale } : null;

function IconTip({ label, children, ...p }: { label: string } & React.ComponentProps<typeof Button>) {
  return (
    <Tooltip>
      <TooltipTrigger render={<Button type="button" variant="ghost" size="icon-sm" aria-label={label} {...p} />}>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function TemplatesTab({
  active, templates, brands, items, refresh, rules = DEFAULT_RULES,
  focus,
}: { active: boolean; templates: Template[]; brands: api.BrandWithLogo[]; items: Sign[]; refresh: () => Promise<unknown>; rules?: Rules; focus?: { row: number; n: number } | null }) {
  const fontsReady = useSignFonts();
  const [currentId, setCurrentId] = useState(templates[0]?.id ?? "percent");
  const [previewRow, setPreviewRow] = useState<number | null>(null);
  const saved = templates.find((t) => t.id === currentId) ?? templates[0];
  const [draft, setDraftState] = useState<Template | null>(saved ? structuredClone(saved) : null);
  const draftRef = useRef(draft);
  const setDraft = (t: Template | null) => { draftRef.current = t; setDraftState(t); };
  const past = useRef<Template[]>([]);
  const future = useRef<Template[]>([]);
  const lastCoalesce = useRef<{ key: string; at: number } | null>(null);
  const [, bump] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [snap, setSnap] = useState(true);
  const [showBoxes, setShowBoxes] = useState(true);
  const [view, setView] = useState<"design" | "print">("design");
  const [brandId, setBrandId] = useState(brands[0]?.id ?? "");
  const [long, setLong] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [importPreview, setImportPreview] = useState<{ raw: unknown; preview: api.SetPreview } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const holder = useRef<HTMLDivElement>(null);
  const [holderW, setHolderW] = useState(420);

  useEffect(() => {
    if (!holder.current) return;
    const el = holder.current;
    const ro = new ResizeObserver(() => setHolderW(el.clientWidth));
    ro.observe(el); setHolderW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  useEffect(() => { if (!brandId && brands[0]) setBrandId(brands[0].id); }, [brands, brandId]);

  const dirty = !!draft && strip(draft) !== strip(saved);
  // follow the saved copy (after save / CLI edits) when nothing local is pending
  useEffect(() => {
    // "nothing pending" = not dirty, or no edits made yet (the first render starts from the built-in
    // layouts before the saved ones arrive, which would otherwise look like unsaved changes)
    if (saved && (!dirty || !past.current.length) && strip(saved) !== strip(draftRef.current)) setDraft(structuredClone(saved));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved?.id, strip(saved)]);

  const open = (id: string) => {
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    setCurrentId(id); setDraft(structuredClone(t)); setSelected(null);
    past.current = []; future.current = []; bump((n) => n + 1);
  };
  const requestOpen = (id: string) => { if (id === currentId) return; if (dirty) setPending(id); else open(id); };
  // "See it in the designer" from Make signs: open that row's template and show the row on the canvas
  useEffect(() => {
    if (!focus) return;
    const s = items[focus.row];
    if (!s) return;
    requestOpen(resolveTemplate(s, templates).id);
    setPreviewRow(focus.row); setBrandId(s.brandId); setLong(false); setView("design");
    selectProblem.current = focus.row;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.n]);
  const selectProblem = useRef<number | null>(null);

  /** apply an edit with undo history (coalesce = merge rapid edits of one control into one step) */
  const change = useCallback((fn: (t: Template) => Template, coalesce?: string) => {
    const cur = draftRef.current;
    if (!cur) return;
    const next = fn(cur);
    if (strip(next) === strip(cur)) return;
    const now = Date.now();
    const merge = coalesce && lastCoalesce.current?.key === coalesce && now - lastCoalesce.current.at < 900;
    if (!merge) { past.current.push(cur); if (past.current.length > 200) past.current.shift(); }
    lastCoalesce.current = coalesce ? { key: coalesce, at: now } : null;
    future.current = [];
    setDraft(next); bump((n) => n + 1);
  }, []);
  const undo = useCallback(() => {
    const prev = past.current.pop(); const cur = draftRef.current;
    if (!prev || !cur) return;
    future.current.push(cur); lastCoalesce.current = null; setDraft(prev); bump((n) => n + 1);
  }, []);
  const redo = useCallback(() => {
    const next = future.current.pop(); const cur = draftRef.current;
    if (!next || !cur) return;
    past.current.push(cur); setDraft(next); bump((n) => n + 1);
  }, []);

  const setObj = (id: string, patch: Partial<TemplateObject>, coalesce?: string) =>
    change((t) => ({ ...t, objects: t.objects.map((o) => (o.id === id ? ({ ...o, ...patch } as TemplateObject) : o)) }), coalesce ?? `${id}:${Object.keys(patch).join(",")}`);
  const removeObj = (id: string) => { change((t) => ({ ...t, objects: t.objects.filter((o) => o.id !== id) })); setSelected(null); };
  const duplicateObj = (id: string) => {
    const t = draftRef.current; const o = t?.objects.find((x) => x.id === id);
    if (!t || !o) return;
    const copy = { ...o, id: newObjectId(t, o.type === "logo" ? "logo" : o.field === "static" ? "static" : o.field), x: o.x + 2, y: o.y + 2 } as TemplateObject;
    change((tt) => ({ ...tt, objects: [...tt.objects, copy] })); setSelected(copy.id);
  };
  /** top of the tallest empty horizontal band (so new text doesn't land on top of something) */
  const freeSpot = (t: Template, want = 8) => {
    const m = t.safeMargin;
    const spans = t.objects.map((o) => [o.y, o.y + o.h] as const).sort((a, b) => a[0] - b[0]);
    let best = { y: 30, gap: 0 }, cursor = m;
    for (const [a, b] of [...spans, [70 - m, 70 - m] as const]) {
      if (a - cursor > best.gap) best = { y: cursor, gap: a - cursor };
      cursor = Math.max(cursor, b);
    }
    const h = Math.max(4, Math.min(want, best.gap));
    return { y: Math.round((best.y + (best.gap - h) / 2) * 2) / 2, h: Math.round(h * 2) / 2 };
  };
  const addText = (field: TextField) => {
    const t = draftRef.current; if (!t) return;
    const spot = freeSpot(t);
    const o: TemplateObject = {
      id: newObjectId(t, field === "static" ? "static" : field), type: "text", field, text: field === "static" ? "NEW TEXT" : "",
      x: 4, y: spot.y, w: 39, h: spot.h, size: Math.min(14, Math.max(7, spot.h * 1.9)), minSize: 7, weight: "bold", align: "center", vAlign: "middle",
      maxLines: field === "heading" ? 3 : field === "collection" ? 2 : 1, balance: false, lineSpacing: 1, uppercase: true, strike: field === "was", color: "#000000",
    };
    change((tt) => ({ ...tt, objects: [...tt.objects, o] })); setSelected(o.id);
  };
  const addLogo = () => {
    const t = draftRef.current; if (!t) return;
    const o: TemplateObject = { id: newObjectId(t, "logo"), type: "logo", x: 4, y: 5, w: 39, h: 15 };
    change((tt) => ({ ...tt, objects: [o, ...tt.objects] })); setSelected(o.id);
  };

  const save = useCallback(async () => {
    const t = draftRef.current; if (!t) return;
    if (!t.name.trim()) { toast.error("Give the template a name"); return; }
    try { await api.saveTemplate(t); await refresh(); toast(`Saved “${t.name}”. Every sign using it is updated.`); } catch (e) { toast.error((e as Error).message); }
  }, [refresh]);
  const revert = () => { if (saved) { setDraft(structuredClone(saved)); past.current = []; future.current = []; setSelected(null); bump((n) => n + 1); } };

  const createFrom = async (base: Template, name: string) => {
    const t: Template = { ...structuredClone(base), id: slugId(name, templates), name, updatedAt: undefined };
    try { await api.saveTemplate(t); await refresh(); open(t.id); setCurrentId(t.id); toast(`Created “${name}”`); } catch (e) { toast.error((e as Error).message); }
  };
  // `open` reads from `templates`, which only updates after refresh; follow currentId once it appears
  useEffect(() => {
    if (draft && draft.id !== currentId) {
      const t = templates.find((x) => x.id === currentId);
      if (t) { setDraft(structuredClone(t)); past.current = []; future.current = []; setSelected(null); }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templates, currentId]);

  // keyboard: only while this tab is showing
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const el = e.target as HTMLElement;
      const typing = el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable || el.getAttribute("role") === "slider";
      if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); save(); return; }
      if (typing) return;
      if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); return; }
      if (!selected) return;
      if (mod && e.key.toLowerCase() === "d") { e.preventDefault(); duplicateObj(selected); return; }
      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); removeObj(selected); return; }
      if (e.key === "Escape") { setSelected(null); return; }
      const step = e.shiftKey ? 1 : 0.1;
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (d) {
        e.preventDefault();
        const o = draftRef.current?.objects.find((x) => x.id === selected);
        if (o) setObj(selected, { x: Math.round((o.x + d[0]!) * 100) / 100, y: Math.round((o.y + d[1]!) * 100) / 100 }, `nudge:${selected}`);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const brand = brands.find((b) => b.id === brandId) ?? brands[0];
  const row = previewRow !== null && items[previewRow] && resolveTemplate(items[previewRow]!, templates).id === draft?.id ? items[previewRow]! : null;
  const sample = useMemo(() => (draft ? (row ? { ...row, id: "sample", templateId: draft.id, kind: draft.kind } : sampleSign(draft, brand, long)) : null), [draft, brand, long, row]);
  const logoFor = (b: api.BrandWithLogo | undefined) => (b?.logo ? { aspect: b.logo.aspect, scale: b.logoScale ?? 1 } : null);
  const issues = useMemo(() => (draft && sample && fontsReady ? templateIssues(draft, { sign: sample, measure: browserMeasure, rules, templates, logo: logoFor(brand) }) : []), [draft, sample, fontsReady, rules, templates, brand]);
  // the real signs in the batch that use this template and don't fit it (what "Make signs" warns about)
  const rowProblems = useMemo(() => {
    if (!draft || !fontsReady) return [];
    const others = templates.filter((x) => x.id !== draft.id);
    return items.flatMap((s, i) => {
      if (resolveTemplate(s, templates).id !== draft.id) return [];
      const f = fitSign(s, [draft, ...others], browserMeasure, rules, { template: draft });
      const lg = logoFor(brands.find((b) => b.id === s.brandId));
      const logo = lg && f.placed.logo ? fitLogo(lg.aspect, f.placed.logo.box, lg.scale) : null;
      const where = f.template.id === draft.id ? "this template" : `“${f.template.name}” (the fallback it switches to)`;
      return overflowDetails(f.template, f.placed, logo).map((d) => ({ i, brandId: s.brandId, d, message: describeOverflow(d, where) }));
    });
  }, [draft, fontsReady, items, templates, rules, brands]);
  // after a jump from Make signs, select the object that doesn't fit
  useEffect(() => {
    if (selectProblem.current === null) return;
    const hit = rowProblems.find((p) => p.i === selectProblem.current);
    if (hit) { setSelected(hit.d.objectId); selectProblem.current = null; }
  }, [rowProblems]);
  const issueMap = new Map<string, "error" | "warn" | "info">();
  for (const i of issues) if (i.objectId) {
    const rank = { error: 3, warn: 2, info: 1 };
    const cur = issueMap.get(i.objectId);
    if (!cur || rank[i.level] > rank[cur]) issueMap.set(i.objectId, i.level);
  }
  const printPdf = usePdf(view === "print" && sample ? [sample] : [], OPTIONS, "single", `${strip(draft)}:${brand?.logoScale}:${JSON.stringify(rules)}`, draft ? [draft] : undefined);
  const usage = (id: string) => items.filter((s) => resolveTemplate(s, templates).id === id).reduce((a, s) => a + s.copies, 0);
  const canvasW = Math.max(240, Math.min(holderW, 560));
  const sel = draft?.objects.find((o) => o.id === selected) ?? null;
  const resettable = !!draft && DEFAULT_TEMPLATES.some((d) => d.id === draft.id);

  const onFile = async (f?: File) => {
    if (!f) return;
    let raw: unknown;
    try { raw = JSON.parse(await f.text()); } catch { toast.error(`${f.name} isn't a template-set file`); return; }
    try { setImportPreview({ raw, preview: await api.inspectSet(raw) }); } catch (e) { toast.error((e as Error).message); }
    if (fileRef.current) fileRef.current.value = "";
  };

  if (!draft || !saved) return null;

  return (
    <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[15rem_1fr_21rem]">
      {/* ------- template list */}
      <Card>
        <CardHeader>
          <CardTitle>Templates</CardTitle>
          <CardDescription>The layout every sign is printed with.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-1">
          {templates.map((t) => {
            const n = usage(t.id);
            return (
              <button key={t.id} type="button" onClick={() => requestOpen(t.id)} data-template={t.id}
                className={cn("flex items-center gap-3 rounded-lg p-2 text-left outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50", t.id === currentId && "bg-accent text-accent-foreground hover:bg-accent")}>
                {fontsReady ? <TemplateThumb template={t.id === currentId ? draft : t} sign={sampleSign(t, brand, false)} logo={logoSource(brand)} width={38} /> : <Skeleton className="h-14 w-[38px]" />}
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium">{t.id === currentId ? draft.name || "Untitled" : t.name}</span>
                  <span className={cn("text-xs", t.id === currentId ? "text-accent-foreground" : "text-muted-foreground")}>{t.kind === "price" ? "Price" : "Percent off"} · {n ? `${n} in batch` : "not in batch"}</span>
                </span>
                {t.id === currentId && dirty && <span className="size-2 rounded-full bg-primary" aria-label="unsaved changes" />}
              </button>
            );
          })}
        </CardContent>
        <CardFooter className="flex flex-wrap gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button type="button" size="sm" variant="outline" />}><PlusIcon data-icon="inline-start" />New</DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Start from</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => createFrom(draft, `${draft.name} copy`)}><CopyIcon />Copy of “{draft.name}”</DropdownMenuItem>
                {DEFAULT_TEMPLATES.filter((d) => isBuiltin(d.id)).map((d) => (
                  <DropdownMenuItem key={d.id} onClick={() => createFrom(d, `My ${d.name.toLowerCase()}`)}><FilePlus2Icon />{d.name} layout</DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button type="button" size="sm" variant="outline" onClick={() => fileRef.current?.click()}><UploadIcon data-icon="inline-start" />Import</Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setExportOpen(true)}><DownloadIcon data-icon="inline-start" />Export</Button>
          <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => onFile(e.target.files?.[0])} />
        </CardFooter>
      </Card>

      {/* ------- canvas */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <span className="truncate">{draft.name || "Untitled"}</span>
            {isBuiltin(draft.id) && <Badge variant="secondary">built in</Badge>}
            {dirty && <Badge variant="outline">unsaved</Badge>}
          </CardTitle>
          <CardDescription>{usage(draft.id) ? `${usage(draft.id)} sign${usage(draft.id) === 1 ? "" : "s"} in the batch use this. Saving updates them all.` : "Not used in the current batch."}</CardDescription>
          <CardAction className="flex gap-2">
            {resettable && <IconTip label="Reset to the original layout" onClick={() => setConfirmReset(true)}><RotateCcwIcon /></IconTip>}
            {!isBuiltin(draft.id) && <IconTip label="Delete template" className="text-destructive" onClick={() => setConfirmDelete(true)}><Trash2Icon /></IconTip>}
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button type="button" size="sm" variant="outline" />}><TypeIcon data-icon="inline-start" />Add text</DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>What should it show?</DropdownMenuLabel>
                  {TEXT_FIELDS.filter((f) => f !== "static").map((f) => <DropdownMenuItem key={f} onClick={() => addText(f)}>{FIELD_LABELS[f]}</DropdownMenuItem>)}
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem onClick={() => addText("static")}>Fixed text (same on every sign)</DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <Tooltip>
              <TooltipTrigger render={<span />}>
                <Button type="button" size="sm" variant="outline" disabled={draft.objects.some((o) => o.type === "logo")} onClick={addLogo}><ImageIcon data-icon="inline-start" />Add logo</Button>
              </TooltipTrigger>
              <TooltipContent>{draft.objects.some((o) => o.type === "logo") ? "This template already has a logo box. Select it to move or resize it." : "Add a box for the brand's logo"}</TooltipContent>
            </Tooltip>
            <span className="mx-1 h-5 w-px bg-border" />
            <IconTip label="Undo (Ctrl+Z)" disabled={!past.current.length} onClick={undo}><Undo2Icon /></IconTip>
            <IconTip label="Redo (Ctrl+Shift+Z)" disabled={!future.current.length} onClick={redo}><Redo2Icon /></IconTip>
            <span className="mx-1 h-5 w-px bg-border" />
            <Tooltip>
              <TooltipTrigger render={<Toggle size="sm" variant="outline" pressed={snap} onPressedChange={setSnap} aria-label="Snap" />}><GridIcon />Snap</TooltipTrigger>
              <TooltipContent>Snap to 0.5 mm, the centre and other objects. Hold Alt to drag freely.</TooltipContent>
            </Tooltip>
            <Toggle size="sm" variant="outline" pressed={showBoxes} onPressedChange={setShowBoxes} aria-label="Show boxes"><SquareDashedIcon />Boxes</Toggle>
            <ToggleGroup variant="outline" size="sm" spacing={0} className="ml-auto" value={[view]} onValueChange={(v) => v[0] && setView(v[0] as "design" | "print")}>
              <ToggleGroupItem value="design">Design</ToggleGroupItem>
              <ToggleGroupItem value="print"><ScanEyeIcon />Print preview</ToggleGroupItem>
            </ToggleGroup>
          </div>

          <div ref={holder} className="flex justify-center rounded-lg bg-muted py-4">
            {view === "design" ? (
              fontsReady && sample ? (
                <SignCanvas
                  template={draft} sign={sample} logo={logoSource(brand)} width={canvasW}
                  selectedId={selected} onSelect={setSelected} snap={snap} showBoxes={showBoxes} issues={issueMap} rules={rules}
                  onChange={(objects) => setDraft({ ...draftRef.current!, objects })}
                  onCommit={(before) => { past.current.push({ ...draftRef.current!, objects: before }); future.current = []; lastCoalesce.current = null; bump((n) => n + 1); }}
                />
              ) : <Skeleton className="bg-background" style={{ width: canvasW, height: canvasW * 78 / 55 }} />
            ) : (
              <div style={{ width: canvasW * 47 / 55 }}>
                <PdfView bytes={printPdf.pdf?.bytes ?? null} width={Math.round(canvasW * 47 / 55)} label="print preview" aspect={47 / 70} />
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <Field className="w-56">
              <FieldLabel htmlFor="sample-brand">Preview with</FieldLabel>
              <Select value={brand?.id ?? ""} items={brands.map((b) => ({ value: b.id, label: b.name }))} onValueChange={(v) => v && setBrandId(v)}>
                <SelectTrigger id="sample-brand" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent><SelectGroup>{brands.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectGroup></SelectContent>
              </Select>
            </Field>
            <Toggle variant="outline" pressed={long && !row} onPressedChange={(v) => { setLong(v); setPreviewRow(null); }}>Test a long name</Toggle>
            {row && (
              <span className="flex items-center gap-2 text-sm">
                <Badge variant="secondary">Showing row {previewRow! + 1}</Badge>
                <Button type="button" size="sm" variant="ghost" onClick={() => setPreviewRow(null)}>Back to sample</Button>
              </span>
            )}
            <p className="ml-auto hidden items-center gap-1.5 text-xs text-muted-foreground lg:flex">
              <Kbd>←↑→↓</Kbd> 0.1 mm <Kbd>Shift</Kbd> 1 mm <Kbd>Del</Kbd> remove <Kbd>Ctrl S</Kbd> save
            </p>
          </div>

          {issues.filter((i) => i.level !== "info").length > 0 && (
            <ul className="flex flex-col gap-1 text-sm">
              {issues.filter((i) => i.level !== "info").map((i, k) => (
                <li key={k}>
                  <button type="button" className={cn("flex items-start gap-2 text-left", i.level === "error" ? "text-destructive" : "text-foreground")} onClick={() => i.objectId && setSelected(i.objectId)}>
                    <TriangleAlertIcon className={cn("mt-0.5 size-4 shrink-0", i.level === "warn" && "text-warning")} />{i.message}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {rowProblems.length > 0 && (
            <section aria-label="Batch signs that don't fit" className="flex flex-col gap-2 rounded-lg border p-3 text-sm">
              <p className="font-medium">
                {(() => {
                  const bad = new Set(rowProblems.filter((p) => !p.d.harmless).map((p) => p.i)).size;
                  const tight = new Set(rowProblems.filter((p) => p.d.harmless).map((p) => p.i)).size;
                  const n = (k: number) => `${k} sign${k === 1 ? "" : "s"}`;
                  return [bad && `${n(bad)} in your batch ${bad === 1 ? "runs" : "run"} into something`, tight && `${n(tight)} ${tight === 1 ? "is" : "are"} a tight fit but ${tight === 1 ? "prints" : "print"} fine`].filter(Boolean).join(" · ");
                })()}
              </p>
              <ul className="flex flex-col gap-2">
                {[...rowProblems].sort((a, b) => Number(a.d.harmless) - Number(b.d.harmless)).map((p, k) => (
                  <li key={k} className="flex items-start gap-2">
                    <TriangleAlertIcon className={cn("mt-0.5 size-4 shrink-0", p.d.harmless ? "text-muted-foreground" : "text-warning")} />
                    <span className="min-w-0 flex-1">Row {p.i + 1}: {p.message}</span>
                    <Button type="button" size="sm" variant="outline" className="shrink-0" onClick={() => { setPreviewRow(p.i); setBrandId(p.brandId); setLong(false); setSelected(p.d.objectId); setView("design"); }}>
                      Show it
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {issues.some((i) => i.level === "info") && (
            <p className="text-xs text-muted-foreground">{issues.filter((i) => i.level === "info").map((i) => i.message).join(" ")}</p>
          )}
        </CardContent>
        <CardFooter className="flex gap-2">
          <Button type="button" disabled={!dirty} onClick={save}><SaveIcon data-icon="inline-start" />Save template</Button>
          <Button type="button" variant="outline" disabled={!dirty} onClick={revert}>Discard changes</Button>
        </CardFooter>
      </Card>

      {/* ------- inspector */}
      <Card className="xl:sticky xl:top-20 xl:max-h-[calc(100vh-6rem)] xl:overflow-y-auto">
        <CardHeader>
          <CardTitle>{sel ? "Object" : "Template"}</CardTitle>
          {sel && <CardAction><Button type="button" size="sm" variant="ghost" onClick={() => setSelected(null)}>Done</Button></CardAction>}
        </CardHeader>
        <CardContent>
          <Inspector
            template={draft} selected={sel}
            onTemplate={(p) => change((t) => ({ ...t, ...p }), `tpl:${Object.keys(p).join(",")}`)}
            onObject={(p) => sel && setObj(sel.id, p)}
            onPick={setSelected}
            templates={templates} storeMin={rules.readableMin}
            onDelete={() => sel && removeObj(sel.id)}
            onDuplicate={() => sel && duplicateObj(sel.id)}
          />
        </CardContent>
      </Card>

      {/* ------- dialogs */}
      <AlertDialog open={pending !== null} onOpenChange={(o) => !o && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Save changes to “{draft.name}”?</AlertDialogTitle>
            <AlertDialogDescription>You have unsaved edits. Save them before switching, or throw them away.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <Button variant="outline" onClick={() => { const id = pending!; setPending(null); open(id); }}>Discard</Button>
            <AlertDialogAction onClick={async () => { const id = pending!; setPending(null); await save(); open(id); }}>Save &amp; switch</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmDelete && !isBuiltin(draft.id)} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{draft.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              {usage(draft.id) ? `${usage(draft.id)} sign${usage(draft.id) === 1 ? "" : "s"} in the batch use it and will switch to the built-in ${draft.kind === "price" ? "Price" : "Percent off"} layout. ` : ""}
              Export it first if you might want it back.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={async () => {
              setConfirmDelete(false); // base-nova's Action button doesn't close the dialog by itself
              try { await api.deleteTemplate(draft.id); await refresh(); toast(`Deleted “${draft.name}”`); open(templates.find((t) => t.id !== draft.id)?.id ?? "percent"); setCurrentId(templates.find((t) => t.id !== draft.id)?.id ?? "percent"); } catch (e) { toast.error((e as Error).message); }
            }}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmReset} onOpenChange={setConfirmReset}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset “{draft.name}” to the original layout?</AlertDialogTitle>
            <AlertDialogDescription>Your changes to this template are replaced{usage(draft.id) ? `, and the ${usage(draft.id)} signs using it change too` : ""}. Export it first if you want to keep your version.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep mine</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={async () => {
              setConfirmReset(false);
              try { const t = await api.resetTemplate(draft.id); await refresh(); setDraft(structuredClone(t)); past.current = []; future.current = []; setSelected(null); toast("Back to the original layout"); } catch (e) { toast.error((e as Error).message); }
            }}>Reset</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ExportDialog open={exportOpen} onOpenChange={setExportOpen} templates={templates} current={draft.id} dirty={dirty} />
      {importPreview && (
        <ImportDialog data={importPreview} onClose={() => setImportPreview(null)}
          onDone={async (r) => {
            await refresh();
            const first = r.added[0] ?? r.renamed[0]?.to ?? r.replaced[0];
            if (first) setCurrentId(first);
            const parts = [
              r.added.length && `${r.added.length} added`, r.replaced.length && `${r.replaced.length} replaced`,
              r.renamed.length && `${r.renamed.length} kept as copies`, r.unchanged.length && `${r.unchanged.length} already here`,
            ].filter(Boolean);
            toast(`Imported: ${parts.join(", ") || "nothing new"}`);
          }} />
      )}
    </div>
  );
}

function ExportDialog({ open, onOpenChange, templates, current, dirty }: { open: boolean; onOpenChange: (o: boolean) => void; templates: Template[]; current: string; dirty: boolean }) {
  const [picked, setPicked] = useState<Set<string>>(new Set([current]));
  const [name, setName] = useState("");
  useEffect(() => { if (open) setPicked(new Set([current])); }, [open, current]);
  const all = picked.size === templates.length;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Export a template set</DialogTitle>
          <DialogDescription>Saves the chosen layouts to a .signsnip.json file you can keep, back up or import on another computer.</DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor="set-name">Set name</FieldLabel>
          <Input id="set-name" placeholder="e.g. Holiday 2026" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field>
          <div className="flex items-center justify-between">
            <FieldLabel>Templates</FieldLabel>
            <Button type="button" size="xs" variant="ghost" onClick={() => setPicked(all ? new Set() : new Set(templates.map((t) => t.id)))}>{all ? "Select none" : "Select all"}</Button>
          </div>
          <div className="flex max-h-64 flex-col gap-2 overflow-y-auto rounded-lg border p-3">
            {templates.map((t) => (
              <Field key={t.id} orientation="horizontal">
                <Checkbox id={`ex-${t.id}`} checked={picked.has(t.id)} onCheckedChange={(c) => { const n = new Set(picked); if (c) n.add(t.id); else n.delete(t.id); setPicked(n); }} />
                <FieldLabel htmlFor={`ex-${t.id}`} className="font-normal">{t.name} <span className="text-muted-foreground">· {t.kind === "price" ? "price" : "percent"}</span></FieldLabel>
              </Field>
            ))}
          </div>
          {dirty && picked.has(current) && <FieldDescription>The current template has unsaved edits. The file gets the last saved version.</FieldDescription>}
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!picked.size} onClick={async () => {
            try {
              api.saveDownload(await api.exportTemplates([...picked], name));
              onOpenChange(false); toast(`Exported ${picked.size} template${picked.size === 1 ? "" : "s"}`);
            } catch (e) { toast.error((e as Error).message); }
          }}>
            <DownloadIcon data-icon="inline-start" />Download
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ImportDialog({ data, onClose, onDone }: { data: { raw: unknown; preview: api.SetPreview }; onClose: () => void; onDone: (r: api.ImportResult) => Promise<void> }) {
  const rows = data.preview.templates;
  const [picked, setPicked] = useState<Set<string>>(new Set(rows.filter((r) => r.status !== "same").map((r) => r.id)));
  const [mode, setMode] = useState<"keep-both" | "replace">("keep-both");
  const conflicts = rows.filter((r) => r.status === "conflict" && picked.has(r.id)).length;
  const STATUS = { new: { label: "New", variant: "secondary" }, same: { label: "Already have it", variant: "outline" }, conflict: { label: "Differs from yours", variant: "destructive" } } as const;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Import {data.preview.name ? `“${data.preview.name}”` : "template set"}</DialogTitle>
          <DialogDescription>{rows.length} template{rows.length === 1 ? "" : "s"}, exported {new Date(data.preview.exportedAt).toLocaleDateString()}.</DialogDescription>
        </DialogHeader>
        <div className="flex max-h-64 flex-col gap-2 overflow-y-auto rounded-lg border p-3">
          {rows.map((r) => (
            <Field key={r.id} orientation="horizontal" data-disabled={r.status === "same" || undefined}>
              <Checkbox id={`im-${r.id}`} disabled={r.status === "same"} checked={picked.has(r.id)} onCheckedChange={(c) => { const n = new Set(picked); if (c) n.add(r.id); else n.delete(r.id); setPicked(n); }} />
              <FieldLabel htmlFor={`im-${r.id}`} className="flex-1 font-normal">{r.name}</FieldLabel>
              <Badge variant={STATUS[r.status].variant}>{STATUS[r.status].label}</Badge>
            </Field>
          ))}
        </div>
        {conflicts > 0 && (
          <Field>
            <FieldLabel>When a template differs from yours</FieldLabel>
            <RadioGroup value={mode} onValueChange={(v) => setMode(v as "keep-both" | "replace")}>
              <Field orientation="horizontal"><RadioGroupItem value="keep-both" id="m-keep" /><FieldLabel htmlFor="m-keep" className="font-normal">Keep both (import as a copy)</FieldLabel></Field>
              <Field orientation="horizontal"><RadioGroupItem value="replace" id="m-replace" /><FieldLabel htmlFor="m-replace" className="font-normal">Replace mine with the imported one</FieldLabel></Field>
            </RadioGroup>
          </Field>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!picked.size} onClick={async () => {
            try { const r = await api.importSet(data.raw, mode, [...picked]); onClose(); await onDone(r); } catch (e) { toast.error((e as Error).message); }
          }}><UploadIcon data-icon="inline-start" />Import {picked.size || ""}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
