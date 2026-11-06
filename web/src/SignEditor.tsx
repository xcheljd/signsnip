import { useRef } from "react";
import { PlusIcon, SaveIcon, XIcon } from "lucide-react";
import type { Preset, Sign } from "../../src/core/types";
import type { BrandWithLogo } from "./api";
import { NumField } from "./NumField";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
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
  draft, set, brands, presets, editing, onSubmit, onCancel, onSavePreset, onPickPreset, onDeletePreset,
}: {
  draft: Sign; set: (patch: Partial<Sign>) => void; brands: BrandWithLogo[]; presets: Preset[]; editing: boolean;
  onSubmit: () => void; onCancel: () => void; onSavePreset: () => void;
  onPickPreset: (p: Preset) => void; onDeletePreset: (p: Preset) => void;
}) {
  const brand = brands.find((b) => b.id === draft.brandId);
  const collectionRef = useRef<HTMLInputElement>(null);
  const brandItems = brands.map((b) => ({ value: b.id, label: b.name }));
  const suggestions = ["MODELS", ...(brand?.collections ?? []).filter((c) => c.toUpperCase() !== "MODELS")];
  const isPrice = draft.kind === "price";

  const switchKind = (kind: Sign["kind"]) => {
    if (kind === draft.kind) return;
    if (kind === "price") set({ kind, price: draft.price ?? 199, footer: draft.footer === "*MSRP" ? "" : draft.footer });
    else set({ kind, footer: draft.footer === "" ? "*MSRP" : draft.footer });
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
            <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
              <Field>
                <FieldLabel htmlFor="brand">Brand</FieldLabel>
                <Select value={draft.brandId} items={brandItems} onValueChange={(v) => v && set({ brandId: v })}>
                  <SelectTrigger id="brand" className="w-full"><SelectValue placeholder="Pick a brand" /></SelectTrigger>
                  <SelectContent><SelectGroup>{brandItems.map((b) => <SelectItem key={b.value} value={b.value}>{b.label}</SelectItem>)}</SelectGroup></SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel>Sign type</FieldLabel>
                <ToggleGroup variant="outline" spacing={0} value={[draft.kind]} onValueChange={(v) => v[0] && switchKind(v[0] as Sign["kind"])}>
                  <ToggleGroupItem value="percent" type="button">Percent off</ToggleGroupItem>
                  <ToggleGroupItem value="price" type="button">Price</ToggleGroupItem>
                </ToggleGroup>
              </Field>
            </div>

            <Field>
              <FieldLabel htmlFor="prefix">Lead word</FieldLabel>
              <div className="flex flex-wrap items-center gap-2">
                <Input id="prefix" className="w-36" value={draft.prefix} maxLength={24} placeholder="(none)" onChange={(e) => set({ prefix: e.target.value })} />
                <ToggleGroup variant="outline" size="sm" spacing={1} value={[draft.prefix === "SELECT" ? "SELECT" : draft.prefix === "" ? "none" : ""]}
                  onValueChange={(v) => { if (v[0]) set({ prefix: v[0] === "none" ? "" : v[0] }); }}>
                  <ToggleGroupItem value="SELECT" type="button">SELECT</ToggleGroupItem>
                  <ToggleGroupItem value="none" type="button">none</ToggleGroupItem>
                </ToggleGroup>
              </div>
            </Field>

            <Field>
              <FieldLabel htmlFor="collection">Collection</FieldLabel>
              <Autocomplete items={suggestions} value={draft.collection} onValueChange={(v) => set({ collection: v })} openOnInputClick
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
            </Field>

            {!isPrice ? (
              <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
                <Field>
                  <FieldLabel htmlFor="percent">Percent off</FieldLabel>
                  <div className="flex flex-wrap items-center gap-2">
                    <NumField id="percent" className="w-36" after="%" value={draft.percent} min={1} max={99} onChange={(n) => n && set({ percent: n })} />
                    <ToggleGroup variant="outline" size="sm" spacing={1} className="flex-wrap" value={[String(draft.percent)]}
                      onValueChange={(v) => { if (v[0]) set({ percent: Number(v[0]) }); }}>
                      {PERCENTS.map((p) => <ToggleGroupItem key={p} value={String(p)} type="button">{p}%</ToggleGroupItem>)}
                    </ToggleGroup>
                  </div>
                </Field>
                <Field>
                  <FieldLabel htmlFor="off">After the number</FieldLabel>
                  <Input id="off" value={draft.offLabel} maxLength={20} onChange={(e) => set({ offLabel: e.target.value })} />
                </Field>
              </div>
            ) : (
              <>
                <div className="grid gap-4 sm:grid-cols-[1fr_9rem]">
                  <Field>
                    <FieldLabel htmlFor="price">Price</FieldLabel>
                    <div className="flex flex-wrap items-center gap-2">
                      <NumField id="price" className="w-36" before="$" decimals={2} value={draft.price} min={0.01} max={999999} onChange={(n) => n && set({ price: n })} />
                      <ToggleGroup variant="outline" size="sm" spacing={1} className="flex-wrap" value={[String(draft.price ?? "")]}
                        onValueChange={(v) => { if (v[0]) set({ price: Number(v[0]) }); }}>
                        {PRICES.map((p) => <ToggleGroupItem key={p} value={String(p)} type="button">${p}</ToggleGroupItem>)}
                      </ToggleGroup>
                    </div>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="was">Was (optional)</FieldLabel>
                    <NumField id="was" before="$" decimals={2} allowEmpty value={draft.wasPrice} min={0.01} max={999999} placeholder="—" onChange={(n) => set({ wasPrice: n })} />
                  </Field>
                </div>
                <Field>
                    <FieldLabel htmlFor="plabel">Above the price</FieldLabel>
                    <div className="flex flex-wrap items-center gap-2">
                      <Input id="plabel" className="w-36" value={draft.priceLabel} maxLength={24} placeholder="(none)" onChange={(e) => set({ priceLabel: e.target.value })} />
                      <ToggleGroup variant="outline" size="sm" spacing={1} className="flex-wrap" value={[draft.priceLabel.toUpperCase() || "none"]}
                        onValueChange={(v) => { if (v[0]) set({ priceLabel: v[0] === "none" ? "" : v[0] }); }}>
                        <ToggleGroupItem value="none" type="button">none</ToggleGroupItem>
                        {PRICE_LABELS.map((l) => <ToggleGroupItem key={l} value={l} type="button">{l}</ToggleGroupItem>)}
                      </ToggleGroup>
                    </div>
                </Field>
              </>
            )}

            <div className="grid grid-cols-[1fr_6rem] gap-4">
              <Field>
                <FieldLabel htmlFor="footer">Footer</FieldLabel>
                <Input id="footer" value={draft.footer} maxLength={40} placeholder="(none)" onChange={(e) => set({ footer: e.target.value })} />
              </Field>
              <Field>
                <FieldLabel htmlFor="copies">Copies</FieldLabel>
                <NumField id="copies" value={draft.copies} min={1} max={200} onChange={(n) => n && set({ copies: n })} />
              </Field>
            </div>
          </FieldGroup>
        </form>
      </CardContent>
      <CardFooter className="flex flex-wrap items-center gap-2">
        <Button type="submit" form="sign-form" disabled={!brand}>
          {editing ? <SaveIcon data-icon="inline-start" /> : <PlusIcon data-icon="inline-start" />}
          {editing ? "Update sign" : "Add to batch"}
        </Button>
        {editing && <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>}
        <Button type="button" variant="outline" onClick={onSavePreset}>Save as preset</Button>
        <span className="ml-auto hidden items-center gap-1.5 text-xs text-muted-foreground md:flex">
          <Kbd>Enter</Kbd> {editing ? "update" : "add"}
          {editing && <><Kbd>Esc</Kbd> cancel</>}
          <Kbd>Ctrl Z</Kbd> undo <Kbd>Ctrl P</Kbd> print
        </span>
      </CardFooter>
    </Card>
  );
}
