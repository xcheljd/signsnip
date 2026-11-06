import { useRef, useState } from "react";
import { fitLogo } from "../../../src/core/layout";
import { fitSign, layoutTemplate } from "../../../src/core/template";
import { DEFAULT_RULES, SIGN_H_MM, SIGN_W_MM, type Rules, type Sign, type Template, type TemplateObject } from "../../../src/core/types";
import { browserMeasure } from "./measure";

const PT = 0.3528; // mm per point
const PAD = 4; // mm of canvas around the paper (room for handles)
type Rect = { x: number; y: number; w: number; h: number };
type Handle = "move" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
export interface Guide { axis: "x" | "y"; at: number }

export interface LogoSource { url: string; aspect: number; scale: number }

/**
 * Live, vector rendering of a sign from its template, with drag-to-move, resize handles and
 * snapping. Uses the same layout engine and font metrics as the PDF.
 */
export function SignCanvas({
  template, sign, logo, width, selectedId, onSelect, onChange, onCommit, snap = true, showBoxes = true, readOnly = false, issues, rules = DEFAULT_RULES,
}: {
  rules?: Rules;
  template: Template; sign: Sign; logo?: LogoSource | null; width: number;
  selectedId?: string | null; onSelect?: (id: string | null) => void;
  /** live update while dragging */
  onChange?: (objects: TemplateObject[]) => void;
  /** drag finished: push one undo step with the state from before the drag */
  onCommit?: (before: TemplateObject[]) => void;
  snap?: boolean; showBoxes?: boolean; readOnly?: boolean;
  issues?: Map<string, "error" | "warn" | "info">;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ handle: Handle; id: string; start: { x: number; y: number }; orig: Rect; before: TemplateObject[]; moved: boolean } | null>(null);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [hover, setHover] = useState<string | null>(null);
  const vbW = SIGN_W_MM + PAD * 2, vbH = SIGN_H_MM + PAD * 2;
  const pxPerMm = width / vbW;
  const height = vbH * pxPerMm;
  // same auto-fit as the PDF (abbreviations), minus the fallback switch: you are editing *this* template
  const placed = fitSign(sign, [template], browserMeasure, rules, { template, noFallback: true }).placed;
  const m = template.safeMargin;

  const toMm = (e: React.PointerEvent) => {
    const r = svg.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * vbW - PAD, y: ((e.clientY - r.top) / r.height) * vbH - PAD };
  };

  /** nearest snap target on one axis for the given candidate edges */
  const snapAxis = (cands: number[], axis: "x" | "y", selfId: string) => {
    const size = axis === "x" ? SIGN_W_MM : SIGN_H_MM;
    const targets = [0, size / 2, size, m, size - m];
    for (const o of template.objects) {
      if (o.id === selfId) continue;
      const a = axis === "x" ? o.x : o.y, l = axis === "x" ? o.w : o.h;
      targets.push(a, a + l / 2, a + l);
    }
    const thr = Math.max(0.6, 6 / pxPerMm);
    let best: { delta: number; at: number } | null = null;
    for (const c of cands) for (const t of targets) {
      const d = t - c;
      if (Math.abs(d) <= thr && (!best || Math.abs(d) < Math.abs(best.delta))) best = { delta: d, at: t };
    }
    return best;
  };

  const onDown = (e: React.PointerEvent, id: string, handle: Handle) => {
    if (readOnly) return;
    e.stopPropagation();
    e.preventDefault();
    // take keyboard focus from any inspector field so arrows / Delete / Ctrl+Z act on the canvas
    svg.current?.focus({ preventScroll: true });
    onSelect?.(id);
    const o = template.objects.find((x) => x.id === id)!;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    svg.current?.setPointerCapture?.(e.pointerId);
    drag.current = { handle, id, start: toMm(e), orig: { x: o.x, y: o.y, w: o.w, h: o.h }, before: template.objects, moved: false };
  };

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = toMm(e);
    const dx = p.x - d.start.x, dy = p.y - d.start.y;
    if (!d.moved && Math.hypot(dx, dy) < 0.3) return;
    d.moved = true;
    const free = !snap || e.altKey;
    const grid = free ? 0.1 : 0.5;
    const round = (v: number) => Math.round(v / grid) * grid;
    const o = d.orig;
    let { x, y, w, h } = o;
    const g: Guide[] = [];
    if (d.handle === "move") {
      x = o.x + dx; y = o.y + dy;
      const sx = free ? null : snapAxis([x, x + w / 2, x + w], "x", d.id);
      const sy = free ? null : snapAxis([y, y + h / 2, y + h], "y", d.id);
      x = sx ? x + sx.delta : round(x); y = sy ? y + sy.delta : round(y);
      if (sx) g.push({ axis: "x", at: sx.at });
      if (sy) g.push({ axis: "y", at: sy.at });
    } else {
      let x1 = o.x, y1 = o.y, x2 = o.x + o.w, y2 = o.y + o.h;
      const edge = (v: number, axis: "x" | "y") => {
        const s = free ? null : snapAxis([v], axis, d.id);
        if (s) { g.push({ axis, at: s.at }); return v + s.delta; }
        return round(v);
      };
      if (d.handle.includes("w")) x1 = Math.min(edge(o.x + dx, "x"), x2 - 2);
      if (d.handle.includes("e")) x2 = Math.max(edge(o.x + o.w + dx, "x"), x1 + 2);
      if (d.handle.includes("n")) y1 = Math.min(edge(o.y + dy, "y"), y2 - 2);
      if (d.handle.includes("s")) y2 = Math.max(edge(o.y + o.h + dy, "y"), y1 + 2);
      x = x1; y = y1; w = x2 - x1; h = y2 - y1;
    }
    const fix = (v: number) => Math.round(v * 100) / 100;
    setGuides(g);
    onChange?.(template.objects.map((ob) => (ob.id === d.id ? { ...ob, x: fix(x), y: fix(y), w: fix(w), h: fix(h) } : ob)));
  };

  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    setGuides([]);
    if (d?.moved) onCommit?.(d.before);
  };

  const logoPlaced = placed.logo && logo ? fitLogo(logo.aspect, placed.logo.box, logo.scale) : null;
  const hs = 7 / pxPerMm; // handle size: 7px
  const sel = template.objects.find((o) => o.id === selectedId);
  const tone = (id: string) => {
    const lvl = issues?.get(id);
    return lvl === "error" ? "var(--destructive)" : lvl === "warn" ? "var(--warning)" : "var(--nord10)";
  };

  return (
    <svg
      ref={svg}
      width={width}
      height={height}
      viewBox={`${-PAD} ${-PAD} ${vbW} ${vbH}`}
      className={readOnly ? "pointer-events-none select-none" : "touch-none select-none rounded-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onPointerDown={() => { if (readOnly) return; svg.current?.focus({ preventScroll: true }); onSelect?.(null); }}
      tabIndex={readOnly ? undefined : 0}
      role={readOnly ? "img" : "application"}
      aria-label={`${template.name} layout`}
    >
      <defs>
        <filter id="paper-shadow" x="-10%" y="-10%" width="120%" height="120%">
          <feDropShadow dx="0" dy="0.4" stdDeviation="0.6" floodOpacity="0.18" />
        </filter>
      </defs>
      <rect x={0} y={0} width={SIGN_W_MM} height={SIGN_H_MM} fill="white" filter={readOnly ? undefined : "url(#paper-shadow)"} />
      {!readOnly && m > 0 && (
        <rect x={m} y={m} width={SIGN_W_MM - 2 * m} height={SIGN_H_MM - 2 * m} fill="none" stroke="var(--nord9)" strokeWidth={1} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
      )}

      {placed.logo && (logoPlaced && logo ? (
        <image href={logo.url} x={logoPlaced.x} y={logoPlaced.y} width={logoPlaced.w} height={logoPlaced.h} preserveAspectRatio="none" />
      ) : (
        <g>
          <rect {...placed.logo.box} fill="var(--nord5)" />
          <text x={placed.logo.box.x + placed.logo.box.w / 2} y={placed.logo.box.y + placed.logo.box.h / 2 + 1.2} textAnchor="middle" fontSize={3.4} fill="var(--nord3)" fontFamily="Carlito">LOGO</text>
        </g>
      ))}

      {placed.lines.map((l, i) => {
        const baseline = l.cy + l.sizePt * PT * 0.32;
        return (
          <g key={i}>
            <text x={l.x} y={baseline} fontSize={l.sizePt * PT} fontFamily="Carlito" fontWeight={l.weight === "bold" ? 700 : 400} fill={l.color} style={{ whiteSpace: "pre", fontKerning: "normal" }}>{l.text}</text>
            {l.strike && (
              <line x1={l.x - PT} x2={l.x + l.w + PT} y1={baseline - l.sizePt * PT * 0.3} y2={baseline - l.sizePt * PT * 0.3} stroke={l.color} strokeWidth={Math.max(0.7, l.sizePt * 0.07) * PT} />
            )}
          </g>
        );
      })}

      {!readOnly && (showBoxes || hover || sel) && template.objects.map((o) => {
        const active = o.id === selectedId;
        const visible = showBoxes || active || hover === o.id;
        const lvl = issues?.get(o.id);
        return (
          <rect
            key={o.id}
            data-object={o.id}
            x={o.x} y={o.y} width={o.w} height={o.h}
            fill={active ? "color-mix(in srgb, var(--nord10) 8%, transparent)" : "transparent"}
            stroke={visible ? (lvl && lvl !== "info" ? tone(o.id) : active ? "var(--nord10)" : "color-mix(in srgb, var(--nord3) 45%, transparent)") : "transparent"}
            strokeWidth={active ? 1.5 : 1}
            strokeDasharray={active ? undefined : "3 2"}
            vectorEffect="non-scaling-stroke"
            className="cursor-move"
            onPointerDown={(e) => onDown(e, o.id, "move")}
            onPointerEnter={() => setHover(o.id)}
            onPointerLeave={() => setHover((h) => (h === o.id ? null : h))}
          />
        );
      })}
      {/* invisible hit targets when boxes are hidden */}
      {!readOnly && !showBoxes && template.objects.filter((o) => o.id !== selectedId && hover !== o.id).map((o) => (
        <rect key={`hit-${o.id}`} x={o.x} y={o.y} width={o.w} height={o.h} fill="transparent" className="cursor-move"
          onPointerDown={(e) => onDown(e, o.id, "move")} onPointerEnter={() => setHover(o.id)} />
      ))}

      {!readOnly && sel && (["nw", "n", "ne", "e", "se", "s", "sw", "w"] as Handle[]).map((hd) => {
        const cx = hd.includes("w") ? sel.x : hd.includes("e") ? sel.x + sel.w : sel.x + sel.w / 2;
        const cy = hd.includes("n") ? sel.y : hd.includes("s") ? sel.y + sel.h : sel.y + sel.h / 2;
        const cursor = { n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize", ne: "nesw-resize", sw: "nesw-resize", nw: "nwse-resize", se: "nwse-resize", move: "move" }[hd];
        return (
          <rect key={hd} data-handle={hd} x={cx - hs / 2} y={cy - hs / 2} width={hs} height={hs} rx={hs * 0.2}
            fill="white" stroke="var(--nord10)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" style={{ cursor }}
            onPointerDown={(e) => onDown(e, sel.id, hd)} />
        );
      })}

      {guides.map((g, i) => g.axis === "x" ? (
        <line key={i} x1={g.at} x2={g.at} y1={-PAD} y2={SIGN_H_MM + PAD} stroke="var(--guide)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      ) : (
        <line key={i} y1={g.at} y2={g.at} x1={-PAD} x2={SIGN_W_MM + PAD} stroke="var(--guide)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      ))}
    </svg>
  );
}

/** Small static picture of a template (for lists and pickers). */
export function TemplateThumb({ template, sign, logo, width = 56 }: { template: Template; sign: Sign; logo?: LogoSource | null; width?: number }) {
  return (
    <div className="overflow-hidden rounded-sm border bg-white" style={{ width, height: (width * SIGN_H_MM) / SIGN_W_MM }}>
      <svg viewBox={`0 0 ${SIGN_W_MM} ${SIGN_H_MM}`} width={width} height={(width * SIGN_H_MM) / SIGN_W_MM} aria-hidden>
        <ThumbBody template={template} sign={sign} logo={logo} />
      </svg>
    </div>
  );
}
function ThumbBody({ template, sign, logo }: { template: Template; sign: Sign; logo?: LogoSource | null }) {
  const placed = layoutTemplate(template, sign, browserMeasure);
  const lp = placed.logo && logo ? fitLogo(logo.aspect, placed.logo.box, logo.scale) : null;
  return (
    <>
      {lp && logo ? <image href={logo.url} x={lp.x} y={lp.y} width={lp.w} height={lp.h} preserveAspectRatio="none" />
        : placed.logo && <rect {...placed.logo.box} fill="var(--nord5)" />}
      {placed.lines.map((l, i) => (
        <text key={i} x={l.x} y={l.cy + l.sizePt * PT * 0.32} fontSize={l.sizePt * PT} fontFamily="Carlito" fontWeight={l.weight === "bold" ? 700 : 400} fill={l.color} style={{ whiteSpace: "pre" }}>{l.text}</text>
      ))}
    </>
  );
}
