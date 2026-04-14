import { describe, it, expect, beforeAll } from "bun:test";
import type { Rect } from "./types.js";

// ── OffscreenCanvas stub ────────────────────────────────────────────────────────
// Bun runs in Node; OffscreenCanvas doesn't exist. We provide minimal stubs so
// the pure-logic paths of redact.ts can be exercised without a real GPU context.

type MockCtx = {
  imageSmoothingEnabled: boolean;
  globalCompositeOperation: string;
  fillStyle: string | object;
  calls: Array<{ method: string; args: unknown[] }>;
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): MockGradient;
  fillRect(x: number, y: number, w: number, h: number): void;
  drawImage(...args: unknown[]): void;
};

type MockGradient = {
  addColorStop(offset: number, color: string): void;
};

class MockOffscreenCanvas {
  width: number;
  height: number;
  _ctx: MockCtx;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this._ctx = {
      imageSmoothingEnabled: true,
      globalCompositeOperation: "source-over",
      fillStyle: "#000000",
      calls: [],
      createLinearGradient(_x0: number, _y0: number, _x1: number, _y1: number): MockGradient {
        return { addColorStop: () => {} };
      },
      fillRect(x: number, y: number, w: number, h: number) {
        this.calls.push({ method: "fillRect", args: [x, y, w, h] });
      },
      drawImage(...args: unknown[]) {
        this.calls.push({ method: "drawImage", args });
      },
    };
  }

  getContext(_type: string): MockCtx {
    return this._ctx;
  }
}

// Install global stubs before importing redact.ts
beforeAll(() => {
  // @ts-expect-error — stub for test environment
  globalThis.OffscreenCanvas = MockOffscreenCanvas;
});

// Dynamic import so stubs are in place before module executes
const { strengthToBlockSize, pixelate, compositeAll } = await import("./redact.js");

// ── strengthToBlockSize ─────────────────────────────────────────────────────────

describe("strengthToBlockSize", () => {
  it("maps strength 1 → 8", () => {
    expect(strengthToBlockSize(1)).toBe(8);
  });

  it("maps strength 2 → 16", () => {
    expect(strengthToBlockSize(2)).toBe(16);
  });

  it("maps strength 3 → 32", () => {
    expect(strengthToBlockSize(3)).toBe(32);
  });

  it("maps strength 4 → 64", () => {
    expect(strengthToBlockSize(4)).toBe(64);
  });

  it("falls back to 32 for unknown strength", () => {
    expect(strengthToBlockSize(0)).toBe(32);
    expect(strengthToBlockSize(99)).toBe(32);
  });
});

// ── Helper: make a minimal CanvasRenderingContext2D stub ────────────────────────

function makeCtx(canvasW = 200, canvasH = 200): { ctx: CanvasRenderingContext2D; calls: Array<{ method: string; args: unknown[] }> } {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const canvas = {
    width: canvasW,
    height: canvasH,
  } as HTMLCanvasElement;

  const ctx = {
    canvas,
    imageSmoothingEnabled: true,
    globalCompositeOperation: "source-over",
    fillStyle: "#000000",
    drawImage(...args: unknown[]) {
      calls.push({ method: "drawImage", args });
    },
    fillRect(x: number, y: number, w: number, h: number) {
      calls.push({ method: "fillRect", args: [x, y, w, h] });
    },
    createLinearGradient() {
      return { addColorStop: () => {} };
    },
  } as unknown as CanvasRenderingContext2D;

  return { ctx, calls };
}

function makeRect(x: number, y: number, w: number, h: number): Rect {
  return { id: "test", x, y, w, h };
}

// ── pixelate ───────────────────────────────────────────────────────────────────

describe("pixelate", () => {
  it("skips degenerate rect with w=0", () => {
    const { ctx, calls } = makeCtx();
    pixelate(ctx, makeRect(0, 0, 0, 100), 16);
    expect(calls).toHaveLength(0);
  });

  it("skips degenerate rect with h=0", () => {
    const { ctx, calls } = makeCtx();
    pixelate(ctx, makeRect(0, 0, 100, 0), 16);
    expect(calls).toHaveLength(0);
  });

  it("skips degenerate blockSize=0", () => {
    const { ctx, calls } = makeCtx();
    pixelate(ctx, makeRect(0, 0, 100, 100), 0);
    expect(calls).toHaveLength(0);
  });

  it("calls drawImage on ctx to composite the mosaic back", () => {
    const { ctx, calls } = makeCtx();
    const rect = makeRect(10, 20, 100, 80);
    pixelate(ctx, rect, 16);

    // Final step: mosaic drawn back onto ctx at rect position
    const finalDraw = calls.find((c) => c.method === "drawImage");
    expect(finalDraw).toBeDefined();
    // The mosaic offscreen canvas is drawn at (x, y)
    expect(finalDraw!.args[1]).toBe(10); // x
    expect(finalDraw!.args[2]).toBe(20); // y
  });

  it("small canvas is scaled by 1/blockSize (smallW = ceil(w/blockSize))", () => {
    // w=100, blockSize=16 → smallW = ceil(100/16) = 7
    // We verify the small canvas is constructed with those dimensions by
    // checking that the first drawImage call on the small ctx uses those dims.
    // Since MockOffscreenCanvas captures calls, we inspect via the global.
    const constructorCalls: Array<[number, number]> = [];
    const OrigMock = globalThis.OffscreenCanvas as unknown as typeof MockOffscreenCanvas;

    class TrackingCanvas extends OrigMock {
      constructor(w: number, h: number) {
        super(w, h);
        constructorCalls.push([w, h]);
      }
    }

    // @ts-expect-error — stub for test environment
    globalThis.OffscreenCanvas = TrackingCanvas;

    const { ctx } = makeCtx();
    pixelate(ctx, makeRect(0, 0, 100, 64), 16);

    // Restore
    // @ts-expect-error — stub for test environment
    globalThis.OffscreenCanvas = OrigMock;

    // First canvas is "small": smallW=ceil(100/16)=7, smallH=ceil(64/16)=4
    expect(constructorCalls[0]).toEqual([7, 4]);
    // Second canvas is "mosaic": same as rect dims
    expect(constructorCalls[1]).toEqual([100, 64]);
    // Third canvas is "mask": same as rect dims
    expect(constructorCalls[2]).toEqual([100, 64]);
  });

  it("mosaic small canvas has imageSmoothingEnabled=false", () => {
    const created: MockOffscreenCanvas[] = [];
    const OrigMock = globalThis.OffscreenCanvas as unknown as typeof MockOffscreenCanvas;

    class TrackingCanvas extends OrigMock {
      constructor(w: number, h: number) {
        super(w, h);
        created.push(this);
      }
    }

    // @ts-expect-error — stub for test environment
    globalThis.OffscreenCanvas = TrackingCanvas;

    const { ctx } = makeCtx();
    pixelate(ctx, makeRect(0, 0, 64, 64), 8);

    // @ts-expect-error — stub for test environment
    globalThis.OffscreenCanvas = OrigMock;

    // small canvas (index 0) and mosaic canvas (index 1) must have imageSmoothingEnabled=false
    expect(created[0]._ctx.imageSmoothingEnabled).toBe(false);
    expect(created[1]._ctx.imageSmoothingEnabled).toBe(false);
  });
});

// ── compositeAll ───────────────────────────────────────────────────────────────

describe("compositeAll", () => {
  it("calls pixelate for each rect (drawImage once per rect)", () => {
    const { ctx, calls } = makeCtx();
    const rects: Rect[] = [
      makeRect(0, 0, 50, 50),
      makeRect(60, 60, 40, 40),
      makeRect(10, 10, 20, 20),
    ];
    compositeAll(ctx, rects, 3);

    // Each pixelate call issues at least one drawImage on ctx (the final composite)
    const drawImageCalls = calls.filter((c) => c.method === "drawImage");
    expect(drawImageCalls).toHaveLength(3);
  });

  it("uses correct blockSize per strength level", () => {
    // Verify compositeAll with strength=1 (blockSize=8) creates small canvases
    // with dimensions ceil(w/8) × ceil(h/8)
    const constructorCalls: Array<[number, number]> = [];
    const OrigMock = globalThis.OffscreenCanvas as unknown as typeof MockOffscreenCanvas;

    class TrackingCanvas extends OrigMock {
      constructor(w: number, h: number) {
        super(w, h);
        constructorCalls.push([w, h]);
      }
    }

    // @ts-expect-error — stub for test environment
    globalThis.OffscreenCanvas = TrackingCanvas;

    const { ctx } = makeCtx();
    // One rect: 80×80, strength=1 (blockSize=8) → smallW=ceil(80/8)=10, smallH=10
    compositeAll(ctx, [makeRect(0, 0, 80, 80)], 1);

    // @ts-expect-error — stub for test environment
    globalThis.OffscreenCanvas = OrigMock;

    expect(constructorCalls[0]).toEqual([10, 10]); // small canvas
    expect(constructorCalls[1]).toEqual([80, 80]); // mosaic canvas
  });

  it("handles empty rects array without error", () => {
    const { ctx, calls } = makeCtx();
    compositeAll(ctx, [], 3);
    expect(calls).toHaveLength(0);
  });

  it("uses strength 2 → blockSize 16", () => {
    const constructorCalls: Array<[number, number]> = [];
    const OrigMock = globalThis.OffscreenCanvas as unknown as typeof MockOffscreenCanvas;

    class TrackingCanvas extends OrigMock {
      constructor(w: number, h: number) {
        super(w, h);
        constructorCalls.push([w, h]);
      }
    }

    // @ts-expect-error — stub for test environment
    globalThis.OffscreenCanvas = TrackingCanvas;

    const { ctx } = makeCtx();
    // rect: 64×32, strength=2 (blockSize=16) → smallW=4, smallH=2
    compositeAll(ctx, [makeRect(5, 5, 64, 32)], 2);

    // @ts-expect-error — stub for test environment
    globalThis.OffscreenCanvas = OrigMock;

    expect(constructorCalls[0]).toEqual([4, 2]); // small canvas
    expect(constructorCalls[1]).toEqual([64, 32]); // mosaic canvas
  });
});
