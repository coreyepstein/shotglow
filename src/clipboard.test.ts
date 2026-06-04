import { describe, it, expect, beforeAll } from "bun:test";
import type { BeautifySettings, Rect } from "./types.js";
import { computeOutputLayout, mapRectToOutput } from "./layout.js";

// ── Stubs ────────────────────────────────────────────────────────────────────
// buildComposite + pixelate need OffscreenCanvas, document.createElement, and a
// 2D context. We provide minimal recording stubs so the compositing sequence can
// be asserted without a real browser.

type Call = { method: string; args: unknown[] };

class MockOffscreenCanvas {
  width: number;
  height: number;
  _ctx: Record<string, unknown>;
  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this._ctx = {
      imageSmoothingEnabled: true,
      globalCompositeOperation: "source-over",
      fillStyle: "#000",
      createLinearGradient: () => ({ addColorStop: () => {} }),
      fillRect: () => {},
      drawImage: () => {},
    };
  }
  getContext() {
    return this._ctx;
  }
}

// A recording 2D context spy. Records ordered method calls; property writes are
// no-ops we accept.
function makeSpyCtx(canvas: { width: number; height: number }) {
  const calls: Call[] = [];
  const rec = (method: string) => (...args: unknown[]) => {
    calls.push({ method, args });
  };
  const ctx = {
    canvas,
    fillStyle: "#000" as unknown,
    shadowColor: "",
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    imageSmoothingEnabled: true,
    globalCompositeOperation: "source-over",
    save: rec("save"),
    restore: rec("restore"),
    beginPath: rec("beginPath"),
    moveTo: rec("moveTo"),
    arcTo: rec("arcTo"),
    closePath: rec("closePath"),
    clip: rec("clip"),
    fill: rec("fill"),
    fillRect: rec("fillRect"),
    drawImage: rec("drawImage"),
    createLinearGradient: (...args: unknown[]) => {
      calls.push({ method: "createLinearGradient", args });
      return { addColorStop: () => {} };
    },
    createPattern: (...args: unknown[]) => {
      calls.push({ method: "createPattern", args });
      return {};
    },
  };
  return { ctx, calls };
}

let lastSpy: { ctx: unknown; calls: Call[] };

beforeAll(() => {
  const g = globalThis as unknown as { OffscreenCanvas: unknown; document: unknown };
  g.OffscreenCanvas = MockOffscreenCanvas;
  g.document = {
    createElement: (tag: string) => {
      if (tag !== "canvas") throw new Error("unexpected createElement: " + tag);
      const canvas: { width: number; height: number; getContext: () => unknown } = {
        width: 0,
        height: 0,
        getContext: () => {
          lastSpy = makeSpyCtx(canvas);
          return lastSpy.ctx;
        },
      };
      return canvas;
    },
  };
});

const { buildComposite } = await import("./clipboard.js");

function settings(partial: Partial<BeautifySettings>): BeautifySettings {
  return {
    margin: 0,
    scale: 1,
    radius: 0,
    shadow: { enabled: false, blur: 0, opacity: 0, offsetX: 0, offsetY: 0 },
    background: { type: "solid", color: "#123456" },
    pattern: { presetId: null, color: "#ffffff", opacity: 0 },
    aspect: "auto",
    ...partial,
  };
}

function baseCanvas(w: number, h: number): HTMLCanvasElement {
  return { width: w, height: h } as HTMLCanvasElement;
}

describe("buildComposite", () => {
  it("sizes the output canvas from computeOutputLayout", () => {
    const s = settings({ margin: 64 });
    const out = buildComposite(baseCanvas(800, 600), [], 3, s, {});
    const layout = computeOutputLayout(s, 800, 600);
    expect(out.width).toBe(layout.canvasW);
    expect(out.height).toBe(layout.canvasH);
  });

  it("composites in order: background → clip → base image (shadow off)", () => {
    const s = settings({ margin: 32 });
    buildComposite(baseCanvas(400, 300), [], 3, s, {});
    const seq = lastSpy.calls.map((c) => c.method);

    const bgFill = seq.indexOf("fillRect"); // background fill
    const clip = seq.indexOf("clip");
    const baseDraw = lastSpy.calls.findIndex((c) => c.method === "drawImage" && c.args.length === 9);

    expect(bgFill).toBeGreaterThanOrEqual(0);
    expect(clip).toBeGreaterThan(bgFill);
    expect(baseDraw).toBeGreaterThan(clip);
  });

  it("fills the shadow path when shadow is enabled", () => {
    const s = settings({ margin: 32, shadow: { enabled: true, blur: 20, opacity: 0.4, offsetX: 0, offsetY: 10 } });
    buildComposite(baseCanvas(400, 300), [], 3, s, {});
    const seq = lastSpy.calls.map((c) => c.method);
    // shadow fill happens before the clip used for the image
    expect(seq.indexOf("fill")).toBeGreaterThanOrEqual(0);
    expect(seq.indexOf("fill")).toBeLessThan(seq.indexOf("clip"));
  });

  it("uses a gradient fill for gradient backgrounds", () => {
    const s = settings({ background: { type: "gradient", presetId: "sunset" } });
    buildComposite(baseCanvas(400, 300), [], 3, s, {});
    const seq = lastSpy.calls.map((c) => c.method);
    expect(seq).toContain("createLinearGradient");
  });

  it("applies redactions at mapped output coordinates", () => {
    const s = settings({ scale: 0.5, margin: 20 });
    const rect: Rect = { id: "r", x: 100, y: 50, w: 40, h: 20 };
    buildComposite(baseCanvas(800, 600), [rect], 3, s, {});

    const layout = computeOutputLayout(s, 800, 600);
    const expected = mapRectToOutput(rect, layout);

    // pixelate's final composite is a 3-arg drawImage(mosaic, x, y).
    const mosaicDraws = lastSpy.calls.filter((c) => c.method === "drawImage" && c.args.length === 3);
    expect(mosaicDraws).toHaveLength(1);
    expect(mosaicDraws[0].args[1]).toBe(expected.x);
    expect(mosaicDraws[0].args[2]).toBe(expected.y);
  });

  it("handles empty rects with a solid background", () => {
    const s = settings({ margin: 10 });
    const out = buildComposite(baseCanvas(200, 200), [], 3, s, {});
    expect(out.width).toBe(220);
    expect(out.height).toBe(220);
  });

  it("does not draw a pattern overlay when none is selected", () => {
    const s = settings({ pattern: { presetId: null, color: "#fff", opacity: 0.2 } });
    buildComposite(baseCanvas(400, 300), [], 3, s, {});
    const seq = lastSpy.calls.map((c) => c.method);
    expect(seq).not.toContain("createPattern");
  });
});
