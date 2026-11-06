import { useState } from "react";
import { PlusIcon } from "lucide-react";
import { cellRect, sheetGeometry, slotOwners } from "../../src/core/geometry";
import type { Batch } from "../../src/core/types";
import { PdfView } from "./PdfView";
import { cn } from "@/lib/utils";

/**
 * The real print sheet with an interactive layer: click a sign to edit its row, drag a sign
 * onto another to reorder, click an empty slot to drop the sign you're building into it.
 */
export function SheetView({
  batch, bytes, editingId, selected, warned, onEdit, onMove, onAddHere,
}: {
  batch: Batch; bytes: Uint8Array | null; editingId: string | null; selected: Set<string>; warned: Set<number>;
  onEdit: (item: number) => void; onMove: (from: number, to: number) => void; onAddHere: () => void;
}) {
  const g = sheetGeometry(batch.options);
  const owners = slotOwners(batch.items.map((s) => s.copies));
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const pct = (v: number, of: number) => `${(v / of) * 100}%`;

  const overlay = (page: number) => (
    <div className="absolute inset-0">
      {Array.from({ length: g.perPage }, (_, slot) => {
        const r = cellRect(g, slot);
        const owner = owners[page * g.perPage + slot];
        const style = { left: pct(r.x, g.pageW), top: pct(r.y, g.pageH), width: pct(r.w, g.pageW), height: pct(r.h, g.pageH) };
        if (owner === undefined) {
          return (
            <button
              key={slot}
              type="button"
              aria-label="Add the current sign here"
              style={style}
              className={cn("group absolute flex items-center justify-center rounded-sm border border-dashed border-muted-foreground/40 outline-none transition-colors hover:border-primary hover:bg-primary/5 focus-visible:ring-3 focus-visible:ring-ring/50", over === -1 - slot && "bg-primary/10 ring-2 ring-primary")}
              onClick={onAddHere}
              onDragOver={(e) => { if (drag !== null) { e.preventDefault(); setOver(-1 - slot); } }}
              onDragLeave={() => setOver(null)}
              onDrop={(e) => { e.preventDefault(); if (drag !== null) onMove(drag, batch.items.length - 1); setDrag(null); setOver(null); }}
            >
              <span className="flex size-8 items-center justify-center rounded-full bg-muted text-muted-foreground transition-colors group-hover:bg-primary group-hover:text-primary-foreground group-focus-visible:bg-primary group-focus-visible:text-primary-foreground">
                <PlusIcon className="size-4" />
              </span>
            </button>
          );
        }
        const item = batch.items[owner]!;
        const isEditing = item.id === editingId;
        return (
          <button
            key={slot}
            type="button"
            draggable
            aria-label={`Sign ${owner + 1}: ${item.collection}. Click to edit, drag to move.`}
            style={style}
            className={cn(
              "absolute cursor-grab rounded-sm outline-none transition-[box-shadow,background-color] hover:bg-primary/5 hover:ring-2 hover:ring-primary/40 focus-visible:ring-3 focus-visible:ring-ring/50 active:cursor-grabbing",
              selected.has(item.id) && "bg-primary/10 ring-2 ring-primary/60",
              warned.has(owner) && "ring-2 ring-destructive/60",
              isEditing && "bg-primary/10 ring-3 ring-primary",
              drag === owner && "opacity-40",
              over === owner && drag !== owner && "ring-3 ring-primary bg-primary/15",
            )}
            onClick={() => onEdit(owner)}
            onDragStart={(e) => { setDrag(owner); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(owner)); }}
            onDragEnd={() => { setDrag(null); setOver(null); }}
            onDragOver={(e) => { if (drag !== null) { e.preventDefault(); setOver(owner); } }}
            onDragLeave={() => setOver((o) => (o === owner ? null : o))}
            onDrop={(e) => { e.preventDefault(); if (drag !== null && drag !== owner) onMove(drag, owner); setDrag(null); setOver(null); }}
          />
        );
      })}
    </div>
  );

  return <PdfView bytes={bytes} width="fill" label="print sheet" overlay={overlay} aspect={g.pageW / g.pageH} />;
}
