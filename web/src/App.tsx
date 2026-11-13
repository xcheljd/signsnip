import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { count } from "../../src/core/words";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { sheetGeometry } from "../../src/core/geometry";
import { DEFAULT_RULES, type Preset, type Rules, type Sign, type Template, type Warning } from "../../src/core/types";
import { RulesTab } from "./RulesTab";
import { SavingStatusBar, StartPage, WorkspaceButtons } from "./Workspace";
import { DEFAULT_TEMPLATES } from "../../src/core/template";
import { TemplatesTab } from "./designer/TemplatesTab";
import * as api from "./api";
import { latestOnly } from "./latest";
import { closeNotice, nextNotice, noticeText, parseNoticeMemory, type NoticeMemory } from "./dataNotice";
import { logosKey } from "./logoVersion";
import { pdfKey, reusablePdf } from "./pdfKey";
import { BatchPanel, PrintSettings, moveItem, useHeaderHeight } from "./BatchPanel";
import { useMedia } from "./designer/useMedia";
import { BrandsTab } from "./BrandsTab";
import { PdfView } from "./PdfView";
import { downloadPdf, printPdf } from "./print";
import { SheetView } from "./SheetView";
import { SignEditor, SignFormButtons } from "./SignEditor";
import { editLabel } from "./editLabel";
import { cn } from "@/lib/utils";
import { useBatch } from "./useBatch";
import { useTheme } from "./theme";
import { DownloadIcon, MonitorIcon, MoonIcon, PrinterIcon, ScissorsIcon, SunIcon } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { DataNotice } from "./DataNotice";
import { Toasts } from "./Toasts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const uid = () => crypto.randomUUID();
/**
 * The header tabs (shadcn Tabs, `line` variant): the full height of the header, in body colour (the workspace
 * buttons beside them are muted), the open tab bold with a 3 px primary bar along the header's bottom edge (a
 * faint one on hover). Primary, not teal: the bar marks where you are, and reads in light (deep blue on Snow
 * Storm) and dark (light frost on Polar Night).
 */
const NAV_TAB = "h-auto rounded-none px-3 text-foreground md:flex-none md:max-lg:px-2 dark:text-foreground data-active:font-semibold "
  + "after:rounded-t-sm after:bg-primary group-data-horizontal/tabs:after:bottom-0 group-data-horizontal/tabs:after:h-[3px] hover:after:opacity-30";
/**
 * Keep the previous object when the new one says the same thing, so React skips the redraw.
 * Safe for brands: each logo carries `version` (a hash of its bytes), so a replaced logo changes the JSON.
 */
const keep = <T,>(next: T) => (prev: T): T => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next);
const fail = (e: unknown) => toast.error((e as Error).message);

const blank = (brandId: string): Sign => ({
  id: uid(), brandId, kind: "percent", templateId: "percent", prefix: "SELECT", collection: "MODELS", percent: 50, offLabel: "OFF*",
  priceLabel: "", footer: "*MSRP", copies: 1,
});

export function usePdf(items: Sign[], options: Parameters<typeof api.fetchPdf>[1], mode: "sheet" | "single", version = "", templates?: Template[]) {
  // the PDF and the key it was made for are set together, so Print can tell a stale preview
  const [shown, setShown] = useState<{ pdf: api.Pdf | null; madeFor: string | null }>({ pdf: null, madeFor: null });
  const [err, setErr] = useState("");
  const key = pdfKey(items, options, mode, version);
  // Only the newest request may set the PDF: an older render that finishes late is dropped.
  const latest = useRef(latestOnly<api.Pdf>()).current;
  useEffect(() => {
    if (!items.length) { latest.cancel(); setShown({ pdf: null, madeFor: null }); setErr(""); return; }
    const t = setTimeout(() => {
      latest.run(() => api.fetchPdf(items, options, mode, templates), (p) => { setShown({ pdf: p, madeFor: key }); setErr(""); }, (e) => setErr(e.message));
    }, 150);
    return () => { latest.cancel(); clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return { pdf: shown.pdf, madeFor: shown.madeFor, err };
}

/** The hosted build shows a start page on the first visit (blank / samples / restore a backup). */
export function App() {
  const [needStart, setNeedStart] = useState(() => api.needsStart());
  const { resolved } = useTheme();
  if (needStart) return (<><StartPage onDone={() => setNeedStart(false)} /><Toasts theme={resolved} aboveBar={false} /></>);
  return <SignoApp />;
}

function SignoApp() {
  const [tab, setTab] = useState("make");
  const { theme, setTheme, resolved } = useTheme();
  const [brands, setBrands] = useState<api.BrandWithLogo[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [saved, setSaved] = useState<api.SavedSummary[]>([]);
  const [templates, setTemplates] = useState<Template[]>(DEFAULT_TEMPLATES);
  const [rules, setRules] = useState<Rules>(DEFAULT_RULES);
  const [gate, setGate] = useState<{ action: "print" | "download"; small: Warning[] } | null>(null);
  const [draft, setDraft] = useState<Sign | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [warnings, setWarnings] = useState<Warning[]>([]);
  const [presetDialog, setPresetDialog] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [focusBrand, setFocusBrand] = useState<string | null>(null);
  const [focusTemplate, setFocusTemplate] = useState<{ row: number; n: number } | null>(null);
  const [calibrated, setCalibratedState] = useState(() => (localStorage.getItem("signsnip.calibrated") ?? localStorage.getItem("signo.calibrated")) === "1");
  const setCalibrated = (v: boolean) => { localStorage.setItem("signsnip.calibrated", v ? "1" : "0"); setCalibratedState(v); };

  // The damaged-data notice stays until someone presses Close, also across reloads (remembered in localStorage).
  // It is an inline alert at the top of every tab (DataNotice), never a toast, so it can't cover a control.
  const notice = useRef<NoticeMemory | null>(null);
  // a string, so the 2.5 s polls re-render nothing while the text stays the same; a reload shows the
  // remembered notice at once (polls only add to it), so the page doesn't jump when the first poll lands
  const [problemText, setProblemText] = useState(() => noticeText(parseNoticeMemory(localStorage.getItem("signsnip.dataProblems")).open));
  const setNotice = useCallback((mem: NoticeMemory) => {
    notice.current = mem;
    try {
      if (mem.open.length || mem.closed.length) localStorage.setItem("signsnip.dataProblems", JSON.stringify(mem));
      else localStorage.removeItem("signsnip.dataProblems");
    } catch { /* storage blocked or full: the notice still shows for this visit */ }
    setProblemText(noticeText(mem.open));
  }, []);
  const onRemote = useCallback((s: api.State) => {
    notice.current ??= parseNoticeMemory(localStorage.getItem("signsnip.dataProblems"));
    setNotice(nextNotice(notice.current, s.problems));
    setBrands(keep(s.brands)); setPresets(keep(s.presets)); setSaved(keep(s.saved)); setTemplates(keep(s.templates)); setRules(keep(s.rules));
    setDraft((d) => d ?? blank(s.brands[0]?.id ?? ""));
  }, [setNotice]);
  const { batch, update, undo, canUndo, refresh } = useBatch(onRemote);
  useEffect(() => { refresh(true).catch(fail); }, [refresh]);

  // drop selections for rows that no longer exist
  useEffect(() => {
    const ids = new Set(batch.items.map((s) => s.id));
    setSelected((sel) => ([...sel].every((id) => ids.has(id)) ? sel : new Set([...sel].filter((id) => ids.has(id)))));
    if (editing && !ids.has(editing)) setEditing(null);
  }, [batch.items, editing]);

  // pre-print checks (debounced)
  const checkKey = JSON.stringify([batch.items, logosKey(brands), templates.map((t) => t.updatedAt), rules]);
  useEffect(() => {
    if (!batch.items.length) { setWarnings([]); return; }
    const t = setTimeout(() => { api.check(batch.items).then(setWarnings).catch((e) => console.error("sign check failed:", e)); }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkKey]);

  const brand = brands.find((b) => b.id === draft?.brandId);
  /** Add / Update need a brand that exists: one rule for the card's buttons, the print bar's and Enter */
  const canSubmit = !!brand;
  const editTitle = editLabel(batch.items, editing, brands);
  // a sign whose brand was deleted still previews, as it prints: without a logo (like the sheet and the print check)
  const single = useMemo(() => (draft?.brandId ? [draft] : []), [draft]);
  const logoKey = logosKey(brands) + "#"
    + templates.map((t) => `${t.id}@${t.updatedAt ?? ""}`).join("|") + JSON.stringify(rules);
  // logoKey: re-render when a logo is replaced, rescaled or has its background removed
  const singlePdf = usePdf(single, batch.options, "single", logoKey);
  const sheetPdf = usePdf(batch.items, batch.options, "sheet", logoKey);

  const set = (patch: Partial<Sign>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  /** sticky header height (the preview sticks just under it); 768-1023 px the preview column is narrower */
  const chromeH = useHeaderHeight();
  const narrowPreview = useMedia("(min-width: 48rem) and (max-width: 63.98rem)");

  // After Update or Cancel the page goes back to the row that was edited (centred; no smooth
  // scroll when the system asks for reduced motion). After Update the row is also highlighted
  // (`flashRow`) for 1.5 s, counted from when the scroll arrives where the browser says so
  // (scrollend), else from the Update. `n` makes every return a new value, so the same row can be returned to twice.
  const [returnTo, setReturnTo] = useState<{ id: string; flash: boolean; n: number } | null>(null);
  const [flashRow, setFlashRow] = useState<string | null>(null);
  useEffect(() => {
    if (!returnTo) return;
    setFlashRow(returnTo.flash ? returnTo.id : null);
    const row = document.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(returnTo.id)}"]`);
    if (row) {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      row.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
      // keyboard users land on the row too (Tab goes on to its checkbox), without a second scroll;
      // the row itself, not its Edit button, so no tooltip pops up over it
      row.focus({ preventScroll: true });
    }
    if (!returnTo.flash) return;
    const off = () => setFlashRow(null);
    let t = setTimeout(off, 1500);
    const arrived = () => { clearTimeout(t); t = setTimeout(off, 1500); };
    window.addEventListener("scrollend", arrived, { once: true });
    return () => { clearTimeout(t); window.removeEventListener("scrollend", arrived); };
  }, [returnTo]);

  const submit = () => {
    if (!draft) return;
    if (editing) {
      if (update((b) => ({ ...b, items: b.items.map((i) => (i.id === editing ? { ...draft, id: editing } : i)) })) === false) return;
      setEditing(null); setDraft({ ...draft, id: uid() }); toast("Sign updated");
      setReturnTo({ id: editing, flash: true, n: Date.now() });
    } else {
      update((b) => ({ ...b, items: [...b.items, { ...draft, id: uid() }] }), { undo: `Added as row ${batch.items.length + 1}` });
    }
  };
  const edit = (i: number) => {
    const s = batch.items[i];
    if (!s) return;
    setTab("make"); setEditing(s.id); setDraft({ ...s });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const cancelEdit = () => {
    const id = editing;
    setEditing(null); setDraft((d) => (d ? { ...d, id: uid() } : d));
    if (id) setReturnTo({ id, flash: false, n: Date.now() });
  };

  /** One tap deletes a preset; the toast's Undo puts exactly that preset back in its place (nothing else changes). */
  const deletePreset = async (p: Preset) => {
    const index = presets.findIndex((x) => x.id === p.id);
    try { await api.removePreset(p.id); await refresh(); } catch (e) { fail(e); return; }
    toast(`Deleted preset “${p.name}”`, {
      action: {
        label: "Undo",
        onClick: async () => {
          try {
            const back = await api.restorePreset(p, Math.max(0, index));
            await refresh();
            toast(back.renamed ? `A preset called “${p.name}” was made since, so the deleted one is back as “${back.name}”` : `Preset “${p.name}” is back`);
          } catch (e) { toast.error(`Couldn't bring back preset “${p.name}”: ${(e as Error).message}`); }
        },
      },
    });
  };

  /** soft gate: if any sign would still print below the readable minimum, ask first */
  const gated = async (action: "print" | "download", force = false) => {
    if (!batch.items.length) { toast("The batch is empty"); return false; }
    if (force) return true;
    try {
      const small = (await api.check(batch.items)).filter((w) => w.code === "small-text");
      if (small.length) { setGate({ action, small }); return false; }
    } catch { /* checks are advisory; never block printing on a failed check */ }
    return true;
  };
  const print = useCallback(async (force = false) => {
    if (!(await gated("print", force))) return;
    try {
      // reuse the preview only when it was made for exactly this batch; a pending or older render is never printed
      const p = reusablePdf(sheetPdf, pdfKey(batch.items, batch.options, "sheet", logoKey)) ?? await api.fetchPdf(batch.items, batch.options, "sheet");
      printPdf(p.bytes);
      toast(`Printing ${count(p.signs, "sign")}. Set scale to 100% / Actual size.`);
    } catch (e) { fail(e); }
  }, [batch, sheetPdf, logoKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const exportPdf = async (force = false) => {
    if (!(await gated("download", force))) return;
    try {
      const p = await api.fetchPdf(batch.items, batch.options, "sheet");
      downloadPdf(p.bytes, `signs-${new Date().toISOString().slice(0, 10)}.pdf`);
      toast(`Downloaded ${count(p.signs, "sign")} on ${count(p.pages, "page")}`);
    } catch (e) { fail(e); }
  };
  const calibrate = async () => {
    try { printPdf(await api.fetchCalibration(batch.options.paper)); toast("Measure the box: it should be 47 × 70 mm"); } catch (e) { fail(e); }
  };
  const fixBg = async (brandId: string) => {
    try { await api.removeLogoBg(brandId); await refresh(); toast("Background removed", { action: { label: "Undo", onClick: () => api.restoreLogo(brandId).then(() => refresh()) } }); } catch (e) { fail(e); }
  };

  // global shortcuts: Ctrl/Cmd+Z undo (outside text fields), Ctrl/Cmd+P print the sheet
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod || tab !== "make") return; // the template designer has its own shortcuts
      const t = e.target as HTMLElement;
      const typing = t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable;
      if (e.key.toLowerCase() === "z" && !e.shiftKey && !typing) { e.preventDefault(); undo(); }
      if (e.key.toLowerCase() === "p") { e.preventDefault(); print(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, print, tab]);

  const savePreset = async () => {
    if (!draft || !presetName.trim()) return;
    const { id: _id, copies: _c, ...sign } = draft;
    try {
      await api.savePreset({ name: presetName.trim(), sign });
      await refresh(); setPresetDialog(false); toast("Preset saved");
    } catch (e) { fail(e); }
  };

  const warnedRows = new Set(warnings.filter((w) => w.level === "warn").flatMap((w) => w.items));
  const g = sheetGeometry(batch.options);
  const signCount = batch.items.reduce((a, s) => a + s.copies, 0);
  const pageCount = signCount ? Math.ceil(signCount / g.perPage) : 0;
  const THEMES = ["light", "dark", "system"] as const;
  const themeName = { light: "Light", dark: "Dark", system: "Match system" } as const;
  const nextTheme = THEMES[(THEMES.indexOf(theme as (typeof THEMES)[number]) + 1) % THEMES.length]!;

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(String(v))} className="min-h-screen gap-0">
      <div className="sticky top-0 z-10" data-app-chrome>
      {/* One row from 768 px. The tabs are the page's main navigation: as tall as the header, with a bar under the
          open one. The workspace buttons beside them stay quieter (ghost). A phone puts the tabs on a second row. */}
      <header className="flex flex-wrap items-center gap-x-4 border-b bg-card px-4 shadow-xs sm:px-6 md:max-lg:gap-x-3 md:max-lg:px-4">
        <h1 className="flex min-h-14 items-center gap-2 text-lg font-semibold tracking-tight md:max-lg:text-base"><ScissorsIcon aria-hidden className="size-5 text-primary" /> SignSnip</h1>
        <TabsList variant="line" className="order-last w-full items-stretch gap-0 self-stretch overflow-x-auto p-0 group-data-horizontal/tabs:h-auto md:order-none md:w-fit">
          <TabsTrigger value="make" className={NAV_TAB}>Make signs</TabsTrigger>
          <TabsTrigger value="templates" className={NAV_TAB}>Templates</TabsTrigger>
          <TabsTrigger value="rules" className={NAV_TAB}>Text rules</TabsTrigger>
          <TabsTrigger value="brands" className={NAV_TAB}><span className="lg:hidden">Brands</span><span className="hidden lg:inline">Brands &amp; logos</span></TabsTrigger>
        </TabsList>
        <span className="ml-auto"><WorkspaceButtons showBackup={api.MODE !== "browser"} /></span>
        <Tooltip>
          <TooltipTrigger render={<Button type="button" variant="ghost" size="icon-sm" aria-label={`Theme: ${themeName[theme as keyof typeof themeName]}`} data-theme-button={theme} onClick={() => setTheme(nextTheme)} />}>
            {theme === "light" ? <SunIcon /> : theme === "dark" ? <MoonIcon /> : <MonitorIcon />}
          </TooltipTrigger>
          <TooltipContent>Theme: {themeName[theme as keyof typeof themeName]}. Click for {themeName[nextTheme]}.</TooltipContent>
        </Tooltip>
      </header>
      {api.MODE === "browser" && <SavingStatusBar />}
      </div>

      <main>
      {/* in the page flow above every tab (same width and padding as the tab below it), so it never covers a control */}
      {problemText && (
        <div className={cn("mx-auto w-full px-3 pt-3 sm:px-6 sm:pt-6", tab === "templates" ? "max-w-[96rem]" : "max-w-7xl")}>
          <DataNotice text={problemText} onClose={() => setNotice(closeNotice(notice.current ?? parseNoticeMemory(localStorage.getItem("signsnip.dataProblems"))))} />
        </div>
      )}
      <TabsContent value="templates" className="mx-auto w-full max-w-[96rem] p-3 sm:p-6" keepMounted>
        <TemplatesTab active={tab === "templates"} templates={templates} brands={brands} items={batch.items} refresh={refresh} rules={rules} focus={focusTemplate} />
      </TabsContent>

      <TabsContent value="rules" className="mx-auto w-full max-w-7xl p-3 sm:p-6">
        <RulesTab rules={rules} templates={templates} items={batch.items} refresh={refresh} />
      </TabsContent>

      <TabsContent value="brands" className="mx-auto w-full max-w-7xl p-3 sm:p-6">
        <BrandsTab brands={brands} refresh={async () => { await refresh(); }} focusBrand={focusBrand} />
      </TabsContent>

      <TabsContent value="make" className="mx-auto grid w-full max-w-7xl grid-cols-1 items-start gap-4 p-3 pb-16 sm:p-6 lg:grid-cols-[1fr_20rem]"
        style={{ "--chrome": `${chromeH}px` } as React.CSSProperties}>
        {/* the form and the preview side by side from 768 px (a narrower preview below 1024), so the sign stays
            in view while it is changed; the preview stays under the header while the form scrolls */}
        <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-[minmax(0,1fr)_15rem] lg:col-span-2 lg:grid-cols-[1fr_20rem]">
        {draft && (
          <SignEditor
            draft={draft} set={set} brands={brands} presets={presets} templates={templates} editing={!!editing} editTitle={editTitle} canSubmit={canSubmit}
            onEditTemplate={() => setTab("templates")}
            onSubmit={submit} onCancel={cancelEdit}
            onSavePreset={() => { setPresetName(`${draft.collection} ${draft.kind === "price" ? `$${draft.price}` : `${draft.percent}%`}`); setPresetDialog(true); }}
            onPickPreset={(p) => { setDraft({ ...p.sign, id: editing ?? uid(), copies: draft.copies }); }}
            onDeletePreset={deletePreset}
          />
        )}

        <Card className="md:sticky md:top-[calc(var(--chrome)+1rem)]">
          <CardHeader>
            <CardTitle>Live preview</CardTitle>
            <CardDescription>Rendered by the same engine that prints</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex justify-center rounded-lg bg-muted p-3 md:max-lg:p-2">
              <PdfView bytes={singlePdf.pdf?.bytes ?? null} width={narrowPreview ? 192 : 246} label="sign preview" aspect={47 / 70} />
            </div>
            {singlePdf.err && <p className="mt-2 text-sm text-destructive">{singlePdf.err}</p>}
          </CardContent>
        </Card>
        </div>

        <BatchPanel
          batch={batch} update={update} undo={undo} canUndo={canUndo} brands={brands} saved={saved} warnings={warnings} templates={templates}
          editingId={editing} flashId={flashRow} selected={selected} setSelected={setSelected} onEdit={edit}
          onPrint={() => print()} onExport={() => exportPdf()} onCalibrate={calibrate} onFixBg={fixBg}
          onGoToBrand={(id) => { setFocusBrand(id); setTab("brands"); }} refresh={refresh}
          onOpenTemplate={(row) => { setFocusTemplate((f) => ({ row, n: (f?.n ?? 0) + 1 })); setTab("templates"); }}
          calibrated={calibrated} setCalibrated={setCalibrated}
        />

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Print sheet</CardTitle>
            <CardDescription>Click a sign to edit it · drag to rearrange · click an empty slot to add the sign you're building</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <PrintSettings options={batch.options} update={update} onCalibrate={calibrate} />
            {batch.items.length ? (
              <div className="mx-auto w-full max-w-4xl rounded-lg bg-muted p-3">
                <SheetView
                  batch={batch} bytes={sheetPdf.pdf?.bytes ?? null} editingId={editing} selected={selected} warned={warnedRows}
                  onEdit={edit}
                  onMove={(from, to) => update((b) => ({ ...b, items: moveItem(b.items, from, to) }), { undo: "Moved sign" })}
                  onAddHere={() => { if (draft && brand && !editing) submit(); else if (editing) toast("Finish editing first"); }}
                />
              </div>
            ) : (
              <Empty className="border border-dashed"><EmptyHeader><EmptyTitle>The sheet appears here</EmptyTitle></EmptyHeader></Empty>
            )}
            {sheetPdf.err && <p className="text-sm text-destructive">{sheetPdf.err}</p>}
          </CardContent>
        </Card>

        {/* always-reachable finish line: what you're about to print, and the buttons to do it */}
        <div className="sticky bottom-0 z-10 -mx-3 lg:col-span-2 sm:-mx-6" data-slot="print-bar">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t bg-card px-4 py-2 shadow-[0_-4px_12px_-6px_rgb(0_0_0/0.15)] sm:px-6">
            {/* left: what you'd print; while editing, which row the form is changing. From md up it shrinks
                (truncating the label) so the buttons never wrap; on a phone it gets its own line as before. */}
            <div className="flex min-w-0 flex-1 flex-col max-md:basis-full md:basis-0">
              {editTitle ? (
                <>
                  <span data-slot="edit-label" className="truncate text-sm font-medium" title={editTitle}>{editTitle}</span>
                  <span className="truncate text-xs text-muted-foreground tabular-nums">{signCount ? `${count(signCount, "sign")} · ${count(pageCount, "page")}` : "Nothing to print yet"}</span>
                </>
              ) : (
                <>
                  <span className="text-sm font-medium tabular-nums">{signCount ? `${count(signCount, "sign")} · ${count(pageCount, "page")}` : "Nothing to print yet"}</span>
                  <span className="text-xs text-muted-foreground">Print at 100% (“Actual size”) · {g.perPage} per page</span>
                </>
              )}
            </div>
            {/* the form's action is the bar's primary button at every width (same buttons and rules as the sign card) */}
            <div className="ml-auto flex flex-wrap gap-2">
              {draft && <SignFormButtons editing={!!editing} canSubmit={canSubmit} onCancel={cancelEdit} />}
              {/* phone, while editing: icon-only, so Update + Cancel + both still fit on one line (the name stays for screen readers) */}
              <Button type="button" variant="outline" disabled={!signCount} onClick={() => exportPdf()}>
                <DownloadIcon data-icon="inline-start" /><span className={cn(editing && "max-md:sr-only")}>Download PDF</span>
              </Button>
              <Button type="button" variant="secondary" disabled={!signCount} onClick={() => print()}>
                <PrinterIcon data-icon="inline-start" /><span className={cn(editing && "max-md:sr-only")}>Print</span>
              </Button>
            </div>
          </div>
        </div>
      </TabsContent>

        <div id="overlays" />
      </main>

      {/* bottom-centre, just above the sticky print bar on Make signs (Toasts.tsx) */}
      <Toasts theme={resolved} aboveBar={tab === "make"} />

      <AlertDialog open={!!gate} onOpenChange={(o) => !o && setGate(null)}>
        <AlertDialogContent size="lg">
          <AlertDialogHeader>
            <AlertDialogTitle>{count(gate?.small.length ?? 0, "sign")} will print below {rules.readableMin}pt</AlertDialogTitle>
            <AlertDialogDescription render={<div />}>
              <ul className="mt-1 flex list-disc flex-col gap-1 pl-5 text-left">
                {gate?.small.slice(0, 5).map((w, i) => <li key={i}>{w.message.replace(/ Add an abbreviation.*$/, "")}</li>)}
                {(gate?.small.length ?? 0) > 5 && <li>…and {gate!.small.length - 5} more</li>}
              </ul>
              <p className="mt-3">Fix them with an abbreviation on the <button type="button" className="font-medium text-primary underline underline-offset-2" onClick={() => { setGate(null); setTab("rules"); }}>Text rules</button> tab, a shorter name, or a long-name fallback template.</p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button variant="outline" onClick={() => { const a = gate!.action; setGate(null); if (a === "print") print(true); else exportPdf(true); }}>
              {gate?.action === "print" ? "Print anyway" : "Download anyway"}
            </Button>
            <AlertDialogAction onClick={() => { const first = gate?.small[0]?.items[0]; setGate(null); if (first !== undefined) edit(first); }}>Fix first sign</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={presetDialog} onOpenChange={setPresetDialog}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Save as preset</DialogTitle>
            <DialogDescription>Reuse this brand, collection and offer with one click.</DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="pname">Preset name</FieldLabel>
            <Input id="pname" autoFocus value={presetName} onChange={(e) => setPresetName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && savePreset()} />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPresetDialog(false)}>Cancel</Button>
            <Button disabled={!presetName.trim()} onClick={savePreset}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Tabs>
  );
}
