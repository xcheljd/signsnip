import { useEffect, useId, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

/**
 * Pick a common word, "None", or type your own: one control instead of a text box plus
 * chips that repeat it. `value === ""` is None. The text box (with `id`) only shows for "Own word".
 */
export function ChoiceOrOwn({
  id, labelId, value, onChange, choices, maxLength = 24, placeholder = "Type it", className,
}: {
  id: string; labelId: string; value: string; onChange: (v: string) => void;
  choices: string[]; maxLength?: number; placeholder?: string; className?: string;
}) {
  const known = (v: string) => v === "" || choices.some((c) => c.toUpperCase() === v.toUpperCase());
  const [own, setOwn] = useState(!known(value));
  const input = useRef<HTMLInputElement>(null);
  const ownId = useId();
  // follow outside changes (presets, editing another sign)
  useEffect(() => { if (!known(value)) setOwn(true); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  const current = own ? "__own" : value === "" ? "__none" : choices.find((c) => c.toUpperCase() === value.toUpperCase()) ?? "__own";
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <ToggleGroup variant="outline" spacing={0} aria-labelledby={labelId} value={[current]}
        onValueChange={(v) => {
          const pick = v[0];
          if (!pick) return;
          if (pick === "__own") { setOwn(true); requestAnimationFrame(() => input.current?.focus()); return; }
          setOwn(false);
          onChange(pick === "__none" ? "" : pick);
        }}>
        {choices.map((c) => <ToggleGroupItem key={c} value={c} type="button">{c}</ToggleGroupItem>)}
        <ToggleGroupItem value="__none" type="button">None</ToggleGroupItem>
        <ToggleGroupItem value="__own" type="button" aria-controls={own ? id : undefined} id={ownId}>Own word</ToggleGroupItem>
      </ToggleGroup>
      {own && (
        <Input ref={input} id={id} className="w-56" value={value} maxLength={maxLength} placeholder={placeholder}
          aria-labelledby={`${labelId} ${ownId}`} onChange={(e) => onChange(e.target.value)} />
      )}
    </div>
  );
}
