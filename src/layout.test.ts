import { describe, it, expect } from "bun:test";
import type { BeautifySettings, Rect } from "./types.js";
import {
  computeOutputLayout,
  mapRectToOutput,
  aspectRatio,
  clampRadius,
  makeGradientEndpoints,
} from "./layout.js";

function settings(partial: Partial<BeautifySettings>): BeautifySettings {
  return {
    margin: 0,
    scale: 1,
    radius: 0,
    shadow: { enabled: false, blur: 0, opacity: 0, offsetX: 0, offsetY: 0 },
    background: { type: "solid", color: "#000" },
    pattern: { presetId: null, color: "#ffffff", opacity: 0 },
    aspect: "auto",
    ...partial,
  };
}

describe("aspectRatio", () => {
  it("auto → null", () => expect(aspectRatio("auto")).toBeNull());
  it("1:1 → 1", () => expect(aspectRatio("1:1")).toBe(1));
  it("4:3 → 1.333…", () => expect(aspectRatio("4:3")).toBeCloseTo(4 / 3, 6));
  it("16:9 → 1.777…", () => expect(aspectRatio("16:9")).toBeCloseTo(16 / 9, 6));
});

describe("clampRadius", () => {
  it("caps at half the shorter side", () => expect(clampRadius(999, 800, 600)).toBe(300));
  it("never negative", () => expect(clampRadius(-5, 800, 600)).toBe(0));
  it("passes through valid values", () => expect(clampRadius(12, 800, 600)).toBe(12));
});

describe("computeOutputLayout", () => {
  it("auto: content = image + symmetric margin, image centered", () => {
    const l = computeOutputLayout(settings({ margin: 64, radius: 12 }), 800, 600);
    expect(l).toEqual({
      canvasW: 928,
      canvasH: 728,
      imageX: 64,
      imageY: 64,
      imageW: 800,
      imageH: 600,
      radius: 12,
      scale: 1,
    });
  });

  it("16:9 expands width (never crops), recenters image", () => {
    const l = computeOutputLayout(settings({ margin: 64, aspect: "16:9" }), 800, 600);
    expect(l.canvasH).toBe(728);
    expect(l.canvasW).toBe(Math.round(728 * (16 / 9))); // 1294
    expect(l.imageY).toBe(64);
    expect(l.imageX).toBe(Math.round((l.canvasW - 800) / 2));
  });

  it("1:1 expands height, recenters image", () => {
    const l = computeOutputLayout(settings({ margin: 64, aspect: "1:1" }), 800, 600);
    expect(l.canvasW).toBe(928);
    expect(l.canvasH).toBe(928);
    expect(l.imageX).toBe(64);
    expect(l.imageY).toBe(164);
  });

  it("scale halves the image and recenters within margins", () => {
    const l = computeOutputLayout(settings({ scale: 0.5, margin: 20 }), 800, 600);
    expect(l.imageW).toBe(400);
    expect(l.imageH).toBe(300);
    expect(l.canvasW).toBe(440);
    expect(l.canvasH).toBe(340);
    expect(l.imageX).toBe(20);
    expect(l.imageY).toBe(20);
    expect(l.scale).toBe(0.5);
  });

  it("radius is clamped against the scaled image size", () => {
    const l = computeOutputLayout(settings({ scale: 0.5, radius: 999 }), 800, 600);
    // scaled 400×300 → max radius 150
    expect(l.radius).toBe(150);
  });
});

describe("mapRectToOutput", () => {
  it("offsets and scales a rect into output coordinates", () => {
    const layout = computeOutputLayout(settings({ scale: 0.5, margin: 20 }), 800, 600);
    const rect: Rect = { id: "r", x: 100, y: 50, w: 40, h: 20 };
    expect(mapRectToOutput(rect, layout)).toEqual({
      id: "r",
      x: 20 + 100 * 0.5, // 70
      y: 20 + 50 * 0.5, // 45
      w: 20,
      h: 10,
    });
  });

  it("identity-ish at scale 1, margin 0", () => {
    const layout = computeOutputLayout(settings({}), 800, 600);
    const rect: Rect = { id: "r", x: 10, y: 20, w: 30, h: 40 };
    expect(mapRectToOutput(rect, layout)).toEqual({ id: "r", x: 10, y: 20, w: 30, h: 40 });
  });
});

describe("makeGradientEndpoints", () => {
  it("0deg → bottom-to-top", () => {
    const e = makeGradientEndpoints(0, 100, 100);
    expect(e.x0).toBeCloseTo(50, 5);
    expect(e.y0).toBeCloseTo(100, 5);
    expect(e.x1).toBeCloseTo(50, 5);
    expect(e.y1).toBeCloseTo(0, 5);
  });

  it("90deg → left-to-right", () => {
    const e = makeGradientEndpoints(90, 100, 100);
    expect(e.x0).toBeCloseTo(0, 5);
    expect(e.x1).toBeCloseTo(100, 5);
    expect(e.y0).toBeCloseTo(50, 5);
    expect(e.y1).toBeCloseTo(50, 5);
  });

  it("135deg → top-left-to-bottom-right", () => {
    const e = makeGradientEndpoints(135, 100, 100);
    expect(e.x0).toBeCloseTo(0, 5);
    expect(e.y0).toBeCloseTo(0, 5);
    expect(e.x1).toBeCloseTo(100, 5);
    expect(e.y1).toBeCloseTo(100, 5);
  });
});
