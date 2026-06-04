import type { Rect, BeautifySettings, AspectPreset } from "./types.js";

// ── Pure layout / geometry core ──────────────────────────────────────────────
// No DOM, no canvas, no chrome. Everything here is unit-testable under `bun test`.
// These functions are the single source of truth shared by the CSS live preview
// (editor) and the canvas export (clipboard) so the two cannot drift apart.

/** Computed geometry for a beautified export, in output-canvas pixels. */
export type OutputLayout = {
  canvasW: number;
  canvasH: number;
  imageX: number;
  imageY: number;
  imageW: number;
  imageH: number;
  radius: number;
  scale: number;
};

/** Parse an aspect preset into a numeric W/H ratio, or null for "auto". */
export function aspectRatio(preset: AspectPreset): number | null {
  switch (preset) {
    case "1:1":
      return 1;
    case "4:3":
      return 4 / 3;
    case "16:9":
      return 16 / 9;
    case "auto":
    default:
      return null;
  }
}

/** Clamp a corner radius so it never exceeds half the shorter side. */
export function clampRadius(radius: number, w: number, h: number): number {
  const max = Math.min(w, h) / 2;
  return Math.max(0, Math.min(radius, max));
}

/**
 * Compute the full output layout from settings + natural image size.
 * Scale the image → add symmetric margin → expand (never crop) to the aspect
 * ratio → center the image. All rounding happens here so the DOM preview and
 * the export canvas consume identical integers.
 */
export function computeOutputLayout(
  settings: BeautifySettings,
  naturalW: number,
  naturalH: number,
): OutputLayout {
  const scale = settings.scale;
  const scaledW = Math.max(1, Math.round(naturalW * scale));
  const scaledH = Math.max(1, Math.round(naturalH * scale));
  const margin = Math.max(0, Math.round(settings.margin));

  const contentW = scaledW + 2 * margin;
  const contentH = scaledH + 2 * margin;

  const ratio = aspectRatio(settings.aspect);
  let canvasW: number;
  let canvasH: number;
  if (ratio === null) {
    canvasW = contentW;
    canvasH = contentH;
  } else if (contentW / contentH < ratio) {
    // too tall → widen
    canvasH = contentH;
    canvasW = Math.round(contentH * ratio);
  } else {
    // too wide → heighten
    canvasW = contentW;
    canvasH = Math.round(contentW / ratio);
  }

  const imageX = Math.round((canvasW - scaledW) / 2);
  const imageY = Math.round((canvasH - scaledH) / 2);
  const radius = clampRadius(settings.radius, scaledW, scaledH);

  return { canvasW, canvasH, imageX, imageY, imageW: scaledW, imageH: scaledH, radius, scale };
}

/**
 * Map a stored image-space Rect into output-canvas coordinates.
 * The image is drawn at (imageX, imageY) scaled by `layout.scale`, so a
 * redaction at (rect.x, rect.y) lands at imageX + rect.x*scale, etc.
 */
export function mapRectToOutput(rect: Rect, layout: OutputLayout): Rect {
  return {
    id: rect.id,
    x: layout.imageX + rect.x * layout.scale,
    y: layout.imageY + rect.y * layout.scale,
    w: rect.w * layout.scale,
    h: rect.h * layout.scale,
  };
}

/** Trace a rounded-rectangle path onto a 2D context (no fill/stroke). */
export function roundedRectPath(
  ctx: {
    beginPath(): void;
    moveTo(x: number, y: number): void;
    arcTo(x1: number, y1: number, x2: number, y2: number, r: number): void;
    closePath(): void;
  },
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/**
 * Convert a CSS linear-gradient angle (0deg = to top, increasing clockwise)
 * into canvas gradient endpoints across a w×h box, with the gradient line
 * passing through the box center and 0/1 stops at the projected box extents
 * (matching the CSS gradient-line length |w·sinθ| + |h·cosθ|).
 */
export function makeGradientEndpoints(
  angleDeg: number,
  w: number,
  h: number,
): { x0: number; y0: number; x1: number; y1: number } {
  const angle = (((angleDeg % 360) + 360) % 360) * (Math.PI / 180);
  const dx = Math.sin(angle);
  const dy = -Math.cos(angle);
  const cx = w / 2;
  const cy = h / 2;
  const halfLen = (Math.abs(w * dx) + Math.abs(h * dy)) / 2;
  return {
    x0: cx - dx * halfLen,
    y0: cy - dy * halfLen,
    x1: cx + dx * halfLen,
    y1: cy + dy * halfLen,
  };
}
