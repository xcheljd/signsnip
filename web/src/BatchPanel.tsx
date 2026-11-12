import { useRef, useState } from "react";
import { count } from "../../src/core/words";
import {
  ArchiveIcon, CheckIcon, CopyIcon, DownloadIcon, FileDownIcon, FileUpIcon, GripVerticalIcon, InfoIcon, PencilIcon, PrinterIcon, RulerIcon, Trash2Icon,
  TriangleAlertIcon, Undo2Icon, WandSparklesIcon, XIcon,
} from "lucide-react";
import { toast } from "sonner";
import { MAX_PAGES, pageFill, sheetGeometry } from "../../src/core/geometry";
import { money } from "../../src/core/layout";
import { resolveTemplate, withKind, withTemplate } from "../../src/core/template";
import type { Batch, Sign, Template, Warning } from "../../src/core/types";
import * as api from "./api";
import { logoVersion } from "./logoVersion";
import { OpenBatchFile, ShareBatchDialog } from "./BatchFile";
import { NumField } from "./NumField";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Popover, PopoverContent, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { ACTION_LABEL, warningsByRow, type RowWarning, type WarningAction } from "./rowWarnings";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type Update = (fn: (b: Batch) => Batch, opts?: { undo?: string; coalesce?: string }) => boolean | void;
const uid = () => crypto.randomUUID();

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
  onEdit, onPrint, onExport, onCalibrate, onFixBg, onGoToBrand, onOpenTemplate, refresh, calibrated, setCalibrated,
}: {
  batch: Batch; update: Update; undo: () => void; canUndo: boolean;
  brands: api.BrandWithLogo[]; saved: api.SavedSummary[]; warnings: Warning[]; templates: Template[];
  editingId: string | null; selected: Set<string>; setSelected: (s: Set<string>) => void;
  onEdit: (i: number) => void; onPrint: () => void; onExport: () => void; onCalibrate: () => void;
  onFixBg: (brandId: string) => void; onGoToBrand: (brandId: string) => void; onOpenTemplate: (row: number) => void; refresh: () => Promise<unknown>;
  calibrated: boolean; setCalibrated: (v: boolean) => void;
}) {
  const items = batch.items;
  const g = sheetGeometry(batch.options);
  const total = items.reduce((a, s) => a + s.copies, 0);
  const fill = pageFill(total, g.perPage);
  const warnRows = warningsByRow(warnings, brands.map((b) => b.id));
  const act = (a: WarningAction, row: number, brandId: string) => {
    if (a === "remove-background") onFixBg(brandId);
    else if (a === "open-brand") onGoToBrand(brandId);
    else if (a === "open-designer") onOpenTemplate(row);
    else onEdit(row);
  };
  const allSelected = items.length > 0 && items.every((s) => selected.has(s.id));
  const sel = items.filter((s) => selected.has(s.id));
  const [drag, setDrag] = useState<number | null>(null);
  const [overRow, setOverRow] = useState<number | null>(null);

  const patchSelected = (patch: Partial<Sign>, label: string) =>
    update((b) => ({ ...b, items: b.items.map((s) => (selected.has(s.id) ? { ...s, ...patch } : s)) }), { undo: `${label} on ${count(sel.length, "row")}` });
  const setOptions = (patch: Partial<Batch["options"]>) => update((b) => ({ ...b, options: { ...b.options, ...patch } }));

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle>Batch</CardTitle>
        <CardDescription>
          {count(total, "sign")} · {count(total ? fill.pages : 0, "page")}
          {total > 0 && fill.pages >= MAX_PAGES - 2 && <span className="font-medium text-warning"> · {fill.pages} of {MAX_PAGES} pages max</span>}
        </CardDescription>
        <CardAction className="flex gap-2">
          <Button type="button" variant="ghost" size="sm" disabled={!canUndo} onClick={undo}><Undo2Icon data-icon="inline-start" />Undo</Button>
          <SavedBatches batch={batch} saved={saved} update={update} refresh={refresh} />
          <Button type="button" variant="ghost" size="sm" className="text-destructive hover:text-destructive" disabled={!items.length}
            onClick={() => { update((b) => ({ ...b, items: [] }), { undo: `Cleared ${count(items.length, "row")}` }); setSelected(new Set()); }}><Trash2Icon data-icon="inline-start" />Clear</Button>
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

        {warnings.some((w) => w.code === "auto-abbrev" || w.code === "auto-template") && (
          <Alert>
            <CheckIcon />
            <AlertTitle>Auto-fit kept the text readable</AlertTitle>
            <AlertDescription>
              <ul className="flex flex-col gap-0.5">
                {warnings.filter((w) => w.code === "auto-abbrev" || w.code === "auto-template").slice(0, 6).map((w, i) => <li key={i}>{w.message}</li>)}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        {warnings.some((w) => w.code === "spill") && (
          <Alert>
            <InfoIcon />
            <AlertTitle>Tight fits that still print fine</AlertTitle>
            <AlertDescription>
              <ul className="flex flex-col gap-0.5">
                {warnings.filter((w) => w.code === "spill").slice(0, 6).map((w, i) => <li key={i}>{w.message}</li>)}
              </ul>
            </AlertDescription>
            <AlertAction><Button type="button" size="sm" variant="outline" onClick={() => onOpenTemplate(warnings.find((w) => w.code === "spill")!.items[0]!)}>See it in the designer</Button></AlertAction>
          </Alert>
        )}

        {warnings.filter((w) => w.level === "warn").map((w, i) => (
          <Alert key={i} variant="destructive">
            <TriangleAlertIcon />
            <AlertDescription>{w.message}</AlertDescription>
            <AlertAction>
              {w.code === "logo-background" && <Button type="button" size="sm" variant="outline" onClick={() => onFixBg(w.brandId)}><WandSparklesIcon data-icon="inline-start" />Remove background</Button>}
              {(w.code === "low-res-logo" || w.code === "no-logo") && brands.some((b) => b.id === w.brandId) && <Button type="button" size="sm" variant="outline" onClick={() => onGoToBrand(w.brandId)}>Open brand</Button>}
              {w.code === "small-text" && /too big for its box/.test(w.message) && <Button type="button" size="sm" variant="outline" onClick={() => onOpenTemplate(w.items[0]!)}>See it in the designer</Button>}
              {(w.code === "small-text" || w.code === "was-price" || w.code === "kind-mismatch") && <Button type="button" size="sm" variant="outline" onClick={() => onEdit(w.items[0]!)}>Edit sign</Button>}
            </AlertAction>
          </Alert>
        ))}

        {items.length === 0 ? (
          <Empty className="border border-dashed">
            <EmptyHeader>
              <EmptyTitle>Nothing in the batch yet</EmptyTitle>
              <EmptyDescription>Build a sign above and press Enter, or load a saved batch.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            {sel.length > 0 && (
              <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-muted/50 p-3">
                <div className="flex h-8 items-center gap-2 text-sm font-medium">
                  {count(sel.length, "row")} selected
                  <IconButton label="Clear selection" onClick={() => setSelected(new Set())}><XIcon /></IconButton>
                </div>
                <Separator orientation="vertical" className="h-8" />
                <BulkNumber label="Percent" after="%" emptyStart={50} min={1} max={99} onApply={(n) => update((b) => ({ ...b, items: b.items.map((s) => (selected.has(s.id) ? { ...withKind(s, "percent", templates), percent: n } : s)) }), { undo: `Set ${n}% off on ${count(sel.length, "row")}` })} />
                <BulkNumber label="Price" className="w-40 pointer-coarse:w-48" before="$" decimals={2} emptyStart={100} min={0.01} max={999999} onApply={(n) => update((b) => ({ ...b, items: b.items.map((s) => (selected.has(s.id) ? { ...withKind(s, "price", templates), price: n } : s)) }), { undo: `Set price ${money(n)} on ${count(sel.length, "row")}` })} />
                <BulkNumber label="Copies" emptyStart={1} min={1} max={200} onApply={(n) => patchSelected({ copies: n }, `Set ${n} copies`)} />
                <Field className="w-56">
                  <FieldLabel htmlFor="bulk-brand">Brand</FieldLabel>
                  <Select items={brands.map((b) => ({ value: b.id, label: b.name }))} value={null as unknown as string}
                    onValueChange={(v) => v && patchSelected({ brandId: v }, `Brand → ${brands.find((b) => b.id === v)?.name}`)}>
                    <SelectTrigger id="bulk-brand" className="w-full"><SelectValue placeholder="Change to…" /></SelectTrigger>
                    <SelectContent><SelectGroup>{brands.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectGroup></SelectContent>
                  </Select>
                </Field>
                <Field className="w-56">
                  <FieldLabel htmlFor="bulk-template">Template</FieldLabel>
                  <Select items={templates.map((t) => ({ value: t.id, label: t.name }))} value={null as unknown as string}
                    onValueChange={(v) => {
                      const t = templates.find((x) => x.id === v);
                      if (!t) return;
                      update((b) => ({ ...b, items: b.items.map((s) => (selected.has(s.id) ? { ...withTemplate(s, t), price: t.kind === "price" ? (s.price ?? 199) : s.price } : s)) }),
                        { undo: `Template → ${t.name} on ${count(sel.length, "row")}` });
                    }}>
                    <SelectTrigger id="bulk-template" className="w-full"><SelectValue placeholder="Change to…" /></SelectTrigger>
                    <SelectContent><SelectGroup>{templates.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectGroup></SelectContent>
                  </Select>
                </Field>
                <div className="ml-auto flex gap-2">
                  <Button type="button" variant="outline" onClick={() => update((b) => ({ ...b, items: b.items.flatMap((s) => (selected.has(s.id) ? [s, { ...s, id: uid() }] : [s])) }), { undo: `Duplicated ${count(sel.length, "row")}` })}>
                    <CopyIcon data-icon="inline-start" />Duplicate
                  </Button>
                  <Button type="button" variant="destructive" onClick={() => { update((b) => ({ ...b, items: b.items.filter((s) => !selected.has(s.id)) }), { undo: `Removed ${count(sel.length, "row")}` }); setSelected(new Set()); }}>
                    <Trash2Icon data-icon="inline-start" />Remove
                  </Button>
                </div>
              </div>
            )}

            {/* phones: each row reflows into a small card (checkbox · brand · actions / full sign text / qty) */}
            <Table className="max-md:block max-md:[&_tbody]:block max-md:[&_thead]:hidden">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8"><span className="sr-only">Reorder</span></TableHead>
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
                    className={cn("max-md:grid max-md:grid-cols-[auto_minmax(0,1fr)_auto] max-md:items-center max-md:gap-x-2 max-md:gap-y-2 max-md:px-1 max-md:py-3",
                      drag === i && "opacity-40", overRow === i && drag !== i && "border-t-2 border-t-primary")}
                    onDragOver={(e) => { if (drag !== null) { e.preventDefault(); setOverRow(i); } }}
                    onDrop={(e) => { e.preventDefault(); if (drag !== null && drag !== i) update((b) => ({ ...b, items: moveItem(b.items, drag, i) })); setDrag(null); setOverRow(null); }}
                  >
                    <TableCell className="max-md:hidden">
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
                    <TableCell className="max-md:p-0 max-md:pl-1">
                      <Checkbox aria-label={`Select row ${i + 1}`} checked={selected.has(s.id)}
                        onCheckedChange={(c) => { const n = new Set(selected); if (c) n.add(s.id); else n.delete(s.id); setSelected(n); }} />
                    </TableCell>
                    <TableCell className="text-muted-foreground max-md:hidden">{i + 1}</TableCell>
                    <TableCell className="max-md:min-w-0 max-md:p-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground tabular-nums md:hidden">{i + 1}</span>
                        <img className="h-5 w-12 rounded-sm bg-white object-contain px-0.5" src={api.logoUrl(s.brandId, logoVersion(brands.find((b) => b.id === s.brandId)))} alt="" />
                        <span className="truncate">{brands.find((b) => b.id === s.brandId)?.name ?? s.brandId}</span>
                      </div>
                    </TableCell>
                    <TableCell className="max-md:col-span-3 max-md:row-start-2 max-md:p-0 max-md:pl-1 max-md:whitespace-normal">
                      <div className="flex items-center gap-2 max-md:flex-wrap">
                        <span className="uppercase max-md:font-medium">{[s.prefix, s.collection].filter(Boolean).join(" ")}</span>
                        <Badge variant={s.kind === "price" ? "outline" : "secondary"}>{offerText(s)}</Badge>
                        {s.kind === "price" && s.wasPrice && <span className="text-xs text-muted-foreground line-through">{money(s.wasPrice)}</span>}
                        {s.templateId && s.templateId !== s.kind && <Badge variant="outline" className="text-muted-foreground">{resolveTemplate(s, templates).name}</Badge>}
                        {warnRows.has(i) && <RowWarningButton row={i} list={warnRows.get(i)!} act={act} />}
                      </div>
                    </TableCell>
                    <TableCell className="max-md:col-span-3 max-md:row-start-3 max-md:p-0 max-md:pl-1">
                      {/* touch screens from md up: 44 px − / + buttons need a wider box to leave room for 3 digits (max 200) */}
                      <NumField className="h-7 w-24 max-md:w-40 md:pointer-coarse:w-32" stepper={`copies of row ${i + 1}`} stepWords={["Fewer", "More"]} aria-label={`Copies for row ${i + 1}`} value={s.copies} min={1} max={200}
                        onChange={(n) => n && update((b) => ({ ...b, items: b.items.map((x) => (x.id === s.id ? { ...x, copies: n } : x)) }), { coalesce: `qty-${s.id}` })} />
                    </TableCell>
                    <TableCell className="max-md:col-start-3 max-md:row-start-1 max-md:p-0">
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
                        Fill page {p + 1}: {g.perPage - used} more of row {items.length}
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}

      </CardContent>
    </Card>
  );
}

/**
 * The red triangle on a batch row: a button, so a finger can open it too. It opens a popover with
 * the row's warnings and the same fix-it buttons as the warning list above the batch. Mouse users
 * still get the text as a tooltip on hover; the tooltip stays off while the popover is open.
 */
function RowWarningButton({ row, list, act }: { row: number; list: RowWarning[]; act: (a: WarningAction, row: number, brandId: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip disabled={open}>
        <TooltipTrigger render={
          <PopoverTrigger render={<Button type="button" variant="ghost" size="icon-xs" className="text-destructive hover:text-destructive aria-expanded:text-destructive" aria-label={`Warning for row ${row + 1}`} />} />
        }>
          <TriangleAlertIcon />
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">{list.map((w) => w.message).join(" ")}</TooltipContent>
      </Tooltip>
      <PopoverContent align="start" className="w-80 max-w-[calc(100vw-2rem)]">
        <PopoverHeader><PopoverTitle>Row {row + 1} has {count(list.length, "warning")}</PopoverTitle></PopoverHeader>
        <ul className="flex flex-col gap-3">
          {list.map((w, k) => (
            <li key={k} className="flex flex-col gap-2">
              <p>{w.message}</p>
              {w.actions.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {w.actions.map((a) => (
                    <Button key={a} type="button" size="sm" variant="outline" onClick={() => { setOpen(false); act(a, row, w.brandId); }}>
                      {a === "remove-background" && <WandSparklesIcon data-icon="inline-start" />}{ACTION_LABEL[a]}
                    </Button>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

/** Paper, layout, cut lines and the printer check: they describe the print sheet, so they sit on it. */
export function PrintSettings({ options, update, onCalibrate }: { options: Batch["options"]; update: Update; onCalibrate: () => void }) {
  const setOptions = (patch: Partial<Batch["options"]>) => update((b) => ({ ...b, options: { ...b.options, ...patch } }));
  return (
    <div className="flex flex-wrap items-end gap-4">
      <Field className="w-40">
        <FieldLabel htmlFor="paper">Paper</FieldLabel>
        <Select value={options.paper} items={[{ value: "letter", label: "Letter" }, { value: "a4", label: "A4" }]} onValueChange={(v) => v && setOptions({ paper: v as "letter" | "a4" })}>
          <SelectTrigger id="paper" className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent><SelectGroup><SelectItem value="letter">Letter</SelectItem><SelectItem value="a4">A4</SelectItem></SelectGroup></SelectContent>
        </Select>
      </Field>
      <Field className="w-56">
        <FieldLabel htmlFor="grid">Layout</FieldLabel>
        <Select value={options.grid} items={[{ value: "landscape-5x2", label: "Landscape · 5×2 (10/page)" }, { value: "portrait-4x3", label: "Portrait · 4×3 (12/page)" }]}
          onValueChange={(v) => v && setOptions({ grid: v as Batch["options"]["grid"] })}>
          <SelectTrigger id="grid" className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent><SelectGroup><SelectItem value="landscape-5x2">Landscape · 5×2 (10/page)</SelectItem><SelectItem value="portrait-4x3">Portrait · 4×3 (12/page)</SelectItem></SelectGroup></SelectContent>
        </Select>
      </Field>
      <Field orientation="horizontal" className="h-8 w-auto items-center">
        <Checkbox id="cut" checked={options.cutMarks} onCheckedChange={(c) => setOptions({ cutMarks: c === true })} />
        <FieldLabel htmlFor="cut">Cut lines</FieldLabel>
      </Field>
      <Button type="button" variant="outline" className="ml-auto" onClick={onCalibrate}><RulerIcon data-icon="inline-start" />Printer check</Button>
    </div>
  );
}

function BulkNumber({ label, onApply, className = "w-40", ...num }: { label: string; onApply: (n: number) => void; className?: string } & Pick<React.ComponentProps<typeof NumField>, "min" | "max" | "decimals" | "before" | "after" | "emptyStart">) {
  const [v, setV] = useState<number | undefined>(undefined);
  return (
    <Field className="w-auto">
      <FieldLabel htmlFor={`bulk-${label.toLowerCase()}`}>{label}</FieldLabel>
      <div className="flex gap-2">
        <NumField {...num} id={`bulk-${label.toLowerCase()}`} stepper={`bulk ${label.toLowerCase()}`} allowEmpty className={className} value={v} onChange={setV}
          onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === "Enter" && v) { e.preventDefault(); onApply(v); } }} />
        <Button type="button" variant="outline" disabled={!v} onClick={() => v && onApply(v)}>Set</Button>
      </div>
    </Field>
  );
}

function SavedBatches({ batch, saved, update, refresh }: { batch: Batch; saved: api.SavedSummary[]; update: Update; refresh: () => Promise<unknown> }) {
  const [name, setName] = useState("");
  const [open, setOpen] = useState(false);
  const [sharing, setSharing] = useState(false);
  /** the saved batch last loaded or saved here: the default name when sharing */
  const [current, setCurrent] = useState("");
  const sharedFile = useRef<HTMLInputElement>(null);
  const save = async () => {
    if (!name.trim()) return;
    try { await api.saveBatchAs(name.trim(), batch); await refresh(); toast(`Saved “${name.trim()}”`); setCurrent(name.trim()); setName(""); } catch (e) { toast.error((e as Error).message); }
  };
  const load = async (s: api.SavedSummary) => {
    try {
      const full = await api.loadSaved(s.id);
      update(() => full.batch, { undo: `Loaded “${s.name}”` });
      setCurrent(s.name);
      setOpen(false);
    } catch (e) { toast.error((e as Error).message); }
  };
  return (
    <>
    <ShareBatchDialog open={sharing} onClose={() => setSharing(false)} batch={batch} defaultName={current || `Batch ${new Date().toLocaleDateString()}`} />
    <OpenBatchFile fileRef={sharedFile} update={update} refresh={refresh} />
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button type="button" variant="outline" size="sm" />}><ArchiveIcon data-icon="inline-start" />Saved batches</PopoverTrigger>
      <PopoverContent align="end" className="w-80" aria-label="Saved batches">
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
                    <span className="text-xs text-muted-foreground">{count(s.signs, "sign")} · {new Date(s.savedAt).toLocaleDateString()}</span>
                  </button>
                  <IconButton label={`Delete “${s.name}”`} onClick={async () => { await api.deleteSaved(s.id); await refresh(); toast(`Deleted “${s.name}”`); }}><Trash2Icon /></IconButton>
                </div>
              ))}
            </div>
          )}
          <p className="text-xs text-muted-foreground">Loading replaces the current batch. You can undo it.</p>
          <Separator />
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">Send to another device or store</p>
            <div className="flex flex-col gap-2 *:justify-start">
              <Button type="button" variant="outline" size="sm" disabled={!batch.items.length} onClick={() => { setOpen(false); setSharing(true); }}>
                <FileDownIcon data-icon="inline-start" />Share as a file…
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => { setOpen(false); sharedFile.current?.click(); }}>
                <FileUpIcon data-icon="inline-start" />Open a shared file…
              </Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
    </>
  );
}
