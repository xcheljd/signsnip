import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";

/**
 * Number input that lets you type freely (clearing, "5" then "0") and only commits
 * valid values. Clamps on blur. Enter bubbles up so the form can submit.
 */
export function NumField({
  value, onChange, min, max, step = 1, decimals = 0, className, before, after, allowEmpty = false, ...rest
}: {
  value: number | undefined; onChange: (n: number | undefined) => void; min: number; max: number;
  step?: number; decimals?: number; className?: string;
  /** text addons, e.g. "$" before or "%" after (renders an InputGroup) */
  before?: string; after?: string;
  /** clearing the box means "no value" (e.g. optional was-price) */
  allowEmpty?: boolean;
} & Omit<React.ComponentProps<typeof Input>, "value" | "onChange" | "min" | "max" | "step">) {
  const fmt = (n: number | undefined) => (n === undefined ? "" : String(n));
  const [text, setText] = useState(fmt(value));
  useEffect(() => {
    // follow external changes (preset picked, bulk edit) unless the user is mid-edit on the same number
    if (Number(text) !== value || text === "") setText(fmt(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const parse = (t: string) => {
    const n = Number(t.replace(/[$,%\s]/g, ""));
    return t.trim() === "" || !Number.isFinite(n) ? undefined : Number(n.toFixed(decimals));
  };
  const props = {
      inputMode: (decimals ? "decimal" : "numeric") as "decimal" | "numeric",
      value: text,
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
        setText(e.target.value);
        const n = parse(e.target.value);
        if (n === undefined && allowEmpty) onChange(undefined);
        else if (n !== undefined && n >= min && n <= max) onChange(n);
      },
      onBlur: () => {
        const n = parse(text);
        if (n === undefined) { if (!allowEmpty) setText(fmt(value)); return; }
        const c = Math.min(max, Math.max(min, n));
        setText(fmt(c));
        if (c !== value) onChange(c);
      },
      onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault();
          const c = Math.min(max, Math.max(min, Number(((value ?? min) + (e.key === "ArrowUp" ? step : -step)).toFixed(decimals))));
          setText(fmt(c)); onChange(c);
        }
      },
      ...rest,
  };
  if (!before && !after) return <Input className={className} {...props} />;
  return (
    <InputGroup className={className}>
      {before && <InputGroupAddon><InputGroupText>{before}</InputGroupText></InputGroupAddon>}
      <InputGroupInput {...props} />
      {after && <InputGroupAddon align="inline-end"><InputGroupText>{after}</InputGroupText></InputGroupAddon>}
    </InputGroup>
  );
}
