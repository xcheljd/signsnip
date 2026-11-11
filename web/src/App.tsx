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
import { BatchPanel, PrintSettings, moveItem } from "./BatchPanel";
import { BrandsTab } from "./BrandsTab";
import { PdfView } from "./PdfView";
import { downloadPdf, printPdf } from "./print";
import { SheetView } from "./SheetView";
import { SignEditor } from "./SignEditor";
import { useBatch } from "./useBatch";
import { useTheme } from "./theme";
import { DownloadIcon, MonitorIcon, MoonIcon, PlusIcon, PrinterIcon, ScissorsIcon, SunIcon } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Toaster } from "@/components/ui/sonner";
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
const fail = (e: unknown) => toast.error((e as Error).message);

/** What a stored part is called in the damaged-data notice. */
const PART_NAMES: Record<string, string> = { brands: "brands", batch: "the current batch", templates: "templates", presets: "presets", rules: "text rules" };
const partName = (key: string) => (key.startsWith("batches/") ? `the saved batch “${key.slice("batches/".length)}”` : PART_NAMES[key] ?? key);
/** One notice for every part that couldn't be read, or "" when all of it could. */
function problemNotice(problems: NonNullable<api.State["problems"]> = []): string {
  if (!problems.length) return "";
  const many = problems.length > 1;
  // the hosted build can't keep a copy (keptAt is unset there), so it doesn't claim one
  const kept = problems.every((p) => p.keptAt) ? ` and kept ${many ? "copies of the damaged files" : "a copy of the damaged file"}` : "";
  return `Part of your saved data couldn't be read (${problems.map((p) => partName(p.key)).join(", ")}). SignSnip started without it${kept}. Restore a backup to get it back.`;
}
const blank = (brandId: string): Sign => ({
  id: uid(), brandId, kind: "percent", templateId: "percent", prefix: "SELECT", collection: "MODELS", percent: 50, offLabel: "OFF*",
  priceLabel: "", footer: "*MSRP", copies: 1,
});

export function usePdf(items: Sign[], options: Parameters<typeof api.fetchPdf>[1], mode: "sheet" | "single", version = "", templates?: Template[]) {
  const [pdf, setPdf] = useState<api.Pdf | null>(null);
  const [err, setErr] = useState("");
  const key = JSON.stringify([items, options, mode, version]);
  // Only the newest request may set the PDF: an older render that finishes late is dropped.
  const latest = useRef(latestOnly<api.Pdf>()).current;
  useEffect(() => {
    if (!items.length) { latest.cancel(); setPdf(null); setErr(""); return; }
    const t = setTimeout(() => {
      latest.run(() => api.fetchPdf(items, options, mode, templates), (p) => { setPdf(p); setErr(""); }, (e) => setErr(e.message));
    }, 150);
    return () => { latest.cancel(); clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return { pdf, err };
}

/** The hosted build shows a start page on the first visit (blank / samples / restore a backup). */
export function App() {
  const [needStart, setNeedStart] = useState(() => api.needsStart());
  const { resolved } = useTheme();
  if (needStart) return (<><StartPage onDone={() => setNeedStart(false)} /><Toaster position="bottom-right" theme={resolved} /></>);
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

  const shownProblems = useRef("");
  const onRemote = useCallback((s: api.State) => {
    // one fixed toast id, and only when the text changes: polling every 2.5 s must not stack notices
    const notice = problemNotice(s.problems);
    if (notice !== shownProblems.current) {
      shownProblems.current = notice;
      if (notice) toast.error(notice, { id: "data-problems", duration: Infinity }); else toast.dismiss("data-problems");
    }
    setBrands(s.brands); setPresets(s.presets); setSaved(s.saved); setTemplates(s.templates); setRules(s.rules);
    setDraft((d) => d ?? blank(s.brands[0]?.id ?? ""));
  }, []);
  const { batch, update, undo, canUndo, refresh } = useBatch(onRemote);
  useEffect(() => { refresh(true).catch(fail); }, [refresh]);

  // drop selections for rows that no longer exist
  useEffect(() => {
    const ids = new Set(batch.items.map((s) => s.id));
    setSelected((sel) => ([...sel].every((id) => ids.has(id)) ? sel : new Set([...sel].filter((id) => ids.has(id)))));
    if (editing && !ids.has(editing)) setEditing(null);
  }, [batch.items, editing]);

  // pre-print checks (debounced)
  const checkKey = JSON.stringify([batch.items, brands.map((b) => [b.id, b.logoScale, b.logo?.width, b.logo?.background]), templates.map((t) => t.updatedAt), rules]);
  useEffect(() => {
    if (!batch.items.length) { setWarnings([]); return; }
    const t = setTimeout(() => { api.check(batch.items).then(setWarnings).catch((e) => console.error("sign check failed:", e)); }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkKey]);

  const brand = brands.find((b) => b.id === draft?.brandId);
  // a sign whose brand was deleted still previews, as it prints: without a logo (like the sheet and the print check)
  const single = useMemo(() => (draft?.brandId ? [draft] : []), [draft]);
  const logoKey = brands.map((b) => `${b.id}:${b.logoScale}:${b.logo?.width}:${b.logo?.background}`).join("|")
    + templates.map((t) => `${t.id}@${t.updatedAt ?? ""}`).join("|") + JSON.stringify(rules);
  // logoKey: re-render when a logo is replaced, rescaled or has its background removed
  const singlePdf = usePdf(single, batch.options, "single", logoKey);
  const sheetPdf = usePdf(batch.items, batch.options, "sheet", logoKey);

  const set = (patch: Partial<Sign>) => setDraft((d) => (d ? { ...d, ...patch } : d));

  const submit = () => {
    if (!draft) return;
    if (editing) {
      if (update((b) => ({ ...b, items: b.items.map((i) => (i.id === editing ? { ...draft, id: editing } : i)) })) === false) return;
      setEditing(null); setDraft({ ...draft, id: uid() }); toast("Sign updated");
    } else {
      update((b) => ({ ...b, items: [...b.items, { ...draft, id: uid() }] }), { undo: "Added to batch" });
    }
  };
  const edit = (i: number) => {
    const s = batch.items[i];
    if (!s) return;
    setTab("make"); setEditing(s.id); setDraft({ ...s });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const cancelEdit = () => { setEditing(null); setDraft((d) => (d ? { ...d, id: uid() } : d)); };

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
      const p = sheetPdf.pdf ?? await api.fetchPdf(batch.items, batch.options, "sheet");
      printPdf(p.bytes);
      toast(`Printing ${count(p.signs, "sign")}. Set scale to 100% / Actual size.`);
    } catch (e) { fail(e); }
  }, [batch, sheetPdf.pdf]); // eslint-disable-line react-hooks/exhaustive-deps
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
      <div className="sticky top-0 z-10">
      <header className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b bg-card px-4 py-3 shadow-xs sm:px-6">
        <h1 className="flex items-center gap-2 text-lg font-semibold tracking-tight"><ScissorsIcon aria-hidden className="size-5 text-primary" /> SignSnip</h1>
        <TabsList className="order-last w-full overflow-x-auto md:order-none md:w-fit">
          <TabsTrigger value="make">Make signs</TabsTrigger>
          <TabsTrigger value="templates">Templates</TabsTrigger>
          <TabsTrigger value="rules">Text rules</TabsTrigger>
          <TabsTrigger value="brands"><span className="sm:hidden">Brands</span><span className="hidden sm:inline">Brands &amp; logos</span></TabsTrigger>
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
      <TabsContent value="templates" className="mx-auto w-full max-w-[96rem] p-3 sm:p-6" keepMounted>
        <TemplatesTab active={tab === "templates"} templates={templates} brands={brands} items={batch.items} refresh={refresh} rules={rules} focus={focusTemplate} />
      </TabsContent>

      <TabsContent value="rules" className="mx-auto w-full max-w-7xl p-3 sm:p-6">
        <RulesTab rules={rules} templates={templates} items={batch.items} refresh={refresh} />
      </TabsContent>

      <TabsContent value="brands" className="mx-auto w-full max-w-7xl p-3 sm:p-6">
        <BrandsTab brands={brands} refresh={async () => { await refresh(); }} focusBrand={focusBrand} />
      </TabsContent>

      <TabsContent value="make" className="mx-auto grid w-full max-w-7xl grid-cols-1 items-start gap-4 p-3 pb-16 sm:p-6 lg:grid-cols-[1fr_20rem]">
        <div className="grid grid-cols-1 items-start gap-4 lg:col-span-2 lg:grid-cols-[1fr_20rem]">
        {draft && (
          <SignEditor
            draft={draft} set={set} brands={brands} presets={presets} templates={templates} editing={!!editing}
            onEditTemplate={() => setTab("templates")}
            onSubmit={submit} onCancel={cancelEdit}
            onSavePreset={() => { setPresetName(`${draft.collection} ${draft.kind === "price" ? `$${draft.price}` : `${draft.percent}%`}`); setPresetDialog(true); }}
            onPickPreset={(p) => { setDraft({ ...p.sign, id: editing ?? uid(), copies: draft.copies }); }}
            onDeletePreset={async (p) => { await api.removePreset(p.id); await refresh(); toast(`Deleted preset “${p.name}”`); }}
          />
        )}

        <Card className="lg:sticky lg:top-20">
          <CardHeader>
            <CardTitle>Live preview</CardTitle>
            <CardDescription>Rendered by the same engine that prints</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex justify-center rounded-lg bg-muted p-3">
              <PdfView bytes={singlePdf.pdf?.bytes ?? null} width={246} label="sign preview" aspect={47 / 70} />
            </div>
            {singlePdf.err && <p className="mt-2 text-sm text-destructive">{singlePdf.err}</p>}
          </CardContent>
        </Card>
        </div>

        <BatchPanel
          batch={batch} update={update} undo={undo} canUndo={canUndo} brands={brands} saved={saved} warnings={warnings} templates={templates}
          editingId={editing} selected={selected} setSelected={setSelected} onEdit={edit}
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
            <div className="flex min-w-0 flex-col">
              <span className="text-sm font-medium tabular-nums">{signCount ? `${count(signCount, "sign")} · ${count(pageCount, "page")}` : "Nothing to print yet"}</span>
              <span className="text-xs text-muted-foreground">Print at 100% (“Actual size”) · {g.perPage} per page</span>
            </div>
            <div className="ml-auto flex flex-wrap gap-2">
              <Button type="submit" form="sign-form" variant="outline" className="md:hidden" disabled={!brand}>
                <PlusIcon data-icon="inline-start" />{editing ? "Update sign" : "Add to batch"}
              </Button>
              <Button type="button" variant="outline" disabled={!signCount} onClick={() => exportPdf()}><DownloadIcon data-icon="inline-start" />Download PDF</Button>
              <Button type="button" disabled={!signCount} onClick={() => print()}><PrinterIcon data-icon="inline-start" />Print</Button>
            </div>
          </div>
        </div>
      </TabsContent>

        <div id="overlays" />
      </main>

      {/* only the bottom clears the sticky print bar; a plain number would set all four sides and squeeze toasts on a phone */}
      <Toaster position="bottom-right" theme={resolved} offset={tab === "make" ? { bottom: 88 } : 24} mobileOffset={tab === "make" ? { bottom: 120 } : 16} />

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
