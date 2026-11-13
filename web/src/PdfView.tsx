import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { Skeleton } from "@/components/ui/skeleton";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** a drawn page image, tagged with the PDF version it came from */
interface Drawn { src: string; ver: number }

/**
 * Shows a PDF (the exact bytes that get printed) as page images.
 * Only pages on or near the screen are drawn, so a 20-page batch costs about the
 * same as a 2-page one. On an edit, the visible pages are redrawn first and swapped in
 * together (no flicker); off-screen pages keep their old image until they scroll into view.
 * `overlay` draws interactive layers on top of a page. `only` shows that one page (the sheet
 * pager): then it is the only page drawn, on each edit too.
 */
export function PdfView({
  bytes, width: fixed, label, overlay, aspect, only,
}: {
  bytes: Uint8Array | null; width: number | "fill"; label: string;
  overlay?: (page: number) => ReactNode;
  /** w/h of a page, so placeholders have the right shape before the first render */
  aspect?: number;
  /** show just this page (0-based); undefined = every page */
  only?: number;
}) {
  const outer = useRef<HTMLDivElement>(null);
  const [avail, setAvail] = useState(0);
  const [count, setCount] = useState(0);
  const [pageAspect, setPageAspect] = useState(aspect ?? 1);
  const [drawn, setDrawn] = useState<(Drawn | undefined)[]>([]);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (fixed !== "fill" || !outer.current) return;
    const el = outer.current;
    const ro = new ResizeObserver(() => setAvail(Math.floor(el.clientWidth)));
    ro.observe(el); setAvail(Math.floor(el.clientWidth));
    return () => ro.disconnect();
  }, [fixed]);
  const width = fixed === "fill" ? avail : fixed;

  // the current document + version, and which pages are near the viewport
  const docRef = useRef<{ doc: pdfjs.PDFDocumentProxy; task: pdfjs.PDFDocumentLoadingTask; ver: number; width: number } | null>(null);
  const ver = useRef(0);
  const near = useRef(new Set<number>([0]));
  const busy = useRef(new Set<string>());
  const drawnRef = useRef(drawn);
  drawnRef.current = drawn;

  // new bytes or width: load, redraw the visible pages, swap them in together
  // nothing to show: clear the old pages, so a stale preview never stands in for the current one
  useEffect(() => {
    if (bytes) return;
    ver.current++;
    setCount(0); setDrawn([]); setErr("");
    const old = docRef.current; docRef.current = null;
    if (old) void old.task.destroy();
  }, [bytes]);
  useEffect(() => {
    if (!bytes || width < 50) return;
    const v = ++ver.current;
    let dead = false;
    (async () => {
      try {
        const task = pdfjs.getDocument({ data: bytes.slice() });
        const doc = await task.promise;
        if (dead) { await task.destroy(); return; }
        const vp = (await doc.getPage(1)).getViewport({ scale: 1 });
        const n = doc.numPages;
        const want = [...near.current].filter((i) => i < n).sort((a, b) => a - b);
        if (!want.length) want.push(0);
        const fresh = new Map<number, string>();
        for (const i of want) { fresh.set(i, await drawPage(doc, i, width)); if (dead) break; }
        if (dead) { await task.destroy(); return; }
        const old = docRef.current;
        docRef.current = { doc, task, ver: v, width };
        setPageAspect(vp.width / vp.height);
        setCount(n);
        setDrawn((prev) => Array.from({ length: n }, (_, i) => (fresh.has(i) ? { src: fresh.get(i)!, ver: v } : prev[i])));
        setErr("");
        if (old) void old.task.destroy();
      } catch (e) { if (!dead) setErr((e as Error).message); }
    })();
    return () => { dead = true; };
  }, [bytes, width]);

  useEffect(() => () => { void docRef.current?.task.destroy(); docRef.current = null; }, []);

  // draw a page that came into view if its image is missing or from an older version
  const ensure = useCallback(async (i: number) => {
    const cur = docRef.current;
    if (!cur || i >= cur.doc.numPages || drawnRef.current[i]?.ver === cur.ver) return;
    const key = `${cur.ver}:${i}`;
    if (busy.current.has(key)) return;
    busy.current.add(key);
    try {
      const src = await drawPage(cur.doc, i, cur.width);
      if (docRef.current?.ver !== cur.ver) return;
      setDrawn((prev) => { const next = prev.slice(); next[i] = { src, ver: cur.ver }; return next; });
    } catch { /* document was replaced mid-draw; the newer version redraws */ } finally { busy.current.delete(key); }
  }, []);

  const io = useRef<IntersectionObserver | null>(null);
  useEffect(() => {
    io.current = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const i = Number((e.target as HTMLElement).dataset.page);
        if (e.isIntersecting) { near.current.add(i); void ensure(i); } else near.current.delete(i);
      }
    }, { rootMargin: "100% 0px" }); // start drawing a screen ahead
    return () => io.current?.disconnect();
  }, [ensure]);
  const observe = useCallback((el: HTMLDivElement | null) => { if (el) io.current?.observe(el); }, []);

  // one page at a time: that page is the only one near the screen (an unmounted page never reports
  // leaving it, so it would otherwise stay in `near` and be redrawn on every edit)
  useEffect(() => { if (only !== undefined) { near.current = new Set([only]); void ensure(only); } }, [only, ensure]);

  // fill in visible pages that weren't part of a version's first batch
  useEffect(() => { for (const i of near.current) void ensure(i); }, [count, drawn, ensure]);

  const h = width / pageAspect;
  const pages = Array.from({ length: count }, (_, i) => i).filter((i) => only === undefined || i === only);
  return (
    <div ref={outer} className="flex w-full flex-col items-center gap-4" aria-label={label}>
      {count === 0 && !err && width > 0 && aspect && (
        <Skeleton className="bg-background" style={{ width, height: width / aspect }} />
      )}
      {width > 0 && pages.map((i) => (
        <div key={i} ref={observe} data-page={i} className="relative bg-white shadow-md" style={{ width, height: h }}>
          {drawn[i]
            ? <img src={drawn[i]!.src} alt={`${label} page ${i + 1}`} className="block size-full select-none" draggable={false} />
            : <Skeleton className="size-full rounded-none bg-white" />}
          {overlay?.(i)}
        </div>
      ))}
      {err && <p className="text-sm text-destructive">{err}</p>}
    </div>
  );
}

async function drawPage(doc: pdfjs.PDFDocumentProxy, n: number, w: number) {
  const page = await doc.getPage(n + 1);
  const base = page.getViewport({ scale: 1 });
  const dpr = Math.max(window.devicePixelRatio || 1, 2);
  const vp = page.getViewport({ scale: (w / base.width) * dpr });
  const c = document.createElement("canvas");
  c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
  await page.render({ canvas: c, canvasContext: c.getContext("2d")!, viewport: vp }).promise;
  const src = c.toDataURL("image/png");
  c.width = 0; c.height = 0; // free the canvas memory now, not at GC
  return src;
}
