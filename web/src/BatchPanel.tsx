import { useState } from "react";
import {
  ArchiveIcon, CopyIcon, DownloadIcon, GripVerticalIcon, PencilIcon, PrinterIcon, RulerIcon, Trash2Icon,
  TriangleAlertIcon, Undo2Icon, WandSparklesIcon, XIcon,
} from "lucide-react";
import { toast } from "sonner";
import { pageFill, sheetGeometry } from "../../src/core/geometry";
import { money } from "../../src/core/layout";
import { resolveTemplate } from "../../src/core/template";
import type { Batch, Sign, Template, Warning } from "../../src/core/types";
import * as api from "./api";
import { NumField } from "./NumField";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type Update = (fn: (b: Batch) => Batch, opts?: { undo?: string; coalesce?: string }) => void;
const uid = () => crypto.randomUUID();
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

export const offerText = (s: Sign) =>
  s.kind === "price" && s.price ? `${s.priceLabel ? s.priceLabel.toUpperCase() + " " : ""}${money(s.price)}` : `${s.percent}%`;

export function moveItem(items: Sign[], from: number, to: number): Sign[] {
  const next = [...items];
  const [x] = next.splice(from, 1);
  next.splice(to, 0, x!);
  return next;
}

function IconButton({ label, children, ...props }: { label: string } & React.ComponentProps<typeof Button>) {
  return (
    <Tooltip>
      <TooltipTrigger render={<Button type="button" variant="ghost" size="icon-sm" aria-label={label} {...props} />}>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function BatchPanel({
  batch, update, undo, canUndo, brands, saved, warnings, templates, editingId, selected, setSelected,
  onEdit, onPrint, onExport, onCalibrate, onFixBg, onGoToBrand, refresh, calibrated, setCalibrated,
}: {
  batch: Batch; update: Update; undo: () => void; canUndo: boolean;
  brands: api.BrandWithLogo[]; saved: api.SavedSummary[]; warnings: Warning[]; templates: Template[];
  editingId: string | null; selected: Set<string>; setSelected: (s: Set<string>) => void;
  onEdit: (i: number) => void; onPrint: () => void; onExport: () => void; onCalibrate: () => void;
  onFixBg: (brandId: string) => void; onGoToBrand: (brandId: string) => void; refresh: () => Promise<unknown>;
  calibrated: boolean; setCalibrated: (v: boolean) => void;
}) {
  const items = batch.items;
  const g = sheetGeometry(batch.options);
  const total = items.reduce((a, s) => a + s.copies, 0);
  const fill = pageFill(total, g.perPage);
  const warnRows = new Map<number, string[]>();
  for (const w of warnings) if (w.level === "warn") for (const i of w.items) warnRows.set(i, [...(warnRows.get(i) ?? []), w.message]);
  const allSelected = items.length > 0 && items.every((s) => selected.has(s.id));
  const sel = items.filter((s) => selected.has(s.id));
  const [drag, setDrag] = useState<number | null>(null);
  const [overRow, setOverRow] = useState<number | null>(null);

  const patchSelected = (patch: Partial<Sign>, label: string) =>
    update((b) => ({ ...b, items: b.items.map((s) => (selected.has(s.id) ? { ...s, ...patch } : s)) }), { undo: `${label} on ${plural(sel.length, "row")}` });
  const setOptions = (patch: Partial<Batch["options"]>) => update((b) => ({ ...b, options: { ...b.options, ...patch } }));

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle>Batch</CardTitle>
        <CardDescription>{plural(total, "sign")} · {plural(fill.pages, "page")} · click any sign on the sheet below to edit it</CardDescription>
        <CardAction className="flex gap-2">
          <Button type="button" variant="ghost" size="sm" disabled={!canUndo} onClick={undo}><Undo2Icon data-icon="inline-start" />Undo</Button>
          <SavedBatches batch={batch} saved={saved} update={update} refresh={refresh} />
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!calibrated && items.length > 0 && (
          <Alert>
            <RulerIcon />
            <AlertTitle>First time printing on this printer?</AlertTitle>
            <AlertDescription>Print the one-page printer check and measure the box. If it isn't 47 × 70 mm, your print dialog is shrinking the page.</AlertDescription>
            <AlertAction className="flex gap-2">
              <Button type="button" size="sm" variant="outline" onClick={onCalibrate}>Print check page</Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setCalibrated(true)}>My printer is fine</Button>
            </AlertAction>
          </Alert>
        )}

        {warnings.filter((w) => w.level === "warn").map((w, i) => (
          <Alert key={i} variant="destructive">
            <TriangleAlertIcon />
            <AlertDescription>{w.message}</AlertDescription>
            <AlertAction>
              {w.code === "logo-background" && <Button type="button" size="sm" variant="outline" onClick={() => onFixBg(w.brandId)}><WandSparklesIcon data-icon="inline-start" />Remove background</Button>}
              {(w.code === "low-res-logo" || w.code === "no-logo") && <Button type="button" size="sm" variant="outline" onClick={() => onGoToBrand(w.brandId)}>Open brand</Button>}
              {w.code === "small-text" && <Button type="button" size="sm" variant="outline" onClick={() => onEdit(w.items[0]!)}>Edit sign</Button>}
            </AlertAction>
          </Alert>
        ))}

        {items.length === 0 ? (
          <Empty className="border border-dashed">
            <EmptyHeader>
              <EmptyTitle>Nothing in the batch yet</EmptyTitle>
              <EmptyDescription>Build a sign above and press Enter, load a saved batch, or run <code>signo add</code> from the terminal.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            {sel.length > 0 && (
              <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-muted/50 p-3">
                <div className="flex h-8 items-center gap-2 text-sm font-medium">
                  {plural(sel.length, "row")} selected
                  <IconButton label="Clear selection" onClick={() => setSelected(new Set())}><XIcon /></IconButton>
                </div>
                <Separator orientation="vertical" className="h-8" />
                <BulkNumber label="Percent" after="%" min={1} max={99} onApply={(n) => patchSelected({ kind: "percent", percent: n }, `Set ${n}% off`)} />
                <BulkNumber label="Price" before="$" decimals={2} min={0.01} max={999999} onApply={(n) => patchSelected({ kind: "price", price: n }, `Set price ${money(n)}`)} />
                <BulkNumber label="Copies" min={1} max={200} onApply={(n) => patchSelected({ copies: n }, `Set ${n} copies`)} />
                <Field className="w-44">
                  <FieldLabel>Brand</FieldLabel>
                  <Select items={brands.map((b) => ({ value: b.id, label: b.name }))} value={null as unknown as string}
                    onValueChange={(v) => v && patchSelected({ brandId: v }, `Brand → ${brands.find((b) => b.id === v)?.name}`)}>
                    <SelectTrigger className="w-full"><SelectValue placeholder="Change to…" /></SelectTrigger>
                    <SelectContent><SelectGroup>{brands.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectGroup></SelectContent>
                  </Select>
                </Field>
                <Field className="w-48">
                  <FieldLabel>Template</FieldLabel>
                  <Select items={templates.map((t) => ({ value: t.id, label: t.name }))} value={null as unknown as string}
                    onValueChange={(v) => {
                      const t = templates.find((x) => x.id === v);
                      if (!t) return;
                      update((b) => ({ ...b, items: b.items.map((s) => (selected.has(s.id) ? { ...s, templateId: t.id, kind: t.kind, price: t.kind === "price" ? (s.price ?? 199) : s.price } : s)) }),
                        { undo: `Template → ${t.name} on ${plural(sel.length, "row")}` });
                    }}>
                    <SelectTrigger className="w-full"><SelectValue placeholder="Change to…" /></SelectTrigger>
                    <SelectContent><SelectGroup>{templates.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectGroup></SelectContent>
                  </Select>
                </Field>
                <div className="ml-auto flex gap-2">
                  <Button type="button" variant="outline" onClick={() => update((b) => ({ ...b, items: b.items.flatMap((s) => (selected.has(s.id) ? [s, { ...s, id: uid() }] : [s])) }), { undo: `Duplicated ${plural(sel.length, "row")}` })}>
                    <CopyIcon data-icon="inline-start" />Duplicate
                  </Button>
                  <Button type="button" variant="destructive" onClick={() => { update((b) => ({ ...b, items: b.items.filter((s) => !selected.has(s.id)) }), { undo: `Removed ${plural(sel.length, "row")}` }); setSelected(new Set()); }}>
                    <Trash2Icon data-icon="inline-start" />Remove
                  </Button>
                </div>
              </div>
            )}

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead className="w-8">
                    <Checkbox aria-label="Select all rows" checked={allSelected} indeterminate={!allSelected && sel.length > 0}
                      onCheckedChange={(c) => setSelected(c ? new Set(items.map((s) => s.id)) : new Set())} />
                  </TableHead>
                  <TableHead className="w-8">#</TableHead>
                  <TableHead>Brand</TableHead>
                  <TableHead>Sign</TableHead>
                  <TableHead className="w-24">Qty</TableHead>
                  <TableHead className="w-28 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((s, i) => (
                  <TableRow
                    key={s.id}
                    data-state={s.id === editingId || selected.has(s.id) ? "selected" : undefined}
                    className={cn(drag === i && "opacity-40", overRow === i && drag !== i && "border-t-2 border-t-primary")}
                    onDragOver={(e) => { if (drag !== null) { e.preventDefault(); setOverRow(i); } }}
                    onDrop={(e) => { e.preventDefault(); if (drag !== null && drag !== i) update((b) => ({ ...b, items: moveItem(b.items, drag, i) })); setDrag(null); setOverRow(null); }}
                  >
                    <TableCell>
                      <span
                        draggable
                        role="button"
                        tabIndex={-1}
                        aria-label={`Drag row ${i + 1}`}
                        className="flex cursor-grab text-muted-foreground active:cursor-grabbing"
                        onDragStart={(e) => { setDrag(i); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(i)); }}
                        onDragEnd={() => { setDrag(null); setOverRow(null); }}
                      >
                        <GripVerticalIcon className="size-4" />
                      </span>
                    </TableCell>
                    <TableCell>
                      <Checkbox aria-label={`Select row ${i + 1}`} checked={selected.has(s.id)}
                        onCheckedChange={(c) => { const n = new Set(selected); if (c) n.add(s.id); else n.delete(s.id); setSelected(n); }} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <img className="h-5 w-12 object-contain" src={`/api/logos/${s.brandId}?v=${brands.find((b) => b.id === s.brandId)?.logo?.width ?? 0}`} alt="" />
                        <span className="truncate">{brands.find((b) => b.id === s.brandId)?.name ?? s.brandId}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="uppercase">{[s.prefix, s.collection].filter(Boolean).join(" ")}</span>
                        <Badge variant={s.kind === "price" ? "outline" : "secondary"}>{offerText(s)}</Badge>
                        {s.kind === "price" && s.wasPrice && <span className="text-xs text-muted-foreground line-through">{money(s.wasPrice)}</span>}
                        {s.templateId && s.templateId !== s.kind && <Badge variant="outline" className="text-muted-foreground">{resolveTemplate(s, templates).name}</Badge>}
                        {warnRows.has(i) && (
                          <Tooltip>
                            <TooltipTrigger render={<span className="text-destructive" />}><TriangleAlertIcon className="size-4" /></TooltipTrigger>
                            <TooltipContent className="max-w-xs">{warnRows.get(i)!.join(" ")}</TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <NumField className="h-7 w-16" aria-label={`Copies for row ${i + 1}`} value={s.copies} min={1} max={200}
                        onChange={(n) => n && update((b) => ({ ...b, items: b.items.map((x) => (x.id === s.id ? { ...x, copies: n } : x)) }), { coalesce: `qty-${s.id}` })} />
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end">
                        <IconButton label="Edit" onClick={() => onEdit(i)}><PencilIcon /></IconButton>
                        <IconButton label="Duplicate" onClick={() => update((b) => ({ ...b, items: [...b.items.slice(0, i + 1), { ...s, id: uid() }, ...b.items.slice(i + 1)] }))}><CopyIcon /></IconButton>
                        <IconButton label="Remove" onClick={() => update((b) => ({ ...b, items: b.items.filter((x) => x.id !== s.id) }), { undo: `Removed row ${i + 1}` })}><Trash2Icon /></IconButton>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: fill.pages }, (_, p) => {
                const used = p === fill.pages - 1 ? fill.lastUsed : g.perPage;
                return (
                  <div key={p} className="flex flex-col gap-2 rounded-lg border p-3">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium">Page {p + 1}</span>
                      <span className={cn("tabular-nums", used < g.perPage ? "text-foreground" : "text-muted-foreground")}>{used}/{g.perPage} slots{used < g.perPage ? ` · ${g.perPage - used} empty` : ""}</span>
                    </div>
                    <Progress value={(used / g.perPage) * 100} aria-label={`Page ${p + 1} fill`} />
                    {used < g.perPage && (
                      <Button type="button" size="sm" variant="outline" className="self-start"
                        onClick={() => update((b) => ({ ...b, items: b.items.map((x, j) => (j === b.items.length - 1 ? { ...x, copies: x.copies + (g.perPage - used) } : x)) }), { undo: `Filled page ${p + 1} with ${g.perPage - used} more of row ${items.length}` })}>
                        Fill with row {items.length} (+{g.perPage - used})
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}

        <div className="flex flex-wrap items-end gap-4">
          <Field className="w-32">
            <FieldLabel htmlFor="paper">Paper</FieldLabel>
            <Select value={batch.options.paper} items={[{ value: "letter", label: "Letter" }, { value: "a4", label: "A4" }]} onValueChange={(v) => v && setOptions({ paper: v as "letter" | "a4" })}>
              <SelectTrigger id="paper" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup><SelectItem value="letter">Letter</SelectItem><SelectItem value="a4">A4</SelectItem></SelectGroup></SelectContent>
            </Select>
          </Field>
          <Field className="w-64">
            <FieldLabel htmlFor="grid">Layout</FieldLabel>
            <Select value={batch.options.grid} items={[{ value: "landscape-5x2", label: "Landscape · 5×2 (10/page)" }, { value: "portrait-4x3", label: "Portrait · 4×3 (12/page)" }]}
              onValueChange={(v) => v && setOptions({ grid: v as Batch["options"]["grid"] })}>
              <SelectTrigger id="grid" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup><SelectItem value="landscape-5x2">Landscape · 5×2 (10/page)</SelectItem><SelectItem value="portrait-4x3">Portrait · 4×3 (12/page)</SelectItem></SelectGroup></SelectContent>
            </Select>
          </Field>
          <Field orientation="horizontal" className="h-8 w-auto items-center">
            <Checkbox id="cut" checked={batch.options.cutMarks} onCheckedChange={(c) => setOptions({ cutMarks: c === true })} />
            <FieldLabel htmlFor="cut">Cut lines</FieldLabel>
          </Field>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button type="button" variant="ghost" className="text-destructive" disabled={!items.length} onClick={() => { update((b) => ({ ...b, items: [] }), { undo: `Cleared ${plural(items.length, "row")}` }); setSelected(new Set()); }}>Clear</Button>
            <Button type="button" variant="outline" onClick={onCalibrate}><RulerIcon data-icon="inline-start" />Printer check</Button>
            <Button type="button" variant="outline" disabled={!items.length} onClick={onExport}><DownloadIcon data-icon="inline-start" />Download PDF</Button>
            <Button type="button" disabled={!items.length} onClick={onPrint}><PrinterIcon data-icon="inline-start" />Print</Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function BulkNumber({ label, onApply, ...num }: { label: string; onApply: (n: number) => void } & Pick<React.ComponentProps<typeof NumField>, "min" | "max" | "decimals" | "before" | "after">) {
  const [v, setV] = useState<number | undefined>(undefined);
  return (
    <Field className="w-36">
      <FieldLabel>{label}</FieldLabel>
      <div className="flex gap-1">
        <NumField {...num} allowEmpty className="min-w-0 flex-1" value={v} onChange={setV}
          onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === "Enter" && v) { e.preventDefault(); onApply(v); } }} />
        <Button type="button" variant="outline" disabled={!v} onClick={() => v && onApply(v)}>Set</Button>
      </div>
    </Field>
  );
}

function SavedBatches({ batch, saved, update, refresh }: { batch: Batch; saved: api.SavedSummary[]; update: Update; refresh: () => Promise<unknown> }) {
  const [name, setName] = useState("");
  const [open, setOpen] = useState(false);
  const save = async () => {
    if (!name.trim()) return;
    try { await api.saveBatchAs(name.trim(), batch); await refresh(); toast(`Saved “${name.trim()}”`); setName(""); } catch (e) { toast.error((e as Error).message); }
  };
  const load = async (s: api.SavedSummary) => {
    try {
      const full = await api.loadSaved(s.id);
      update(() => full.batch, { undo: `Loaded “${s.name}”` });
      setOpen(false);
    } catch (e) { toast.error((e as Error).message); }
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button type="button" variant="outline" size="sm" />}><ArchiveIcon data-icon="inline-start" />Saved batches</PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <div className="flex flex-col gap-3">
          <Field>
            <FieldLabel htmlFor="save-name">Save this batch</FieldLabel>
            <InputGroup>
              <InputGroupInput id="save-name" placeholder="e.g. Holiday sale" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} />
              <InputGroupAddon align="inline-end"><InputGroupButton variant="default" disabled={!name.trim() || !batch.items.length} onClick={save}>Save</InputGroupButton></InputGroupAddon>
            </InputGroup>
          </Field>
          <Separator />
          {saved.length === 0 ? <p className="text-sm text-muted-foreground">No saved batches yet.</p> : (
            <div className="flex max-h-72 flex-col gap-1 overflow-y-auto">
              {saved.map((s) => (
                <div key={s.id} className="flex items-center gap-2 rounded-md p-1 hover:bg-muted">
                  <button type="button" className="flex min-w-0 flex-1 flex-col items-start rounded-sm px-1 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50" onClick={() => load(s)}>
                    <span className="truncate text-sm font-medium">{s.name}</span>
                    <span className="text-xs text-muted-foreground">{plural(s.signs, "sign")} · {new Date(s.savedAt).toLocaleDateString()}</span>
                  </button>
                  <IconButton label={`Delete “${s.name}”`} onClick={async () => { await api.deleteSaved(s.id); await refresh(); toast(`Deleted “${s.name}”`); }}><Trash2Icon /></IconButton>
                </div>
              ))}
            </div>
          )}
          <p className="text-xs text-muted-foreground">Loading replaces the current batch. You can undo it.</p>
        </div>
      </PopoverContent>
    </Popover>
  );
}
