import { useLayoutEffect, useRef, useState } from "react";
import { XIcon } from "lucide-react";
import { count } from "../../src/core/words";
import type { Preset } from "../../src/core/types";
import { chipsThatFit } from "./chipRows";
import { Button } from "@/components/ui/button";

/** One preset: its name (picks it) and an X (deletes it; the toast can undo). Long names truncate, the full name is the title. */
function Chip({ p, onPick, onDelete }: { p: Preset; onPick?: (p: Preset) => void; onDelete?: (p: Preset) => void }) {
  // the measuring copy (no handlers) carries no names, so it never matches a label anywhere
  const real = !!onPick;
  return (
    <span className="inline-flex max-w-full items-center">
      <Button type="button" variant="secondary" size="sm" className="min-w-0 max-w-48 rounded-r-none" title={real ? p.name : undefined} tabIndex={real ? undefined : -1} onClick={() => onPick?.(p)}>
        <span className="truncate">{p.name}</span>
      </Button>
      <Button type="button" variant="secondary" size="icon-sm" className="rounded-l-none border-l" aria-label={real ? `Delete preset ${p.name}` : undefined} tabIndex={real ? undefined : -1} onClick={() => onDelete?.(p)}><XIcon /></Button>
    </span>
  );
}

/**
 * The preset chips on the sign card: at most two rows. When more don't fit, "Show all N presets"
 * opens the whole list and "Show fewer" closes it again (closed on every visit).
 *
 * How many fit comes from the real layout: an invisible copy of the row (same chips, same width,
 * not focusable, hidden from screen readers) is measured, and chipsThatFit() lays the widths out
 * the way flex-wrap does. It is measured again whenever the row or any chip changes size
 * (window resize, fonts loading, touch sizes).
 */
export function PresetChips({ presets, onPick, onDelete }: { presets: Preset[]; onPick: (p: Preset) => void; onDelete: (p: Preset) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [fit, setFit] = useState(presets.length);
  const row = useRef<HTMLDivElement>(null);
  const measure = useRef<HTMLDivElement>(null);
  const moreText = `Show all ${count(presets.length, "preset")}`;

  useLayoutEffect(() => {
    const line = row.current, m = measure.current;
    if (!line || !m) return;
    const calc = () => {
      const kids = [...m.children] as HTMLElement[];
      const w = (el: HTMLElement) => el.getBoundingClientRect().width;
      const lead = kids[0]!, more = kids[kids.length - 1]!, chips = kids.slice(1, -1);
      const gap = parseFloat(getComputedStyle(m).columnGap) || 0;
      setFit(chipsThatFit({ line: line.clientWidth, gap, lead: w(lead), chips: chips.map(w), more: w(more) }));
    };
    calc();
    const sizes = new ResizeObserver(calc);
    sizes.observe(line);
    for (const k of m.children) sizes.observe(k);
    return () => sizes.disconnect();
  }, [presets, moreText]);

  const capped = fit < presets.length;
  const shown = expanded || !capped ? presets : presets.slice(0, fit);
  return (
    <div ref={row} className="relative flex flex-wrap items-center gap-2" data-slot="preset-chips">
      <span>Presets</span>
      {shown.map((p) => <Chip key={p.id} p={p} onPick={onPick} onDelete={onDelete} />)}
      {capped && (
        <Button type="button" variant="link" size="sm" aria-expanded={expanded} onClick={() => setExpanded((x) => !x)}>
          {expanded ? "Show fewer" : moreText}
        </Button>
      )}
      {/* the measuring copy: lays out like the row above, never seen, never focused */}
      <div ref={measure} aria-hidden inert className="invisible absolute inset-x-0 top-0 flex h-0 flex-wrap items-center gap-2 overflow-hidden">
        <span>Presets</span>
        {presets.map((p) => <Chip key={p.id} p={p} />)}
        <Button type="button" variant="link" size="sm" tabIndex={-1}>{moreText}</Button>
      </div>
    </div>
  );
}
