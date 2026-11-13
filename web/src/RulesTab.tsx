import { useEffect, useMemo, useRef, useState } from "react";
import { count } from "../../src/core/words";
import { ArrowRightIcon, CheckIcon, PlusIcon, Trash2Icon, TriangleAlertIcon } from "lucide-react";
import { toast } from "sonner";
import { fitSign, resolveTemplate } from "../../src/core/template";
import type { Abbreviation, Rules, Sign, Template } from "../../src/core/types";
import * as api from "./api";
import { browserMeasure, useSignFonts } from "./designer/measure";
import { putBack, sameWord } from "./undoDelete";
import { NumField } from "./NumField";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

/** The Text rules tab while it is on screen: its draft is the newest copy of the rules then. */
let live: { draft: () => Rules; change: (fn: (r: Rules) => Rules) => void } | null = null;

/**
 * Undo an abbreviation removal: put it back at its place. On screen, through the tab's draft (which
 * autosaves); after the tab was left, through the stored rules. If the same word was added again
 * since, nothing is put back and the toast says so (the newer one stays).
 */
async function undoRemove(a: Abbreviation, i: number, refresh: () => Promise<unknown>) {
  const conflict = () => toast(`“${a.from}” was added again since, so the deleted one wasn't put back`);
  try {
    if (live) {
      if (!putBack(live.draft().abbreviations, i, a, sameWord)) return conflict();
      live.change((r) => ({ ...r, abbreviations: putBack(r.abbreviations, i, a, sameWord) ?? r.abbreviations }));
    } else {
      const rules = (await api.getState()).rules;
      const next = putBack(rules.abbreviations, i, a, sameWord);
      if (!next) return conflict();
      await api.saveRules({ ...rules, abbreviations: next });
      await refresh();
    }
    toast(`“${a.from}” is back`);
  } catch (e) {
    toast.error(`Couldn't put “${a.from}” back: ${(e as Error).message}`);
  }
}

/**
 * Store-wide text-fitting rules: the readable minimum and the abbreviation list, with a
 * "try a name" box that runs the exact auto-fit the PDF uses.
 */
export function RulesTab({ rules, templates, items, refresh }: { rules: Rules; templates: Template[]; items: Sign[]; refresh: () => Promise<unknown> }) {
  const [draft, setDraft] = useState<Rules>(rules);
  const dirtyRef = useRef(false);
  useEffect(() => { if (!dirtyRef.current) setDraft(rules); }, [rules]);

  const draftRef = useRef(draft);
  draftRef.current = draft;
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  /** the rules last sent (or on their way), so a hide, a close and the timer never send the same edit twice */
  const sent = useRef<{ rules: Rules; closing: boolean } | null>(null);
  /**
   * Save the newest draft if it has an unsaved change. `closing`: the page is being hidden or closed,
   * so the request must outlive it (an ordinary save of the same draft still on its way is sent again that way).
   */
  const flush = (closing = false) => {
    const d = draftRef.current;
    const s = sent.current;
    if (!dirtyRef.current || (s && s.rules === d && (s.closing || !closing))) return;
    const mark = { rules: d, closing };
    sent.current = mark;
    api.saveRules(d, closing).then(
      // only the newest draft counts as saved: an edit made while this one was on its way still is not
      () => { if (draftRef.current === d) dirtyRef.current = false; return refreshRef.current(); },
      (e: Error) => { if (sent.current === mark) sent.current = null; toast.error(e.message); },
    );
  };
  const flushRef = useRef(flush);
  flushRef.current = flush;

  // autosave (debounced) so the preview, the batch warnings and the PDFs follow immediately
  useEffect(() => {
    if (!dirtyRef.current) return;
    const t = setTimeout(() => flushRef.current(), 400);
    return () => clearTimeout(t);
  }, [draft]);
  // the ref follows at once (not on the next render), so a page closed right after a keystroke saves that keystroke
  const change = (fn: (r: Rules) => Rules) => { dirtyRef.current = true; const next = fn(draftRef.current); draftRef.current = next; setDraft(next); };

  // an edit within the 400 ms above is saved at once when the tab is left (unmount), the page is
  // hidden (another app, the iPad's home screen) or the page is closed, like the batch and brand fields
  useEffect(() => {
    live = { draft: () => draftRef.current, change };
    const hide = () => { if (document.visibilityState === "hidden") flushRef.current(true); };
    const leave = () => flushRef.current(true);
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("pagehide", leave);
    return () => {
      live = null;
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("pagehide", leave);
      flushRef.current();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** One tap removes; the toast's Undo puts that abbreviation back in its place (and nothing else). */
  const remove = (i: number) => {
    const gone = draft.abbreviations[i];
    if (!gone) return;
    change((r) => ({ ...r, abbreviations: r.abbreviations.filter((_, j) => j !== i) }));
    toast(`Deleted “${gone.from}”`, { action: { label: "Undo", onClick: () => void undoRemove(gone, i, refresh) } });
  };

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const add = () => {
    if (!from.trim()) return;
    const exists = draft.abbreviations.some((a) => a.from.toLowerCase() === from.trim().toLowerCase());
    change((r) => ({ ...r, abbreviations: [...r.abbreviations.filter((a) => a.from.toLowerCase() !== from.trim().toLowerCase()), { from: from.trim(), to: to.trim() }] }));
    toast(exists ? `Updated “${from.trim()}”` : `Added “${from.trim()} → ${to.trim() || "(removed)"}”`);
    setFrom(""); setTo("");
    document.getElementById("abbr-from")?.focus();
  };
  const setAbbr = (i: number, patch: Partial<Abbreviation>) =>
    change((r) => ({ ...r, abbreviations: r.abbreviations.map((a, j) => (j === i ? { ...a, ...patch } : a)) }));

  // how many batch signs each rule is currently rescuing
  const fonts = useSignFonts();
  const fitted = useMemo(() => (fonts ? items.map((s) => fitSign(s, templates, browserMeasure, draft)) : []), [fonts, items, templates, draft]);
  const usedBy = (a: Abbreviation) => fitted.filter((f) => f.abbreviations.some((x) => x.from === a.from)).length;
  const stillSmall = fitted.filter((f) => f.belowMin.length).length;

  return (
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[1fr_24rem]">
      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Readable minimum</CardTitle>
            <CardDescription>Text shrinks to fit its box. When it would go below this size, SignSnip tries your abbreviations, then the template's long-name fallback, and only then warns you.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <FieldLabel htmlFor="rules-min">Nothing prints smaller than</FieldLabel>
              <NumField id="rules-min" stepper="readable minimum" className="w-40" after="pt" decimals={1} step={0.5} min={4} max={40} value={draft.readableMin}
                onChange={(v) => v && change((r) => ({ ...r, readableMin: v }))} />
            </div>
            <FieldDescription>
              About 10pt reads from arm's length at the counter; 7pt doesn't. Text you designed smaller on purpose (like a small footer) isn't affected. A template can set its own minimum in the designer.
            </FieldDescription>
            {items.length > 0 && fonts && (
              <p className={cn("flex items-center gap-2 text-sm", stillSmall ? "text-destructive" : "text-muted-foreground")}>
                {stillSmall ? <TriangleAlertIcon className="size-4" /> : <CheckIcon className="size-4" />}
                {stillSmall ? `${count(stillSmall, "sign")} in the batch would still print below the minimum.` : "Every sign in the batch prints at or above the minimum."}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Abbreviations</CardTitle>
            <CardDescription>
              Only used when a name would otherwise print below the minimum, one at a time, biggest savings first, stopping as soon as it fits. Whole words only, any capitalisation. Leave “Short” empty to drop a word.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); add(); }}>
              <Field className="w-full sm:w-56">
                <FieldLabel htmlFor="abbr-from">Word or phrase</FieldLabel>
                <Input id="abbr-from" placeholder="e.g. Moonphase" value={from} maxLength={40} onChange={(e) => setFrom(e.target.value)} />
              </Field>
              <ArrowRightIcon className="mb-2 hidden size-4 text-muted-foreground sm:block" aria-hidden />
              <Field className="w-full sm:w-56">
                <FieldLabel htmlFor="abbr-to">Short</FieldLabel>
                <Input id="abbr-to" placeholder="e.g. Moon" value={to} maxLength={40} onChange={(e) => setTo(e.target.value)} />
              </Field>
              <Button type="submit" disabled={!from.trim()}><PlusIcon data-icon="inline-start" />Add</Button>
            </form>
            {draft.abbreviations.length === 0 ? (
              <Empty className="border border-dashed">
                <EmptyHeader>
                  <EmptyTitle>No abbreviations yet</EmptyTitle>
                  <EmptyDescription>Add the long words your collections use, like Chronograph → Chrono.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              // a list, not a table: on narrow screens each row stacks (word on top; short form, status, remove below)
              <div className="@container/abbr">
                <div className="hidden grid-cols-[minmax(0,1fr)_minmax(0,1fr)_8rem_2rem] gap-2 border-b pb-2 text-xs font-medium text-muted-foreground @lg/abbr:grid" aria-hidden>
                  <span>Word or phrase</span><span>Short</span><span>In this batch</span><span />
                </div>
                <ul className="flex flex-col divide-y" aria-label="Abbreviations">
                  {draft.abbreviations.map((a, i) => {
                    const n = usedBy(a);
                    return (
                      <li key={`${a.from}-${i}`} data-abbr-row="" className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 py-2 @lg/abbr:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_8rem_2rem]">
                        <Input aria-label={`Word ${i + 1}`} className="col-span-3 @lg/abbr:col-span-1" value={a.from} maxLength={40} onChange={(e) => setAbbr(i, { from: e.target.value })} />
                        <Input aria-label={`Short form of ${a.from}`} value={a.to} maxLength={40} placeholder="(removed)" onChange={(e) => setAbbr(i, { to: e.target.value })} />
                        <span className="text-xs">{n ? <Badge variant="secondary">used on {count(n, "sign")}</Badge> : <span className="text-muted-foreground">not needed</span>}</span>
                        <Button type="button" variant="ghost" size="icon-sm" aria-label={`Delete ${a.from}`}
                          onClick={() => remove(i)}><Trash2Icon /></Button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <TryIt rules={draft} templates={templates} />
    </div>
  );
}

/** Type a name, pick a template: shows exactly what auto-fit would print. */
function TryIt({ rules, templates }: { rules: Rules; templates: Template[] }) {
  const fonts = useSignFonts();
  const [name, setName] = useState("Deep Field Chronograph Automatic");
  const [tplId, setTplId] = useState("percent");
  const tpl = templates.find((t) => t.id === tplId) ?? templates[0]!;
  const sign: Sign = { id: "try", brandId: "try", kind: tpl.kind, templateId: tpl.id, prefix: "SELECT", collection: name, percent: 50, offLabel: "OFF*", price: 199, priceLabel: "", footer: "*MSRP", copies: 1 };
  const plain = fonts ? fitSign(sign, templates, browserMeasure, { ...rules, abbreviations: [] }, { template: resolveTemplate(sign, templates), noFallback: true }) : null;
  const f = fonts ? fitSign(sign, templates, browserMeasure, rules) : null;
  const size = (x: typeof f) => (x ? Math.min(...x.placed.lines.filter((l) => l.role === "collection").map((l) => l.sizePt)) : 0);
  const lines = (x: typeof f) => x?.placed.lines.filter((l) => l.role === "collection").map((l) => l.text) ?? [];
  return (
    <Card className="lg:sticky lg:top-20">
      <CardHeader>
        <CardTitle>Try a name</CardTitle>
        <CardDescription>Runs the same auto-fit as the printed sign.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Field>
          <FieldLabel htmlFor="try-name">Collection name</FieldLabel>
          <Input id="try-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field>
          <FieldLabel htmlFor="try-tpl">Template</FieldLabel>
          <Select value={tpl.id} items={templates.map((t) => ({ value: t.id, label: t.name }))} onValueChange={(v) => v && setTplId(v)}>
            <SelectTrigger id="try-tpl" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent><SelectGroup>{templates.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectGroup></SelectContent>
          </Select>
        </Field>
        {f && plain && name.trim() && (
          <div className="flex flex-col gap-3 text-sm">
            <Step label="As typed" lines={lines(plain)} size={size(plain)} ok={!plain.belowMin.length} min={plain.min} />
            {f.abbreviations.length > 0 && (
              <Step label={`With ${f.abbreviations.map((a) => `${a.from} → ${a.to || "∅"}`).join(", ")}`} lines={lines(f)} size={size(f)} ok={!f.belowMin.length} min={f.min} />
            )}
            {f.switchedFrom && <p className="text-muted-foreground">Switches to “{f.template.name}”{f.abbreviations.length ? " (and shortens)" : ""} to stay readable.</p>}
            <p className={cn("font-medium", f.belowMin.length ? "text-destructive" : "text-foreground")}>
              {f.belowMin.length ? `Still below ${f.min}pt: the batch will warn, and printing asks first.` : plain.belowMin.length ? `Prints at ${size(f).toFixed(1)}pt ✓` : "Fits as typed ✓"}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Step({ label, lines, size, ok, min }: { label: string; lines: string[]; size: number; ok: boolean; min: number }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="mb-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="truncate">{label}</span>
        <Badge variant={ok ? "secondary" : "destructive"}>{size.toFixed(1)}pt{ok ? "" : ` < ${min}pt`}</Badge>
      </div>
      <div className="font-bold uppercase leading-tight" style={{ fontFamily: "Carlito" }}>{lines.map((l, i) => <div key={i}>{l}</div>)}</div>
    </div>
  );
}
