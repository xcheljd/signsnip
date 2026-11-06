import { useRef } from "react";
import { PencilRulerIcon, PlusIcon, SaveIcon, XIcon } from "lucide-react";
import { resolveTemplate, usedFields } from "../../src/core/template";
import type { Preset, Sign, Template } from "../../src/core/types";
import type { BrandWithLogo } from "./api";
import { ChoiceOrOwn } from "./ChoiceOrOwn";
import { NumField } from "./NumField";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Autocomplete, AutocompleteContent, AutocompleteEmpty, AutocompleteInput, AutocompleteItem, AutocompleteList,
} from "@/components/ui/autocomplete";

const PERCENTS = [10, 20, 25, 30, 40, 50, 60, 70, 75, 80];
const PRICES = [49, 99, 149, 199, 249, 299, 399];
const PRICE_LABELS = ["NOW", "ONLY", "STARTING AT", "UNDER"];

export function SignEditor({
  draft, set, brands, presets, templates, editing, onSubmit, onCancel, onSavePreset, onPickPreset, onDeletePreset, onEditTemplate,
}: {
  draft: Sign; set: (patch: Partial<Sign>) => void; brands: BrandWithLogo[]; presets: Preset[]; templates: Template[]; editing: boolean;
  onEditTemplate: () => void;
  onSubmit: () => void; onCancel: () => void; onSavePreset: () => void;
  onPickPreset: (p: Preset) => void; onDeletePreset: (p: Preset) => void;
}) {
  const brand = brands.find((b) => b.id === draft.brandId);
  const collectionRef = useRef<HTMLInputElement>(null);
  const brandItems = brands.map((b) => ({ value: b.id, label: b.name }));
  const suggestions = ["MODELS", ...(brand?.collections ?? []).filter((c) => c.toUpperCase() !== "MODELS")];
  const template = resolveTemplate(draft, templates);
  const uses = usedFields(template);
  const isPrice = template.kind === "price";
  const templateItems = templates.map((t) => ({ value: t.id, label: t.name }));

  const switchTemplate = (id: string) => {
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    if (t.kind === draft.kind) { set({ templateId: id }); return; }
    if (t.kind === "price") set({ templateId: id, kind: "price", price: draft.price ?? 199, footer: draft.footer === "*MSRP" ? "" : draft.footer });
    else set({ templateId: id, kind: "percent", footer: draft.footer === "" ? "*MSRP" : draft.footer });
  };

  const submit = () => {
    onSubmit();
    // ready for the next sign: jump back to the collection box
    requestAnimationFrame(() => { collectionRef.current?.focus(); collectionRef.current?.select(); });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{editing ? "Editing a sign" : "New sign"}</CardTitle>
        {presets.length > 0 && (
          <CardDescription className="flex flex-wrap items-center gap-2">
            <span>Presets</span>
            {presets.map((p) => (
              <span key={p.id} className="inline-flex items-center">
                <Button type="button" variant="secondary" size="sm" className="rounded-r-none" onClick={() => onPickPreset(p)}>{p.name}</Button>
                <Button type="button" variant="secondary" size="icon-sm" className="rounded-l-none border-l" aria-label={`Delete preset ${p.name}`} onClick={() => onDeletePreset(p)}><XIcon /></Button>
              </span>
            ))}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent>
        <form
          id="sign-form"
          onSubmit={(e) => { e.preventDefault(); if (brand) submit(); }}
          onKeyDown={(e) => { if (e.key === "Escape" && editing && !e.defaultPrevented) onCancel(); }}
        >
          <FieldGroup>
            <div className="grid gap-4 @md/field-group:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="brand">Brand</FieldLabel>
                <Select value={draft.brandId} items={brandItems} onValueChange={(v) => v && set({ brandId: v })}>
                  <SelectTrigger id="brand" className="w-full"><SelectValue placeholder="Pick a brand" /></SelectTrigger>
                  <SelectContent><SelectGroup>{brandItems.map((b) => <SelectItem key={b.value} value={b.value}>{b.label}</SelectItem>)}</SelectGroup></SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="template">Template</FieldLabel>
                <div className="flex gap-1">
                  <Select value={template.id} items={templateItems} onValueChange={(v) => v && switchTemplate(v)}>
                    <SelectTrigger id="template" className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectGroup>{templates.filter((t) => t.kind === "percent").map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectGroup>
                      <SelectGroup>{templates.filter((t) => t.kind === "price").map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectGroup>
                    </SelectContent>
                  </Select>
                  <Button type="button" variant="ghost" size="icon" aria-label="Edit this template" title="Edit this template" onClick={onEditTemplate}><PencilRulerIcon /></Button>
                </div>
              </Field>
            </div>

            {uses.has("prefix") && <Field>
              <FieldLabel id="prefix-label" htmlFor="prefix">Lead word</FieldLabel>
              <ChoiceOrOwn id="prefix" labelId="prefix-label" value={draft.prefix} choices={["SELECT"]} placeholder="e.g. NEW" onChange={(v) => set({ prefix: v })} />
            </Field>}

            {uses.has("collection") && <Field>
              <FieldLabel htmlFor="collection">Collection</FieldLabel>
              <Autocomplete items={suggestions} value={draft.collection} onValueChange={(v) => set({ collection: v })} openOnInputClick modal={false}
                // show the whole list while the box still holds a known collection; filter once you type something else
                filter={(item: string, query: string) => {
                  const q = query.trim().toLowerCase();
                  return !q || suggestions.some((s) => s.toLowerCase() === q) || item.toLowerCase().includes(q);
                }}>
                <AutocompleteInput id="collection" ref={collectionRef} maxLength={60} placeholder="Type or pick a collection" />
                <AutocompleteContent>
                  <AutocompleteEmpty>Press Enter to use “{draft.collection}”</AutocompleteEmpty>
                  <AutocompleteList>
                    {(item: string) => <AutocompleteItem key={item} value={item}>{item}</AutocompleteItem>}
                  </AutocompleteList>
                </AutocompleteContent>
              </Autocomplete>
            </Field>}

            {!isPrice ? (
              <Field>
                  <FieldLabel htmlFor="percent">Percent off</FieldLabel>
                  <div className="flex flex-wrap items-center gap-2">
                    <NumField id="percent" stepper="percent" className="w-40" after="%" value={draft.percent} min={1} max={99} onChange={(n) => n && set({ percent: n })} />
                    <ToggleGroup variant="outline" spacing={1} className="flex-wrap" aria-label="Common percents" value={[String(draft.percent)]}
                      onValueChange={(v) => { if (v[0]) set({ percent: Number(v[0]) }); }}>
                      {PERCENTS.map((p) => <ToggleGroupItem key={p} value={String(p)} type="button">{p}%</ToggleGroupItem>)}
                    </ToggleGroup>
                  </div>
              </Field>
            ) : (
              <>
                <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_10rem]">
                  <Field>
                    <FieldLabel htmlFor="price">Price</FieldLabel>
                    <div className="flex flex-wrap items-center gap-2">
                      <NumField id="price" stepper="price" className="w-40" before="$" decimals={2} value={draft.price} min={0.01} max={999999} onChange={(n) => n && set({ price: n })} />
                      <ToggleGroup variant="outline" spacing={1} className="flex-wrap" aria-label="Common prices" value={[String(draft.price ?? "")]}
                        onValueChange={(v) => { if (v[0]) set({ price: Number(v[0]) }); }}>
                        {PRICES.map((p) => <ToggleGroupItem key={p} value={String(p)} type="button">${p}</ToggleGroupItem>)}
                      </ToggleGroup>
                    </div>
                  </Field>
                  {uses.has("was") && <Field>
                    <FieldLabel htmlFor="was">Was (optional)</FieldLabel>
                    <NumField id="was" stepper="was price" emptyStart={draft.price} before="$" decimals={2} allowEmpty value={draft.wasPrice} min={0.01} max={999999} placeholder="—" onChange={(n) => set({ wasPrice: n })} />
                  </Field>}
                </div>
                {uses.has("label") && <Field>
                    <FieldLabel id="plabel-label" htmlFor="plabel">Above the price</FieldLabel>
                    <ChoiceOrOwn id="plabel" labelId="plabel-label" value={draft.priceLabel} choices={PRICE_LABELS} placeholder="e.g. SALE" onChange={(v) => set({ priceLabel: v })} />
                </Field>}
              </>
            )}

            {(!isPrice || uses.has("footer")) && (
              <div className="grid gap-4 @md/field-group:grid-cols-[14rem_minmax(0,1fr)]">
                {!isPrice && <Field>
                  <FieldLabel htmlFor="off">After the number</FieldLabel>
                  <Input id="off" value={draft.offLabel} maxLength={20} onChange={(e) => set({ offLabel: e.target.value })} />
                </Field>}
                {uses.has("footer") && <Field className={cn(isPrice && "@md/field-group:col-span-2")}>
                  <FieldLabel htmlFor="footer">Footer</FieldLabel>
                  <Input id="footer" value={draft.footer} maxLength={40} placeholder="(none)" onChange={(e) => set({ footer: e.target.value })} />
                </Field>}
              </div>
            )}
          </FieldGroup>
        </form>
      </CardContent>
      <CardFooter className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2">
          <Label htmlFor="copies">Copies</Label>
          <NumField id="copies" form="sign-form" stepper="copies" stepWords={["Fewer", "More"]} className="w-40" value={draft.copies} min={1} max={200} onChange={(n) => n && set({ copies: n })} />
        </div>
        <Button type="submit" form="sign-form" disabled={!brand}>
          {editing ? <SaveIcon data-icon="inline-start" /> : <PlusIcon data-icon="inline-start" />}
          {editing ? "Update sign" : "Add to batch"}
        </Button>
        {editing && <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>}
        <Button type="button" variant="outline" onClick={onSavePreset}>Save as preset</Button>
        <span className="ml-auto hidden items-center gap-1.5 text-xs text-muted-foreground md:flex">
          <Kbd>Enter</Kbd> {editing ? "update" : "add"}
          {editing && <><Kbd>Esc</Kbd> cancel</>}
          <Kbd>Ctrl+Z</Kbd> undo <Kbd>Ctrl+P</Kbd> print
        </span>
      </CardFooter>
    </Card>
  );
}
