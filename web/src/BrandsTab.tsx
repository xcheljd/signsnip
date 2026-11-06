import { useState } from "react";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import type { Brand } from "../../src/core/types";
import * as api from "./api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type Run = (fn: () => Promise<unknown>, ok?: string) => Promise<void>;

export function BrandsTab({ brands, refresh, logoVer }: { brands: Brand[]; refresh: () => Promise<void>; logoVer: number }) {
  const [newName, setNewName] = useState("");
  const run: Run = async (fn, ok) => {
    try { await fn(); await refresh(); if (ok) toast(ok); } catch (e) { toast.error((e as Error).message); }
  };
  const add = () => newName.trim() && run(async () => { await api.saveBrand({ name: newName.trim() }); setNewName(""); }, "Brand added");
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Add a brand</CardTitle>
          <CardDescription>Then drop a logo (PNG, JPG, WebP or SVG) on its card. Empty margins are trimmed automatically and the logo is scaled to fit the sign.</CardDescription>
        </CardHeader>
        <CardContent>
          <InputGroup className="max-w-md">
            <InputGroupInput aria-label="Brand name" placeholder="Brand name" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
            <InputGroupAddon align="inline-end">
              <InputGroupButton variant="default" disabled={!newName.trim()} onClick={add}><PlusIcon data-icon="inline-start" />Add</InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        </CardContent>
      </Card>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(16.5rem,1fr))] gap-4">
        {brands.map((b) => <BrandCard key={b.id} b={b} run={run} logoVer={logoVer} />)}
      </div>
    </div>
  );
}

function BrandCard({ b, run, logoVer }: { b: Brand; run: Run; logoVer: number }) {
  const [name, setName] = useState(b.name);
  const [cols, setCols] = useState(b.collections.join("\n"));
  const [over, setOver] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const upload = (f?: File) => f && run(() => api.uploadLogo(b.id, f), "Logo updated");
  const dirty = name !== b.name || cols !== b.collections.join("\n");
  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <label
          className={cn("flex h-28 cursor-pointer items-center justify-center rounded-lg border-2 border-dashed bg-background p-3 text-center text-sm text-muted-foreground transition-colors", over && "border-primary bg-accent")}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); upload(e.dataTransfer.files[0]); }}
        >
          {b.hasLogo ? <img className="max-h-full max-w-full object-contain" src={`/api/logos/${b.id}?v=${logoVer}`} alt={`${b.name} logo`} /> : <span>Drop a logo here<br />or click to choose</span>}
          <input type="file" accept="image/*" hidden onChange={(e) => upload(e.target.files?.[0])} />
        </label>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor={`n-${b.id}`}>Name</FieldLabel>
            <Input id={`n-${b.id}`} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor={`c-${b.id}`}>Collections</FieldLabel>
            <Textarea id={`c-${b.id}`} rows={5} className="resize-none" value={cols} onChange={(e) => setCols(e.target.value)} />
            <FieldDescription>One per line.</FieldDescription>
          </Field>
        </FieldGroup>
        <div className="flex gap-2">
          <Button disabled={!dirty} onClick={() => run(() => api.saveBrand({ id: b.id, name, collections: cols.split("\n").map((s) => s.trim()).filter(Boolean) }), "Saved")}>Save</Button>
          <Button variant="outline" className="text-destructive" onClick={() => setConfirmDelete(true)}><Trash2Icon data-icon="inline-start" />Delete</Button>
        </div>
      </CardContent>
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {b.name}?</AlertDialogTitle>
            <AlertDialogDescription>Its logo is removed too. Signs already in the batch will print without a logo.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => run(() => api.removeBrand(b.id), "Brand removed")}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
