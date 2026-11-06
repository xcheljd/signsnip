import { useEffect, useRef, useState } from "react";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** Renders every page of a PDF to crisp canvases at a CSS width. Same bytes that get printed. */
export function PdfView({ bytes, width: fixed, label }: { bytes: Uint8Array | null; width: number | "fill"; label: string }) {
  const host = useRef<HTMLDivElement>(null);
  const outer = useRef<HTMLDivElement>(null);
  const [avail, setAvail] = useState(0);
  useEffect(() => {
    if (fixed !== "fill" || !outer.current) return;
    const el = outer.current;
    const ro = new ResizeObserver(() => setAvail(Math.floor(el.clientWidth)));
    ro.observe(el); setAvail(Math.floor(el.clientWidth));
    return () => ro.disconnect();
  }, [fixed]);
  const width = fixed === "fill" ? avail : fixed;
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!bytes || !host.current || width < 50) return;
    let dead = false;
    const el = host.current;
    (async () => {
      try {
        const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
        const canvases: HTMLCanvasElement[] = [];
        for (let n = 1; n <= doc.numPages; n++) {
          const page = await doc.getPage(n);
          const base = page.getViewport({ scale: 1 });
          const dpr = Math.max(window.devicePixelRatio || 1, 2);
          const vp = page.getViewport({ scale: (width / base.width) * dpr });
          const c = document.createElement("canvas");
          c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
          c.style.width = `${width}px`; c.style.height = `${(width * base.height) / base.width}px`;
          c.className = "mx-auto mb-3 block bg-white shadow-md";
          await page.render({ canvas: c, canvasContext: c.getContext("2d")!, viewport: vp }).promise;
          canvases.push(c);
        }
        if (!dead) { el.replaceChildren(...canvases); setErr(""); }
      } catch (e) { if (!dead) setErr((e as Error).message); }
    })();
    return () => { dead = true; };
  }, [bytes, width]);

  return (
    <div className="w-full max-w-full overflow-auto" aria-label={label} ref={outer}>
      <div ref={host} />
      {err && <p className="text-sm text-destructive">{err}</p>}
    </div>
  );
}
