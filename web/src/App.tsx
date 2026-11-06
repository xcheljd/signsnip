import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CopyIcon, DownloadIcon, PencilIcon, PlusIcon, SaveIcon, Trash2Icon, XIcon } from "lucide-react";
import { toast } from "sonner";
import type { Batch, Brand, Preset, Sign } from "../../src/core/types";
import * as api from "./api";
import { PdfView } from "./PdfView";
import { BrandsTab } from "./BrandsTab";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const PERCENTS = [10, 20, 25, 30, 40, 50, 60, 70, 75, 80];
const uid = () => crypto.randomUUID();
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const say = (m: string) => toast(m);
const fail = (e: unknown) => toast.error((e as Error).message);

const blank = (brandId: string): Sign => ({
  id: uid(), brandId, prefix: "SELECT", collection: "MODELS", percent: 50, offLabel: "OFF*", footer: "*MSRP", copies: 1,
});

function usePdf(items: Sign[], options: Batch["options"], mode: "sheet" | "single") {
  const [pdf, setPdf] = useState<{ bytes: Uint8Array; pages: number; signs: number } | null>(null);
  const [err, setErr] = useState("");
  const key = JSON.stringify([items, options, mode]);
  useEffect(() => {
    const t = setTimeout(() => {
      api.fetchPdf(items, options, mode).then((p) => { setPdf(p); setErr(""); }).catch((e) => setErr(e.message));
    }, 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return { pdf, err };
}

function IconButton({ label, children, ...props }: { label: string } & React.ComponentProps<typeof Button>) {
  return (
    <Tooltip>
      <TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label={label} {...props} />}>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function App() {
  const [tab, setTab] = useState("make");
  const [brands, setBrands] = useState<Brand[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [batch, setBatch] = useState<Batch>({ items: [], options: { grid: "landscape-5x2", paper: "letter", cutMarks: true } });
  const [draft, setDraft] = useState<Sign | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [logoVer, setLogoVer] = useState(0);
  const [presetDialog, setPresetDialog] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  const serverJson = useRef("");
  const loaded = useRef(false);
  const batchRef = useRef(batch);
  batchRef.current = batch;

  const refresh = useCallback(async (initial = false) => {
    const s = await api.getState();
    setBrands(s.brands); setPresets(s.presets);
    const theirs = JSON.stringify(s.batch);
    // adopt CLI-side changes only when we have nothing unsaved
    if (initial || (theirs !== serverJson.current && JSON.stringify(batchRef.current) === serverJson.current)) {
      serverJson.current = theirs; setBatch(s.batch);
    }
    if (initial) { loaded.current = true; setDraft((d) => d ?? blank(s.brands[0]?.id ?? "")); }
  }, []);

  useEffect(() => { refresh(true).catch(fail); }, [refresh]);
  useEffect(() => {
    const t = setInterval(() => refresh().catch(() => {}), 2500);
    const onFocus = () => refresh().catch(() => {});
    window.addEventListener("focus", onFocus);
    return () => { clearInterval(t); window.removeEventListener("focus", onFocus); };
  }, [refresh]);

  // autosave batch
  useEffect(() => {
    if (!loaded.current) return;
    const mine = JSON.stringify(batch);
    if (mine === serverJson.current) return;
    const t = setTimeout(() => {
      api.putBatch(batch).then(() => { serverJson.current = mine; }).catch(fail);
    }, 300);
    return () => clearTimeout(t);
  }, [batch]);

  const brand = brands.find((b) => b.id === draft?.brandId);
  const single = useMemo(() => (draft && brand ? [draft] : []), [draft, brand]);
  const singlePdf = usePdf(single, batch.options, "single");
  const sheetPdf = usePdf(batch.items, batch.options, "sheet");

  const set = (patch: Partial<Sign>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const setOptions = (patch: Partial<Batch["options"]>) => setBatch((b) => ({ ...b, options: { ...b.options, ...patch } }));
  const addOrUpdate = () => {
    if (!draft) return;
    if (editing) {
      setBatch((b) => ({ ...b, items: b.items.map((i) => (i.id === editing ? { ...draft, id: editing } : i)) }));
      setEditing(null); say("Row updated");
    } else {
      setBatch((b) => ({ ...b, items: [...b.items, { ...draft, id: uid() }] })); say("Added to batch");
    }
  };
  const edit = (s: Sign) => { setEditing(s.id); setDraft({ ...s }); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const patchItem = (id: string, patch: Partial<Sign>) => setBatch((b) => ({ ...b, items: b.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) }));
  const totalSigns = batch.items.reduce((a, s) => a + s.copies, 0);
  const pages = sheetPdf.pdf?.pages ?? 0;

  const exportPdf = async () => {
    try {
      const p = await api.fetchPdf(batch.items, batch.options, "sheet", true);
      const url = URL.createObjectURL(new Blob([p.bytes.slice().buffer], { type: "application/pdf" }));
      const a = Object.assign(document.createElement("a"), { href: url, download: `signs-${new Date().toISOString().slice(0, 10)}.pdf` });
      a.click(); URL.revokeObjectURL(url);
      say(`Exported ${p.signs} signs on ${p.pages} page${p.pages === 1 ? "" : "s"}`);
    } catch (e) { fail(e); }
  };

  const savePreset = async () => {
    if (!draft || !presetName.trim()) return;
    const { id: _id, copies: _c, ...sign } = draft;
    try {
      await api.savePreset({ id: presetName.toLowerCase().replace(/[^a-z0-9]+/g, "-"), name: presetName.trim(), sign });
      await refresh(); setPresetDialog(false); say("Preset saved");
    } catch (e) { fail(e); }
  };

  const brandItems = brands.map((b) => ({ value: b.id, label: b.name }));
  const paperItems = [{ value: "letter", label: "Letter" }, { value: "a4", label: "A4" }];
  const gridItems = [{ value: "landscape-5x2", label: "Landscape · 5×2 (10/page)" }, { value: "portrait-4x3", label: "Portrait · 4×3 (12/page)" }];

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(String(v))} className="min-h-screen gap-0">
      <header className="sticky top-0 z-10 flex items-center gap-5 border-b bg-card px-6 py-3">
        <h1 className="flex items-center gap-2 text-lg font-semibold tracking-tight"><span aria-hidden>🪧</span> Sign-O-Matic</h1>
        <TabsList>
          <TabsTrigger value="make">Make signs</TabsTrigger>
          <TabsTrigger value="brands">Brands &amp; logos</TabsTrigger>
        </TabsList>
        <Badge variant="secondary" className="ml-auto">47 × 70 mm · sample data only</Badge>
      </header>

      <TabsContent value="brands" className="mx-auto w-full max-w-7xl p-6">
        <BrandsTab brands={brands} refresh={async () => { await refresh(); setLogoVer((v) => v + 1); }} logoVer={logoVer} />
      </TabsContent>

      <TabsContent value="make" className="mx-auto grid w-full max-w-7xl grid-cols-1 items-start gap-4 p-6 pb-16 lg:grid-cols-[1fr_20rem]">
        <Card>
          <CardHeader>
            <CardTitle>{editing ? "Editing a row" : "New sign"}</CardTitle>
            {presets.length > 0 && (
              <CardDescription className="flex flex-wrap items-center gap-2">
                <span>Presets</span>
                {presets.map((p) => (
                  <span key={p.id} className="inline-flex items-center">
                    <Button variant="secondary" size="sm" className="rounded-r-none" onClick={() => { setEditing(null); setDraft({ ...p.sign, id: uid(), copies: draft?.copies ?? 1 }); }}>{p.name}</Button>
                    <Button variant="secondary" size="icon-sm" className="rounded-l-none border-l" aria-label={`Delete preset ${p.name}`} onClick={async () => { await api.removePreset(p.id); await refresh(); }}><XIcon /></Button>
                  </span>
                ))}
              </CardDescription>
            )}
          </CardHeader>
          <CardContent>
            {draft && (
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="brand">Brand</FieldLabel>
                  <Select value={draft.brandId} items={brandItems} onValueChange={(v) => v && set({ brandId: v })}>
                    <SelectTrigger id="brand" className="w-full"><SelectValue placeholder="Pick a brand" /></SelectTrigger>
                    <SelectContent><SelectGroup>{brandItems.map((b) => <SelectItem key={b.value} value={b.value}>{b.label}</SelectItem>)}</SelectGroup></SelectContent>
                  </Select>
                </Field>

                <Field>
                  <FieldLabel htmlFor="prefix">Lead word</FieldLabel>
                  <div className="flex flex-wrap items-center gap-2">
                    <Input id="prefix" className="w-48" value={draft.prefix} maxLength={24} placeholder="(none)" onChange={(e) => set({ prefix: e.target.value })} />
                    <ToggleGroup variant="outline" size="sm" spacing={1} value={[draft.prefix === "SELECT" ? "SELECT" : draft.prefix === "" ? "none" : ""]}
                      onValueChange={(v) => { if (v[0]) set({ prefix: v[0] === "none" ? "" : v[0] }); }}>
                      <ToggleGroupItem value="SELECT">SELECT</ToggleGroupItem>
                      <ToggleGroupItem value="none">none</ToggleGroupItem>
                    </ToggleGroup>
                  </div>
                </Field>

                <Field>
                  <FieldLabel htmlFor="collection">Collection</FieldLabel>
                  <Input id="collection" value={draft.collection} maxLength={60} onChange={(e) => set({ collection: e.target.value })} />
                  <ToggleGroup variant="outline" size="sm" spacing={1} className="flex-wrap" value={[draft.collection]}
                    onValueChange={(v) => { if (v[0]) set({ collection: v[0] }); }}>
                    {["MODELS", ...(brand?.collections ?? [])].map((c) => <ToggleGroupItem key={c} value={c}>{c}</ToggleGroupItem>)}
                  </ToggleGroup>
                </Field>

                <Field>
                  <FieldLabel htmlFor="percent">Percent off</FieldLabel>
                  <div className="flex flex-wrap items-center gap-2">
                    <ToggleGroup variant="outline" size="sm" spacing={1} className="flex-wrap" value={[String(draft.percent)]}
                      onValueChange={(v) => { if (v[0]) set({ percent: Number(v[0]) }); }}>
                      {PERCENTS.map((p) => <ToggleGroupItem key={p} value={String(p)}>{p}%</ToggleGroupItem>)}
                    </ToggleGroup>
                    <Input id="percent" type="number" className="w-20" min={1} max={99} value={draft.percent} onChange={(e) => set({ percent: clamp(Number(e.target.value) || 1, 1, 99) })} />
                  </div>
                </Field>

                <div className="grid grid-cols-[1fr_1fr_6rem] gap-3">
                  <Field>
                    <FieldLabel htmlFor="off">After the number</FieldLabel>
                    <Input id="off" value={draft.offLabel} maxLength={20} onChange={(e) => set({ offLabel: e.target.value })} />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="footer">Footer</FieldLabel>
                    <Input id="footer" value={draft.footer} maxLength={40} onChange={(e) => set({ footer: e.target.value })} />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="copies">Copies</FieldLabel>
                    <Input id="copies" type="number" min={1} max={200} value={draft.copies} onChange={(e) => set({ copies: clamp(Number(e.target.value) || 1, 1, 200) })} />
                  </Field>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button onClick={addOrUpdate} disabled={!brand}>
                    {editing ? <SaveIcon data-icon="inline-start" /> : <PlusIcon data-icon="inline-start" />}
                    {editing ? "Update row" : "Add to batch"}
                  </Button>
                  {editing && <Button variant="outline" onClick={() => { setEditing(null); setDraft(blank(draft.brandId)); }}>Cancel</Button>}
                  <Button variant="outline" onClick={() => { setPresetName(`${draft.collection} ${draft.percent}%`); setPresetDialog(true); }}>Save as preset</Button>
                </div>
              </FieldGroup>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Live preview</CardTitle>
            <CardDescription>Rendered by the same engine that prints</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex justify-center rounded-lg bg-muted p-3">
              <PdfView bytes={singlePdf.pdf?.bytes ?? null} width={246} label="sign preview" />
            </div>
            {singlePdf.err && <p className="mt-2 text-sm text-destructive">{singlePdf.err}</p>}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Batch</CardTitle>
            <CardDescription>{totalSigns} sign{totalSigns === 1 ? "" : "s"} · {pages} page{pages === 1 ? "" : "s"}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {batch.items.length === 0 ? (
              <Empty className="border border-dashed">
                <EmptyHeader>
                  <EmptyTitle>Nothing in the batch yet</EmptyTitle>
                  <EmptyDescription>Build a sign above and hit “Add to batch”, or run <code>signo add</code> from the terminal.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow><TableHead className="w-10">#</TableHead><TableHead>Brand</TableHead><TableHead>Sign</TableHead><TableHead className="w-24">Qty</TableHead><TableHead className="w-32" /></TableRow>
                </TableHeader>
                <TableBody>
                  {batch.items.map((s, i) => (
                    <TableRow key={s.id} data-state={editing === s.id ? "selected" : undefined}>
                      <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <img className="h-5 w-12 object-contain" src={`/api/logos/${s.brandId}?v=${logoVer}`} alt="" />
                          {brands.find((b) => b.id === s.brandId)?.name}
                        </div>
                      </TableCell>
                      <TableCell><span className="uppercase">{[s.prefix, s.collection].filter(Boolean).join(" ")}</span> <Badge variant="secondary">{s.percent}%</Badge></TableCell>
                      <TableCell><Input className="h-7 w-16" type="number" min={1} max={200} value={s.copies} onChange={(e) => patchItem(s.id, { copies: clamp(Number(e.target.value) || 1, 1, 200) })} /></TableCell>
                      <TableCell>
                        <div className="flex justify-end">
                          <IconButton label="Edit" onClick={() => edit(s)}><PencilIcon /></IconButton>
                          <IconButton label="Duplicate" onClick={() => setBatch((b) => ({ ...b, items: [...b.items.slice(0, i + 1), { ...s, id: uid() }, ...b.items.slice(i + 1)] }))}><CopyIcon /></IconButton>
                          <IconButton label="Remove" onClick={() => setBatch((b) => ({ ...b, items: b.items.filter((x) => x.id !== s.id) }))}><Trash2Icon /></IconButton>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

            <div className="flex flex-wrap items-end gap-4">
              <Field className="w-32">
                <FieldLabel htmlFor="paper">Paper</FieldLabel>
                <Select value={batch.options.paper} items={paperItems} onValueChange={(v) => v && setOptions({ paper: v as "letter" | "a4" })}>
                  <SelectTrigger id="paper" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectGroup>{paperItems.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectGroup></SelectContent>
                </Select>
              </Field>
              <Field className="w-64">
                <FieldLabel htmlFor="grid">Layout</FieldLabel>
                <Select value={batch.options.grid} items={gridItems} onValueChange={(v) => v && setOptions({ grid: v as Batch["options"]["grid"] })}>
                  <SelectTrigger id="grid" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectGroup>{gridItems.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectGroup></SelectContent>
                </Select>
              </Field>
              <Field orientation="horizontal" className="h-8 w-auto items-center">
                <Checkbox id="cut" checked={batch.options.cutMarks} onCheckedChange={(c) => setOptions({ cutMarks: c === true })} />
                <FieldLabel htmlFor="cut">Cut lines</FieldLabel>
              </Field>
              <div className="ml-auto flex gap-2">
                <Button variant="outline" disabled={!batch.items.length} onClick={() => setConfirmClear(true)}>Clear</Button>
                <Button disabled={!batch.items.length} onClick={exportPdf}><DownloadIcon data-icon="inline-start" />Export PDF</Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Print sheet</CardTitle>
            <CardDescription>Print the exported PDF at 100% (“Actual size”).</CardDescription>
          </CardHeader>
          <CardContent>
            {batch.items.length ? (
              <div className="mx-auto max-w-4xl rounded-lg bg-muted p-3"><PdfView bytes={sheetPdf.pdf?.bytes ?? null} width="fill" label="print sheet" /></div>
            ) : (
              <Empty className="border border-dashed"><EmptyHeader><EmptyTitle>The sheet appears here</EmptyTitle></EmptyHeader></Empty>
            )}
            {sheetPdf.err && <p className="mt-2 text-sm text-destructive">{sheetPdf.err}</p>}
          </CardContent>
        </Card>
      </TabsContent>

      <Dialog open={presetDialog} onOpenChange={setPresetDialog}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Save as preset</DialogTitle>
            <DialogDescription>One click later you can reuse this brand, collection and percent.</DialogDescription>
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

      <AlertDialog open={confirmClear} onOpenChange={setConfirmClear}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear the whole batch?</AlertDialogTitle>
            <AlertDialogDescription>This removes all {batch.items.length} rows. Your brands and presets are not touched.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => { setBatch((b) => ({ ...b, items: [] })); setEditing(null); }}>Clear batch</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Tabs>
  );
}
