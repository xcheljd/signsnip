import { describe, expect, it } from "vitest";
import { CANVAS_MAX_W, CANVAS_MIN_H, VIEW_H_MM, VIEW_W_MM, canvasFit, handleSizes } from "../web/src/designer/canvasFit";

const ratio = VIEW_W_MM / VIEW_H_MM;

describe("designer canvas size", () => {
  it("is never larger than the old fixed 560 x 794 canvas", () => {
    const f = canvasFit({ viewportW: 2560, viewportH: 1600, holderW: 1400, above: 200, below: 16 });
    expect(f.width).toBe(CANVAS_MAX_W);
    expect(f.height).toBeCloseTo(794.2, 1);
    expect(f.by).toBe("max");
  });

  it("fits a short desktop window by its height (whole canvas below the chrome)", () => {
    // 1338 x 680 window: 250 px of header, padding and toolbar above the canvas
    const f = canvasFit({ viewportW: 1338, viewportH: 680, holderW: 650, above: 250, below: 16 });
    expect(f.by).toBe("height");
    expect(f.height).toBeLessThanOrEqual(680 - 250 - 16);
    expect(f.height).toBeGreaterThan(680 - 250 - 16 - 2); // floor() costs at most a pixel or two
    expect(250 + f.height + 16).toBeLessThanOrEqual(680);
  });

  it("follows the width when the column is the narrow side (iPad portrait)", () => {
    const f = canvasFit({ viewportW: 820, viewportH: 1180, holderW: 404, above: 300, below: 16 });
    expect(f.by).toBe("width");
    expect(f.width).toBe(404);
  });

  it("keeps the sign's ratio and reports px per mm", () => {
    for (const [vw, vh, hw, above] of [[1440, 900, 700, 220], [1024, 768, 590, 330], [390, 844, 334, 500], [800, 600, 380, 250]] as const) {
      const f = canvasFit({ viewportW: vw, viewportH: vh, holderW: hw, above, below: 16 });
      expect(f.width / f.height).toBeCloseTo(ratio, 6);
      expect(f.scale).toBeCloseTo(f.width / VIEW_W_MM, 9);
      expect(Number.isInteger(f.width)).toBe(true);
    }
  });

  it("never shrinks below the minimum height; the page scrolls instead", () => {
    const f = canvasFit({ viewportW: 1280, viewportH: 420, holderW: 600, above: 300, below: 16 });
    expect(f.by).toBe("min");
    expect(f.height).toBeGreaterThanOrEqual(CANVAS_MIN_H - 2);
  });

  it("the minimum never makes the canvas wider than its holder", () => {
    const f = canvasFit({ viewportW: 900, viewportH: 400, holderW: 180, above: 300, below: 16 });
    expect(f.width).toBeLessThanOrEqual(180);
  });

  it("on a phone it only fits the width (the page scrolls)", () => {
    const f = canvasFit({ viewportW: 390, viewportH: 844, holderW: 334, above: 600, below: 16 });
    expect(f.by).toBe("width");
    expect(f.width).toBe(334);
  });

  it("recomputes for a new window size (1440 -> 1024 -> 1440)", () => {
    const at = (vw: number, vh: number, hw: number) => canvasFit({ viewportW: vw, viewportH: vh, holderW: hw, above: 260, below: 16 }).width;
    const a = at(1440, 900, 700), b = at(1024, 768, 590), c = at(1440, 900, 700);
    expect(b).toBeLessThan(a);
    expect(c).toBe(a);
  });
});

describe("resize handle sizes", () => {
  it("desktop keeps small handles that are their own target", () => {
    expect(handleSizes(400, 150, false)).toEqual({ visual: 8, hit: 8 });
    expect(handleSizes(20, 10, false)).toEqual({ visual: 8, hit: 8 });
  });

  it("touch: 13 px handles with a 44 px hit area on a normal object", () => {
    expect(handleSizes(273, 98, true)).toEqual({ visual: 13, hit: 44 });
    expect(handleSizes(88, 88, true)).toEqual({ visual: 13, hit: 44 });
  });

  it("touch: hit areas shrink on small objects so neighbours never overlap and the body stays draggable", () => {
    for (const [w, h] of [[70, 28], [60, 60], [40, 200], [20, 12], [8, 8], [87, 300]] as const) {
      const { hit, visual } = handleSizes(w, h, true);
      const spacing = Math.min(w, h) / 2; // centre-to-centre distance of neighbouring handles
      expect(hit).toBeLessThanOrEqual(spacing);
      expect(hit / 2).toBeLessThan(Math.min(w, h) / 2); // the object's middle is outside every hit area
      expect(visual).toBeLessThanOrEqual(13);
      expect(visual).toBeGreaterThanOrEqual(6);
    }
    expect(handleSizes(70, 28, true).hit).toBe(14);
  });
});
