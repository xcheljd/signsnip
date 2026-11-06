import type { ImageOps, Raster } from "../../../src/core/images";

/** Browser image backend: decode with <img>/createImageBitmap, encode and resize with canvas. */
const SVG_RENDER_W = 2000; // SVGs have no pixel size; render them big enough to print sharp

function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("This browser can't process images (no canvas)");
  return { c, ctx };
}

async function loadImage(bytes: Uint8Array): Promise<{ img: CanvasImageSource; w: number; h: number; close?: () => void }> {
  const isSvg = new TextDecoder().decode(bytes.slice(0, 512)).includes("<svg");
  const blob = new Blob([bytes as BlobPart], { type: isSvg ? "image/svg+xml" : "" });
  if (!isSvg && "createImageBitmap" in window) {
    try {
      const bmp = await createImageBitmap(blob, { imageOrientation: "from-image" });
      return { img: bmp, w: bmp.width, h: bmp.height, close: () => bmp.close() };
    } catch { /* fall through to <img> */ }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode().catch(() => { throw new Error("That file isn't an image this browser can read (try PNG or JPG)"); });
    let w = img.naturalWidth || 300, h = img.naturalHeight || 150;
    if (isSvg) { const s = SVG_RENDER_W / w; w = Math.round(w * s); h = Math.round(h * s); }
    return { img, w, h };
  } finally { setTimeout(() => URL.revokeObjectURL(url), 0); }
}

const toRaster = (ctx: CanvasRenderingContext2D, w: number, h: number): Raster => {
  const d = ctx.getImageData(0, 0, w, h);
  return { data: new Uint8Array(d.data.buffer), width: w, height: h };
};
const fromRaster = (r: Raster) => {
  const { c, ctx } = canvas(r.width, r.height);
  ctx.putImageData(new ImageData(new Uint8ClampedArray(r.data), r.width, r.height), 0, 0);
  return c;
};

export const canvasImages: ImageOps = {
  async decode(bytes) {
    const { img, w, h, close } = await loadImage(bytes);
    const { ctx } = canvas(w, h);
    ctx.drawImage(img, 0, 0, w, h);
    close?.();
    return toRaster(ctx, w, h);
  },
  async encodePng(r) {
    const c = fromRaster(r);
    const blob = await new Promise<Blob | null>((res) => c.toBlob(res, "image/png"));
    if (!blob) throw new Error("Couldn't encode the logo");
    return new Uint8Array(await blob.arrayBuffer());
  },
  async encodeJpeg(r, quality) {
    const src = fromRaster(r);
    const { c, ctx } = canvas(r.width, r.height);
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, r.width, r.height); // JPEG has no alpha: flatten onto paper white
    ctx.drawImage(src, 0, 0);
    const blob = await new Promise<Blob | null>((res) => c.toBlob(res, "image/jpeg", quality / 100));
    if (!blob) throw new Error("Couldn't encode the picture");
    return new Uint8Array(await blob.arrayBuffer());
  },
  async resize(r, width, height) {
    const src = fromRaster(r);
    const { ctx } = canvas(width, height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(src, 0, 0, width, height);
    return toRaster(ctx, width, height);
  },
};
