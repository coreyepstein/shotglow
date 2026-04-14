import type { Rect } from "./types.js";
import { compositeAll } from "./redact.js";

/** Promisify canvas.toBlob */
export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("canvas.toBlob returned null"));
    }, "image/png");
  });
}

/**
 * Build the redacted composite canvas from base canvas + rects.
 * Returns a new HTMLCanvasElement at source image dimensions.
 */
export function buildComposite(baseCanvas: HTMLCanvasElement, rects: Rect[], strength: number): HTMLCanvasElement {
  const composite = document.createElement("canvas");
  composite.width = baseCanvas.width;
  composite.height = baseCanvas.height;
  const ctx = composite.getContext("2d");
  if (!ctx) throw new Error("Could not get 2D canvas context");
  ctx.drawImage(baseCanvas, 0, 0);
  compositeAll(ctx, rects, strength);
  return composite;
}

/**
 * Copy the redacted image to clipboard.
 * Must be called from within a click handler (user gesture) for clipboard API to work.
 */
export async function copyRedactedToClipboard(baseCanvas: HTMLCanvasElement, rects: Rect[], strength: number): Promise<void> {
  const composite = buildComposite(baseCanvas, rects, strength);
  const blob = await canvasToBlob(composite);
  await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
}

/**
 * Trigger a PNG download of the redacted image.
 */
export async function downloadRedacted(baseCanvas: HTMLCanvasElement, rects: Rect[], strength: number): Promise<void> {
  const composite = buildComposite(baseCanvas, rects, strength);
  const blob = await canvasToBlob(composite);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "redacted.png";
  a.click();
  URL.revokeObjectURL(url);
}
