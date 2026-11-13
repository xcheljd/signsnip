import { useId, useLayoutEffect, useRef, useState } from "react";
import { count } from "../../src/core/words";
import {
  ArchiveIcon, ChevronDownIcon, CopyIcon, FileDownIcon, FileUpIcon, GripVerticalIcon, ImageOffIcon, InfoIcon, PencilIcon, RulerIcon, Trash2Icon,
  TriangleAlertIcon, Undo2Icon, WandSparklesIcon, XIcon,
} from "lucide-react";
import { toast } from "sonner";
import { MAX_PAGES, pageFill, sheetGeometry } from "../../src/core/geometry";
import { money } from "../../src/core/layout";
import { resolveTemplate, withKind, withTemplate } from "../../src/core/template";
import type { Batch, SavedBatch, Sign, Template, Warning } from "../../src/core/types";
import * as api from "./api";
import { logoThumb } from "./logoThumb";
import { pageMeter } from "./pageMeter";
import { PANEL_LIMIT, lineCount, panelGroups, panelTitle, visibleGroups, type PanelGroup } from "./warningPanel";
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
  batch, update, undo, canUndo, brands, saved, warnings, templates, editingId, flashId, selected, setSelected,
  onEdit, onPrint, onExport, onCalibrate, onFixBg, onGoToBrand, onOpenTemplate, refresh, calibrated, setCalibrated,
}: {
  batch: Batch; update: Update; undo: () => void; canUndo: boolean;
  brands: api.BrandWithLogo[]; saved: api.SavedSummary[]; warnings: Warning[]; templates: Template[];
  /** flashId: the row just updated, highlighted for a moment after the page returns to it */
  editingId: string | null; flashId: string | null; selected: Set<string>; setSelected: (s: Set<string>) => void;
  onEdit: (i: number) => void; onPrint: () => void; onExport: () => void; onCalibrate: () => void;
  onFixBg: (brandId: string) => void; onGoToBrand: (brandId: string) => void; onOpenTemplate: (row: number) => void; refresh: () => Promise<unknown>;
  calibrated: boolean; setCalibrated: (v: boolean) => void;
}) {
  const items = batch.items;
  const g = sheetGeometry(batch.options);
  const total = items.reduce((a, s) => a + s.copies, 0);
  const fill = pageFill(total, g.perPage);
  const meter = pageMeter(total, g.perPage, items.length);
  const headerHeight = useHeaderHeight();
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
  /** the bulk bar's "More" (Brand, Template): stays as it was left while this tab is open */
  const [moreOpen, setMoreOpen] = useState(false);
  const moreId = useId();

  const patchSelected = (patch: Partial<Sign>, label: string) =>
    update((b) => ({ ...b, items: b.items.map((s) => (selected.has(s.id) ? { ...s, ...patch } : s)) }), { undo: `${label} on ${count(sel.length, "row")}` });
  const setOptions = (patch: Partial<Batch["options"]>) => update((b) => ({ ...b, options: { ...b.options, ...patch } }));

  return (
    // overflow-visible: the card's default overflow-hidden would make it the bulk bar's scroll box, and the bar would never stick
    <Card className="overflow-visible lg:col-span-2">
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
          // the buttons sit beside the text while it has room (16rem) and wrap below it otherwise, so the text never runs under them
          <Alert className="has-data-[slot=alert-action]:pr-2.5">
            <RulerIcon />
            <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
              <div className="flex min-w-[min(100%,16rem)] flex-1 flex-col gap-0.5">
                <AlertTitle>First time printing on this printer?</AlertTitle>
                <AlertDescription>Print the one-page printer check and measure the box. If it isn't 47 × 70 mm, your print dialog is shrinking the page.</AlertDescription>
              </div>
              <AlertAction className="static ml-auto flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="outline" onClick={onCalibrate}>Print check page</Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setCalibrated(true)}>My printer is fine</Button>
              </AlertAction>
            </div>
          </Alert>
        )}

        <WarningsPanel groups={panelGroups(warnings, brands.map((b) => b.id))} act={act} />

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
              // From md up the bar sticks just under the app header while the batch card is on screen, so rows
              // picked far down can be changed without scrolling back. The bg-card wrapper is its opaque base
              // (the tinted bar alone would let rows show through); -mt-2/pt-2 keep a strip of it above the bar
              // without moving anything. Phones keep the bar in the flow: there it is several rows tall.
              <div data-slot="bulk-bar-sticky" className="z-[5] bg-card md:sticky md:-mt-2 md:pt-2" style={{ top: headerHeight }}>
              {/* labels sit beside their controls and every control is one height (32 px, 44 px on touch).
                  Brand and Template are used less: they sit behind "More", which opens them in place in the same bar,
                  so the bar takes one row on a wide screen and two on an iPad instead of three or four. */}
              <div data-slot="bulk-bar" className="flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-lg border bg-muted/50 px-2.5 py-1.5">
                <div className="flex items-center gap-0.5 text-sm font-medium">
                  {count(sel.length, "row")} selected
                  <IconButton label="Clear selection" size="icon" onClick={() => setSelected(new Set())}><XIcon /></IconButton>
                </div>
                <BulkNumber label="Percent" className="w-28 pointer-coarse:w-36" after="%" emptyStart={50} min={1} max={99} onApply={(n) => update((b) => ({ ...b, items: b.items.map((s) => (selected.has(s.id) ? { ...withKind(s, "percent", templates), percent: n } : s)) }), { undo: `Set ${n}% off on ${count(sel.length, "row")}` })} />
                <BulkNumber label="Price" className="w-44 pointer-coarse:w-48" before="$" decimals={2} emptyStart={100} min={0.01} max={999999} onApply={(n) => update((b) => ({ ...b, items: b.items.map((s) => (selected.has(s.id) ? { ...withKind(s, "price", templates), price: n } : s)) }), { undo: `Set price ${money(n)} on ${count(sel.length, "row")}` })} />
                <BulkNumber label="Copies" className="w-28 pointer-coarse:w-36" emptyStart={1} min={1} max={200} onApply={(n) => patchSelected({ copies: n }, `Set ${n} copies`)} />
                <Button type="button" variant="ghost" aria-expanded={moreOpen} aria-controls={moreId} onClick={() => setMoreOpen((o) => !o)}>
                  More<ChevronDownIcon data-icon="inline-end" className={cn("transition-transform", moreOpen && "rotate-180")} />
                </Button>
                <div id={moreId} className={cn("contents", !moreOpen && "hidden")}>
                <Field orientation="horizontal" className="w-auto gap-1">
                  <FieldLabel htmlFor="bulk-brand">Brand</FieldLabel>
                  <Select items={brands.map((b) => ({ value: b.id, label: b.name }))} value={null as unknown as string}
                    onValueChange={(v) => v && patchSelected({ brandId: v }, `Brand → ${brands.find((b) => b.id === v)?.name}`)}>
                    <SelectTrigger id="bulk-brand" className="w-44"><SelectValue placeholder="Change to…" /></SelectTrigger>
                    <SelectContent><SelectGroup>{brands.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectGroup></SelectContent>
                  </Select>
                </Field>
                <Field orientation="horizontal" className="w-auto gap-1">
                  <FieldLabel htmlFor="bulk-template">Template</FieldLabel>
                  <Select items={templates.map((t) => ({ value: t.id, label: t.name }))} value={null as unknown as string}
                    onValueChange={(v) => {
                      const t = templates.find((x) => x.id === v);
                      if (!t) return;
                      update((b) => ({ ...b, items: b.items.map((s) => (selected.has(s.id) ? { ...withTemplate(s, t), price: t.kind === "price" ? (s.price ?? 199) : s.price } : s)) }),
                        { undo: `Template → ${t.name} on ${count(sel.length, "row")}` });
                    }}>
                    <SelectTrigger id="bulk-template" className="w-44"><SelectValue placeholder="Change to…" /></SelectTrigger>
                    <SelectContent><SelectGroup>{templates.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectGroup></SelectContent>
                  </Select>
                </Field>
                </div>
                <div className="ml-auto flex gap-1.5">
                  <Button type="button" variant="outline" onClick={() => update((b) => ({ ...b, items: b.items.flatMap((s) => (selected.has(s.id) ? [s, { ...s, id: uid() }] : [s])) }), { undo: `Duplicated ${count(sel.length, "row")}` })}>
                    <CopyIcon data-icon="inline-start" />Duplicate
                  </Button>
                  <Button type="button" variant="destructive" onClick={() => { update((b) => ({ ...b, items: b.items.filter((s) => !selected.has(s.id)) }), { undo: `Removed ${count(sel.length, "row")}` }); setSelected(new Set()); }}>
                    <Trash2Icon data-icon="inline-start" />Remove
                  </Button>
                </div>
              </div>
              </div>
            )}

            {/* phones: each row reflows into a small card (checkbox · brand · actions / full sign text / qty) */}
            {/* From md up the table has a fixed layout, so long names can't push Qty and Actions off the card:
                the narrow columns get set widths (the same as their content needed before; wider on touch, where
                buttons are 44 px), the brand gets 47% of what is left and the sign text the rest (the split
                ordinary names got before). 100cqw = this wrapper's width, i.e. the table's. */}
            <div className="@container">
            <Table className="md:table-fixed max-md:block max-md:[&_tbody]:block max-md:[&_thead]:hidden">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8 pointer-coarse:w-15"><span className="sr-only">Reorder</span></TableHead>
                  <TableHead className="w-8">
                    <Checkbox aria-label="Select all rows" checked={allSelected} indeterminate={!allSelected && sel.length > 0}
                      onCheckedChange={(c) => setSelected(c ? new Set(items.map((s) => s.id)) : new Set())} />
                  </TableHead>
                  <TableHead className="w-8">#</TableHead>
                  <TableHead className="md:w-[calc((100cqw-20rem)*0.47)] md:pointer-coarse:w-[calc((100cqw-26rem)*0.47)]">Brand</TableHead>
                  <TableHead>Sign</TableHead>
                  <TableHead className="w-28 pointer-coarse:w-36">Qty</TableHead>
                  <TableHead className="w-28 pointer-coarse:w-37 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((s, i) => (
                  <TableRow
                    key={s.id}
                    data-row-id={s.id}
                    data-flash={s.id === flashId || undefined}
                    // focusable from script only: after Update/Cancel the page returns focus to the row
                    tabIndex={-1}
                    data-state={s.id === editingId || selected.has(s.id) ? "selected" : undefined}
                    className={cn("outline-none max-md:grid max-md:grid-cols-[auto_minmax(0,1fr)_auto] max-md:items-center max-md:gap-x-2 max-md:gap-y-2 max-md:px-1 max-md:py-3",
                      drag === i && "opacity-40", overRow === i && drag !== i && "border-t-2 border-t-primary",
                      // just updated: a primary tint and ring (not teal: teal means selected)
                      s.id === flashId && "bg-primary/10 ring-2 ring-primary ring-inset")}
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
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="text-xs text-muted-foreground tabular-nums md:hidden">{i + 1}</span>
                        <RowLogo brand={brands.find((b) => b.id === s.brandId)} />
                        <span className="truncate" title={brands.find((b) => b.id === s.brandId)?.name ?? s.brandId}>{brands.find((b) => b.id === s.brandId)?.name ?? s.brandId}</span>
                      </div>
                    </TableCell>
                    <TableCell className="max-md:col-span-3 max-md:row-start-2 max-md:p-0 max-md:pl-1 max-md:whitespace-normal md:whitespace-normal">
                      <div className="flex flex-wrap items-center gap-2">
                        {/* from md up: at most 2 lines (the title holds the whole text). A long text leaves 8rem beside it for the
                            badges, but is never held under 9rem: in a narrower cell the badges move to the next line instead of
                            squeezing it (flex-wrap moves them before anything shrinks). Short texts keep their own width. */}
                        <span className="uppercase max-md:font-medium md:line-clamp-2 md:max-w-[max(calc(100%-8rem),min(100%,9rem))] md:wrap-break-word" title={[s.prefix, s.collection].filter(Boolean).join(" ")}>{[s.prefix, s.collection].filter(Boolean).join(" ")}</span>
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
            </div>

            {meter && (
              <div data-slot="page-meter" className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted-foreground tabular-nums">
                <span>{meter.text}</span>
                {meter.fill && (
                  <Button type="button" size="sm" variant="outline"
                    onClick={() => { const f = meter.fill!; update((b) => ({ ...b, items: b.items.map((x, j) => (j === b.items.length - 1 ? { ...x, copies: x.copies + f.more } : x)) }), { undo: f.undo }); }}>
                    {meter.fill.label}
                  </Button>
                )}
              </div>
            )}
          </>
        )}

      </CardContent>
    </Card>
  );
}

/**
 * How tall the sticky app header is ([data-app-chrome]: it wraps on narrow screens, and the hosted
 * build adds its status bar), so the bulk bar sticks just under it. Re-measured when it changes size.
 */
export function useHeaderHeight() {
  const [h, setH] = useState(0);
  useLayoutEffect(() => {
    const el = document.querySelector<HTMLElement>("[data-app-chrome]");
    if (!el) return;
    const measure = () => setH(Math.ceil(el.getBoundingClientRect().height));
    measure();
    const sizes = new ResizeObserver(measure);
    sizes.observe(el);
    return () => sizes.disconnect();
  }, []);
  return h;
}

/** A batch row's logo thumbnail, or a same-size "no logo" box when the brand has none or was deleted (nothing is requested then). */
function RowLogo({ brand }: { brand: api.BrandWithLogo | undefined }) {
  const t = logoThumb(brand);
  if (t) return <img className="h-5 w-12 shrink-0 rounded-sm bg-white object-contain px-0.5" src={api.logoUrl(t.id, t.version)} alt="" />;
  return (
    <span data-slot="logo-placeholder" title="No logo" aria-hidden
      className="flex h-5 w-12 shrink-0 items-center justify-center rounded-sm border border-dashed text-muted-foreground">
      <ImageOffIcon className="size-3.5" />
    </span>
  );
}

/**
 * Everything to check before printing, in one panel above the batch: warnings grouped under short
 * headings (Logos, Text too small, ...), then the quieter notes (auto-fit, tight fits). Each line keeps
 * its message and its buttons; the buttons wrap below the text when the line is too narrow, so the
 * text never runs under them. More than PANEL_LIMIT lines: the first ones and "Show all N"
 * (closed again on every visit, like the preset chips). warningPanel.ts decides what goes where.
 */
function WarningsPanel({ groups, act }: { groups: PanelGroup[]; act: (a: WarningAction, row: number, brandId: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const titleId = useId();
  const total = lineCount(groups);
  if (!total) return null;
  const shown = visibleGroups(groups, expanded);
  const capped = total > PANEL_LIMIT;
  const anyWarn = groups.some((g) => g.lines.some((l) => l.level === "warn"));
  return (
    <section data-slot="batch-warnings" aria-labelledby={titleId} className="flex flex-col gap-2 rounded-lg border px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {anyWarn ? <TriangleAlertIcon aria-hidden className="size-4 shrink-0 text-destructive" /> : <InfoIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />}
        <p id={titleId} data-slot="warning-title" className="text-sm font-medium">{panelTitle(total)}</p>
        {capped && (
          // -my-1: the link takes no more height than the title line beside it
          <Button type="button" variant="link" size="sm" className="-my-1 ml-auto" aria-expanded={expanded} onClick={() => setExpanded((x) => !x)}>
            {expanded ? "Show fewer" : `Show all ${total}`}
          </Button>
        )}
      </div>
      {/* headings in a narrow column beside their lines from md up; above them on a phone */}
      <div className="grid gap-x-4 gap-y-2 md:grid-cols-[8rem_minmax(0,1fr)]">
        {shown.map((g) => {
          const note = g.lines.every((l) => l.level === "info");
          return (
            <div key={g.id} className="contents">
              <p data-slot="warning-group-title" className={cn("text-xs font-medium md:pt-1.5", note ? "text-muted-foreground" : "text-destructive")}>{g.title}</p>
              <ul className="flex min-w-0 flex-col gap-1" aria-label={g.title}>
                {g.lines.map((l, k) => (
                  <li key={k} data-slot="warning-line" className="flex min-h-7 flex-wrap items-start gap-x-3 gap-y-1">
                    {/* pt-1: the first line of text sits level with the button beside it (28 px; 44 px on touch) */}
                    <p className={cn("min-w-[min(100%,16rem)] flex-1 pt-1 text-sm pointer-coarse:pt-3", l.level === "info" ? "text-muted-foreground" : "text-foreground")}>{l.message}</p>
                    {l.actions.length > 0 && (
                      <div className="ml-auto flex shrink-0 flex-wrap gap-2">
                        {l.actions.map((a) => (
                          <Button key={a} type="button" size="sm" variant="outline" onClick={() => act(a, l.row, l.brandId)}>
                            {a === "remove-background" && <WandSparklesIcon data-icon="inline-start" />}{ACTION_LABEL[a]}
                          </Button>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
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
    <Field orientation="horizontal" className="w-auto gap-1">
      <FieldLabel htmlFor={`bulk-${label.toLowerCase()}`}>{label}</FieldLabel>
      <div className="flex gap-1">
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
  /** One tap deletes; the toast's Undo writes back exactly what was deleted (see restoreSavedBatch for a name reused since). */
  const remove = async (s: api.SavedSummary) => {
    let full: SavedBatch;
    try {
      full = await api.loadSaved(s.id); // the whole thing, kept by the toast for Undo
      await api.deleteSaved(s.id);
      await refresh();
    } catch (e) { toast.error((e as Error).message); return; }
    toast(`Deleted “${s.name}”`, {
      action: {
        label: "Undo",
        onClick: async () => {
          try {
            const back = await api.restoreSaved(full);
            await refresh();
            toast(back.renamed ? `A batch called “${full.name}” was saved since, so the deleted one is back as “${back.name}”` : `“${full.name}” is back`);
          } catch (e) { toast.error(`Couldn't bring back “${full.name}”: ${(e as Error).message}`); }
        },
      },
    });
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
                  <IconButton label={`Delete “${s.name}”`} onClick={() => remove(s)}><Trash2Icon /></IconButton>
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
