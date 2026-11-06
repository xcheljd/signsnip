import { useEffect, useRef, useState, type ReactNode } from "react";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { Skeleton } from "@/components/ui/skeleton";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

interface Page { src: string; w: number; h: number }

/**
 * Renders every page of a PDF (the exact bytes that get printed) to images, swapping all
 * pages at once so edits never flicker. `overlay` draws interactive layers on top of a page.
 */
export function PdfView({
  bytes, width: fixed, label, overlay, aspect,
}: {
  bytes: Uint8Array | null; width: number | "fill"; label: string;
  overlay?: (page: number) => ReactNode;
  /** w/h of a page, so a placeholder of the right shape shows before the first render */
  aspect?: number;
}) {
  const outer = useRef<HTMLDivElement>(null);
  const [avail, setAvail] = useState(0);
  const [pages, setPages] = useState<Page[]>([]);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (fixed !== "fill" || !outer.current) return;
    const el = outer.current;
    const ro = new ResizeObserver(() => setAvail(Math.floor(el.clientWidth)));
    ro.observe(el); setAvail(Math.floor(el.clientWidth));
    return () => ro.disconnect();
  }, [fixed]);
  const width = fixed === "fill" ? avail : fixed;

  useEffect(() => {
    if (!bytes || width < 50) return;
    let dead = false;
    (async () => {
      try {
        const task = pdfjs.getDocument({ data: bytes.slice() });
        const doc = await task.promise;
        const out: Page[] = [];
        for (let n = 1; n <= doc.numPages; n++) {
          const page = await doc.getPage(n);
          const base = page.getViewport({ scale: 1 });
          const dpr = Math.max(window.devicePixelRatio || 1, 2);
          const vp = page.getViewport({ scale: (width / base.width) * dpr });
          const c = document.createElement("canvas");
          c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
          await page.render({ canvas: c, canvasContext: c.getContext("2d")!, viewport: vp }).promise;
          out.push({ src: c.toDataURL("image/png"), w: width, h: (width * base.height) / base.width });
        }
        await task.destroy();
        if (!dead) { setPages(out); setErr(""); }
      } catch (e) { if (!dead) setErr((e as Error).message); }
    })();
    return () => { dead = true; };
  }, [bytes, width]);

  return (
    <div ref={outer} className="flex w-full flex-col items-center gap-4" aria-label={label}>
      {pages.length === 0 && !err && width > 0 && aspect && (
        <Skeleton className="bg-background" style={{ width, height: width / aspect }} />
      )}
      {pages.map((p, i) => (
        <div key={i} className="relative bg-white shadow-md" style={{ width: p.w, height: p.h }}>
          <img src={p.src} alt={`${label} page ${i + 1}`} className="block size-full select-none" draggable={false} />
          {overlay?.(i)}
        </div>
      ))}
      {err && <p className="text-sm text-destructive">{err}</p>}
    </div>
  );
}
