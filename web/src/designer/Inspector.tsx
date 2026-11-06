import {
  AlignCenterIcon, AlignLeftIcon, AlignRightIcon, ArrowDownToLineIcon, ArrowUpToLineIcon, CopyIcon, FoldVerticalIcon,
  ImageIcon, ImagePlusIcon, MoveHorizontalIcon, MoveVerticalIcon, RefreshCwIcon, Trash2Icon, TypeIcon,
} from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import * as api from "../api";
import { FIELD_LABELS, backgroundRect } from "../../../src/core/template";
import { SIGN_H_MM, SIGN_W_MM, TEXT_FIELDS, type Template, type TemplateObject, type TextField, type TextObject } from "../../../src/core/types";
import { NumField } from "../NumField";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldSeparator } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export const objectLabel = (o: TemplateObject) =>
  o.type === "logo" ? "Logo" : o.field === "static" ? `“${o.text || "Fixed text"}”` : FIELD_LABELS[o.field];

const SWATCHES = ["#000000", "#3f3f46", "#b42318", "#1d4ed8", "#15803d"];

function TipButton({ label, children, ...p }: { label: string } & React.ComponentProps<typeof Button>) {
  return (
    <Tooltip>
      <TooltipTrigger render={<Button type="button" variant="outline" size="icon-sm" aria-label={label} {...p} />}>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** X / Y / W / H in mm, plus centre buttons. */
function BoxFields({ o, set }: { o: TemplateObject; set: (p: Partial<TemplateObject>) => void }) {
  const n = (k: "x" | "y" | "w" | "h", label: string, min: number, max: number) => (
    <Field>
      <FieldLabel htmlFor={`box-${k}`}>{label}</FieldLabel>
      <NumField id={`box-${k}`} stepper={label.toLowerCase()} compact after="mm" decimals={1} step={0.5} min={min} max={max} value={o[k]} onChange={(v) => v !== undefined && set({ [k]: v })} />
    </Field>
  );
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        {n("x", "Left", -10, SIGN_W_MM + 10)}
        {n("y", "Top", -10, SIGN_H_MM + 10)}
        {n("w", "Width", o.type === "logo" ? 2 : 1, SIGN_W_MM + 10)}
        {n("h", "Height", o.type === "logo" ? 2 : 1, SIGN_H_MM + 10)}
      </div>
      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => set({ x: Math.round(((SIGN_W_MM - o.w) / 2) * 100) / 100 })}><MoveHorizontalIcon data-icon="inline-start" />Centre across</Button>
        <Button type="button" variant="outline" size="sm" onClick={() => set({ w: SIGN_W_MM - 8, x: 4 })}>Full width</Button>
      </div>
    </>
  );
}

export function ObjectInspector({
  o, set, onDelete, onDuplicate,
}: { o: TemplateObject; set: (p: Partial<TemplateObject>) => void; onDelete: () => void; onDuplicate: () => void }) {
  return (
    <FieldGroup>
      <div className="flex items-center gap-2">
        <span className="flex size-7 items-center justify-center rounded-md bg-muted text-muted-foreground">{o.type === "logo" ? <ImageIcon className="size-4" /> : <TypeIcon className="size-4" />}</span>
        <span className="min-w-0 flex-1 truncate font-medium">{objectLabel(o)}</span>
        <TipButton label="Duplicate (Ctrl+D)" onClick={onDuplicate}><CopyIcon /></TipButton>
        <TipButton label="Delete (Del)" className="text-destructive" onClick={onDelete}><Trash2Icon /></TipButton>
      </div>
      {o.type === "text" ? <TextInspector o={o} set={set} /> : (
        <>
          <BoxFields o={o} set={set} />
          <FieldDescription>The brand's logo is fitted inside this box. Each brand's size slider can still grow it a little.</FieldDescription>
        </>
      )}
    </FieldGroup>
  );
}

function TextInspector({ o, set }: { o: TextObject; set: (p: Partial<TextObject>) => void }) {
  const fieldItems = TEXT_FIELDS.map((f) => ({ value: f, label: FIELD_LABELS[f] }));
  return (
    <>
      <Field>
        <FieldLabel htmlFor="obj-field">Shows</FieldLabel>
        <Select value={o.field} items={fieldItems} onValueChange={(v) => v && set({ field: v as TextField })}>
          <SelectTrigger id="obj-field" className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent><SelectGroup>{fieldItems.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}</SelectGroup></SelectContent>
        </Select>
        {o.field === "heading" && <FieldDescription>Lead word on its own line, then the collection.</FieldDescription>}
      </Field>
      {o.field === "static" && (
        <Field>
          <FieldLabel htmlFor="obj-text">Text</FieldLabel>
          <Input id="obj-text" value={o.text} maxLength={80} placeholder="e.g. FINAL SALE" onChange={(e) => set({ text: e.target.value })} />
        </Field>
      )}

      <FieldSeparator />
      <Field>
        <div className="flex items-center justify-between">
          <FieldLabel htmlFor="obj-size">Font size</FieldLabel>
          <NumField id="obj-size" stepper="font size" className="w-36" after="pt" decimals={1} step={0.5} min={4} max={120} value={o.size} onChange={(v) => v && set({ size: v, minSize: Math.min(o.minSize, v) })} />
        </div>
        <Slider min={6} max={60} step={0.5} value={[Math.min(60, o.size)]} aria-label="Font size" thumbLabel="Font size"
          onValueChange={(v) => { const s = Array.isArray(v) ? v[0]! : (v as number); set({ size: s, minSize: Math.min(o.minSize, s) }); }} />
        <FieldDescription>The size it prints at when the text fits. Longer text shrinks, down to the minimum.</FieldDescription>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field>
          <FieldLabel htmlFor="obj-min">Smallest</FieldLabel>
          <NumField id="obj-min" stepper="smallest size" compact after="pt" decimals={1} step={0.5} min={3} max={o.size} value={o.minSize} onChange={(v) => v && set({ minSize: v })} />
        </Field>
        <Field>
          <FieldLabel htmlFor="obj-lines">Max lines</FieldLabel>
          <NumField id="obj-lines" stepper="max lines" compact min={1} max={5} value={o.maxLines} onChange={(v) => v && set({ maxLines: v })} />
        </Field>
      </div>
      <Field>
        <FieldLabel>Weight</FieldLabel>
        <ToggleGroup variant="outline" size="sm" spacing={0} value={[o.weight]} onValueChange={(v) => v[0] && set({ weight: v[0] as TextObject["weight"] })}>
          <ToggleGroupItem value="bold" className="font-bold">Bold</ToggleGroupItem>
          <ToggleGroupItem value="regular" className="font-normal">Regular</ToggleGroupItem>
        </ToggleGroup>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field>
          <FieldLabel>Align</FieldLabel>
          <ToggleGroup variant="outline" size="sm" spacing={0} value={[o.align]} onValueChange={(v) => v[0] && set({ align: v[0] as TextObject["align"] })}>
            <ToggleGroupItem value="left" aria-label="Align left"><AlignLeftIcon /></ToggleGroupItem>
            <ToggleGroupItem value="center" aria-label="Align centre"><AlignCenterIcon /></ToggleGroupItem>
            <ToggleGroupItem value="right" aria-label="Align right"><AlignRightIcon /></ToggleGroupItem>
          </ToggleGroup>
        </Field>
        <Field>
          <FieldLabel>In the box</FieldLabel>
          <ToggleGroup variant="outline" size="sm" spacing={0} value={[o.vAlign]} onValueChange={(v) => v[0] && set({ vAlign: v[0] as TextObject["vAlign"] })}>
            <ToggleGroupItem value="top" aria-label="Top"><ArrowUpToLineIcon /></ToggleGroupItem>
            <ToggleGroupItem value="middle" aria-label="Middle"><FoldVerticalIcon /></ToggleGroupItem>
            <ToggleGroupItem value="bottom" aria-label="Bottom"><ArrowDownToLineIcon /></ToggleGroupItem>
          </ToggleGroup>
        </Field>
      </div>
      {o.maxLines > 1 && (
        <Field>
          <FieldLabel htmlFor="obj-spacing">Line spacing</FieldLabel>
          <NumField id="obj-spacing" stepper="line spacing" className="w-40" after="%" step={5} min={70} max={250}
            value={Math.round((o.lineSpacing ?? 1) * 100)} onChange={(v) => v && set({ lineSpacing: v / 100 })} />
          <FieldDescription>Space between wrapped lines. 100% is normal; lower packs them tighter, higher spreads them out.</FieldDescription>
        </Field>
      )}
      {o.maxLines > 1 && (
        <Field orientation="horizontal">
          <Switch id="obj-balance" checked={o.balance} onCheckedChange={(c) => set({ balance: c })} />
          <div className="flex flex-col gap-0.5">
            <FieldLabel htmlFor="obj-balance">Balance line breaks</FieldLabel>
            <FieldDescription>Evens out wrapped lines. Same font size, just a tidier shape.</FieldDescription>
          </div>
        </Field>
      )}
      <Field orientation="horizontal">
        <Switch id="obj-upper" checked={o.uppercase} onCheckedChange={(c) => set({ uppercase: c })} />
        <FieldLabel htmlFor="obj-upper">ALL CAPS</FieldLabel>
      </Field>
      <Field orientation="horizontal">
        <Switch id="obj-strike" checked={o.strike} onCheckedChange={(c) => set({ strike: c })} />
        <FieldLabel htmlFor="obj-strike">Strike through</FieldLabel>
      </Field>
      <Field>
        <FieldLabel htmlFor="obj-color">Colour</FieldLabel>
        <div className="flex items-center gap-2">
          {SWATCHES.map((c) => (
            <button key={c} type="button" aria-label={`Colour ${c}`} onClick={() => set({ color: c })}
              className={cn("size-6 rounded-full border-2 outline-none focus-visible:ring-3 focus-visible:ring-ring/50", o.color.toLowerCase() === c ? "border-primary" : "border-transparent ring-1 ring-border")}
              style={{ background: c }} />
          ))}
          <input id="obj-color" type="color" aria-label="Custom colour" value={o.color} onChange={(e) => set({ color: e.target.value })}
            className="size-7 cursor-pointer rounded-md border bg-transparent p-0.5" />
        </div>
      </Field>

      <FieldSeparator />
      <BoxFields o={o} set={set as (p: Partial<TemplateObject>) => void} />
    </>
  );
}

/** Template background picture: add / replace / remove, fill or fit, print strength. */
function BackgroundFields({ t, set }: { t: Template; set: (p: Partial<Template>) => void }) {
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const bg = t.background;
  const pick = async (f?: File) => {
    if (!f) return;
    setBusy(true);
    try {
      const { image, aspect } = await api.uploadBackground(f);
      set({ background: { image, aspect, fit: bg?.fit ?? "cover", opacity: bg?.opacity ?? 0.3 } });
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); if (file.current) file.current.value = ""; }
  };
  const strength = bg ? Math.round(bg.opacity * 100) : 30;
  const r = bg ? backgroundRect(bg) : null;
  return (
    <Field>
      <FieldLabel>Background picture</FieldLabel>
      <input ref={file} type="file" accept="image/*" hidden aria-label="Background picture file" onChange={(e) => pick(e.target.files?.[0])} />
      {!bg || !r ? (
        <>
          <Button type="button" variant="outline" className="w-fit" disabled={busy} onClick={() => file.current?.click()}>
            <ImagePlusIcon data-icon="inline-start" />{busy ? "Adding…" : "Add a picture"}
          </Button>
          <FieldDescription>Prints behind everything on the sign, edge to edge. A pattern or a soft photo works best.</FieldDescription>
        </>
      ) : (
        <>
          <div className="flex items-start gap-3">
            <svg viewBox={`0 0 ${SIGN_W_MM} ${SIGN_H_MM}`} className="h-20 shrink-0 rounded-sm border bg-white" aria-label="Background preview" role="img">
              <clipPath id="bg-inspector-clip"><rect width={SIGN_W_MM} height={SIGN_H_MM} /></clipPath>
              <image href={api.backgroundUrl(bg.image)} x={r.x} y={r.y} width={r.w} height={r.h} preserveAspectRatio="none" opacity={bg.opacity} clipPath="url(#bg-inspector-clip)" />
            </svg>
            <div className="flex flex-col gap-2">
              <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => file.current?.click()}><RefreshCwIcon data-icon="inline-start" />{busy ? "Adding…" : "Replace"}</Button>
              <Button type="button" size="sm" variant="outline" className="text-destructive" onClick={() => set({ background: undefined })}><Trash2Icon data-icon="inline-start" />Remove</Button>
            </div>
          </div>
          <ToggleGroup variant="outline" size="sm" spacing={0} aria-label="Background fit" value={[bg.fit]} onValueChange={(v) => v[0] && set({ background: { ...bg, fit: v[0] as "cover" | "contain" } })}>
            <ToggleGroupItem value="cover">Fill the sign</ToggleGroupItem>
            <ToggleGroupItem value="contain">Whole picture</ToggleGroupItem>
          </ToggleGroup>
          <FieldDescription>{bg.fit === "cover" ? "Covers the whole sign; edges of the picture may be cropped." : "Shows all of the picture; white bands where the shapes differ."}</FieldDescription>
          <div className="flex items-center justify-between gap-3">
            <FieldLabel htmlFor="tpl-bg-strength">Strength</FieldLabel>
            <NumField id="tpl-bg-strength" stepper="background strength" className="w-36" after="%" step={5} min={5} max={100}
              value={strength} onChange={(v) => v && set({ background: { ...bg, opacity: v / 100 } })} />
          </div>
          <Slider min={5} max={100} step={5} value={[strength]} aria-label="Background strength" thumbLabel="Background strength"
            onValueChange={(v) => { const n = Array.isArray(v) ? v[0]! : (v as number); set({ background: { ...bg, opacity: n / 100 } }); }} />
          <FieldDescription className={cn(strength > 50 && "font-medium text-warning")}>
            {strength > 50 ? "Strong: black text may get hard to read. 20–35% is safer." : "How strongly it prints. 20–35% keeps black text easy to read."}
          </FieldDescription>
        </>
      )}
    </Field>
  );
}

export function TemplateInspector({
  t, set, objects, onPick, templates, storeMin,
}: { t: Template; set: (p: Partial<Template>) => void; objects: TemplateObject[]; onPick: (id: string) => void; templates: Template[]; storeMin: number }) {
  const fbItems = [{ value: "none", label: "None (just warn)" }, ...templates.filter((x) => x.id !== t.id && x.kind === t.kind).map((x) => ({ value: x.id, label: x.name }))];
  return (
    <FieldGroup>
      <Field>
        <FieldLabel htmlFor="tpl-name">Template name</FieldLabel>
        <Input id="tpl-name" value={t.name} maxLength={60} onChange={(e) => set({ name: e.target.value })} />
      </Field>
      <Field>
        <FieldLabel>Prints</FieldLabel>
        <ToggleGroup variant="outline" size="sm" spacing={0} value={[t.kind]} onValueChange={(v) => v[0] && set({ kind: v[0] as Template["kind"] })}>
          <ToggleGroupItem value="percent">Percent off</ToggleGroupItem>
          <ToggleGroupItem value="price">A price</ToggleGroupItem>
        </ToggleGroup>
      </Field>
      <Field>
        <FieldLabel htmlFor="tpl-margin">Safe margin</FieldLabel>
        <NumField id="tpl-margin" stepper="safe margin" className="w-40" after="mm" decimals={1} step={0.5} min={0} max={10} value={t.safeMargin} onChange={(v) => v !== undefined && set({ safeMargin: v })} />
        <FieldDescription>The dashed line. Keep things inside it so the holder's edge doesn't cover them.</FieldDescription>
      </Field>
      <BackgroundFields t={t} set={set} />
      <FieldSeparator />
      <Field>
        <FieldLabel htmlFor="tpl-min">Readable minimum</FieldLabel>
        <NumField id="tpl-min" stepper="template readable minimum" emptyStart={storeMin} className="w-40" after="pt" decimals={1} step={0.5} min={4} max={40} allowEmpty placeholder={String(storeMin)}
          value={t.readableMin} onChange={(v) => set({ readableMin: v })} />
        <FieldDescription>Empty = the store setting ({storeMin}pt, on the Text rules tab). Text that would shrink below this gets your abbreviations, then the template below.</FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor="tpl-fallback">If text is still too small, use</FieldLabel>
        <Select value={t.fallbackId && fbItems.some((i) => i.value === t.fallbackId) ? t.fallbackId : "none"} items={fbItems}
          onValueChange={(v) => v && set({ fallbackId: v === "none" ? undefined : v })}>
          <SelectTrigger id="tpl-fallback" className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent><SelectGroup>{fbItems.map((i) => <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>)}</SelectGroup></SelectContent>
        </Select>
        <FieldDescription>A roomier layout for long names, e.g. “Percent off · long name”: taller name box, offer moved down. Only those signs switch.</FieldDescription>
      </Field>
      <FieldSeparator />
      <Field>
        <FieldLabel>Objects</FieldLabel>
        <div className="flex flex-col gap-1">
          {objects.map((o) => (
            <button key={o.id} type="button" onClick={() => onPick(o.id)}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50">
              {o.type === "logo" ? <ImageIcon className="size-4 text-muted-foreground" /> : <TypeIcon className="size-4 text-muted-foreground" />}
              <span className="min-w-0 flex-1 truncate">{objectLabel(o)}</span>
              {o.type === "text" && <span className="text-xs tabular-nums text-muted-foreground">{o.size}pt</span>}
            </button>
          ))}
        </div>
        <FieldDescription><MoveVerticalIcon className="inline size-3" /> Click an object on the sign, or here, to edit it.</FieldDescription>
      </Field>
    </FieldGroup>
  );
}
