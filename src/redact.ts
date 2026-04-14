import type { Rect } from "./types.js";

/** Map strength 1–4 to block pixel size */
export function strengthToBlockSize(strength: number): number {
  const map: Record<number, number> = { 1: 8, 2: 16, 3: 32, 4: 64 };
  return map[strength] ?? 32;
}

/**
 * Pixelate a rectangular region of `ctx` in-place.
 * Algorithm: scale region DOWN by 1/blockSize (imageSmoothingEnabled=false),
 * then scale back UP to original size — produces mosaic effect.
 * Then apply a feathered alpha mask (4px soft edge at border).
 */
export function pixelate(ctx: CanvasRenderingContext2D, rect: Rect, blockSize: number): void {
  // Guard: skip degenerate rects
  if (rect.w < 1 || rect.h < 1 || blockSize < 1) return;

  const { x, y, w, h } = rect;

  // Step 1: Scale region DOWN into a small offscreen canvas (no smoothing = mosaic)
  const smallW = Math.max(1, Math.ceil(w / blockSize));
  const smallH = Math.max(1, Math.ceil(h / blockSize));

  const small = new OffscreenCanvas(smallW, smallH);
  const smallCtx = small.getContext("2d")!;
  smallCtx.imageSmoothingEnabled = false;
  smallCtx.drawImage(ctx.canvas, x, y, w, h, 0, 0, smallW, smallH);

  // Step 2: Scale back UP to original size — this produces the mosaic/pixelate effect
  const mosaic = new OffscreenCanvas(w, h);
  const mosaicCtx = mosaic.getContext("2d")!;
  mosaicCtx.imageSmoothingEnabled = false;
  mosaicCtx.drawImage(small, 0, 0, smallW, smallH, 0, 0, w, h);

  // Step 3: Build a feathered alpha mask
  // Strategy: start with a blank (transparent) mask canvas, use source-over to
  // paint 4 gradient strips (each edge transparent→opaque), then fill center opaque.
  // This avoids destination-in accumulation artifacts at corners.
  const FEATHER = 4;
  const mask = new OffscreenCanvas(w, h);
  const maskCtx = mask.getContext("2d")!;

  // Left edge: transparent at x=0, opaque at x=FEATHER
  const leftGrad = maskCtx.createLinearGradient(0, 0, FEATHER, 0);
  leftGrad.addColorStop(0, "rgba(255,255,255,0)");
  leftGrad.addColorStop(1, "rgba(255,255,255,1)");
  maskCtx.fillStyle = leftGrad;
  maskCtx.fillRect(0, 0, FEATHER, h);

  // Right edge: opaque at x=w-FEATHER, transparent at x=w
  const rightGrad = maskCtx.createLinearGradient(w - FEATHER, 0, w, 0);
  rightGrad.addColorStop(0, "rgba(255,255,255,1)");
  rightGrad.addColorStop(1, "rgba(255,255,255,0)");
  maskCtx.fillStyle = rightGrad;
  maskCtx.fillRect(w - FEATHER, 0, FEATHER, h);

  // Top edge: transparent at y=0, opaque at y=FEATHER
  const topGrad = maskCtx.createLinearGradient(0, 0, 0, FEATHER);
  topGrad.addColorStop(0, "rgba(255,255,255,0)");
  topGrad.addColorStop(1, "rgba(255,255,255,1)");
  maskCtx.fillStyle = topGrad;
  maskCtx.fillRect(0, 0, w, FEATHER);

  // Bottom edge: opaque at y=h-FEATHER, transparent at y=h
  const botGrad = maskCtx.createLinearGradient(0, h - FEATHER, 0, h);
  botGrad.addColorStop(0, "rgba(255,255,255,1)");
  botGrad.addColorStop(1, "rgba(255,255,255,0)");
  maskCtx.fillStyle = botGrad;
  maskCtx.fillRect(0, h - FEATHER, w, FEATHER);

  // Fill the center region fully opaque (avoids transparent gaps if FEATHER strips don't overlap)
  const innerW = w - 2 * FEATHER;
  const innerH = h - 2 * FEATHER;
  if (innerW > 0 && innerH > 0) {
    maskCtx.fillStyle = "rgba(255,255,255,1)";
    maskCtx.fillRect(FEATHER, FEATHER, innerW, innerH);
  }

  // Apply mask to mosaic via destination-in (mosaic alpha = mask alpha)
  mosaicCtx.globalCompositeOperation = "destination-in";
  mosaicCtx.drawImage(mask, 0, 0);
  mosaicCtx.globalCompositeOperation = "source-over";

  // Step 4: Draw the masked mosaic back onto the original canvas
  ctx.drawImage(mosaic, x, y);
}

/**
 * Apply pixelation to all rects in order, destructively mutating ctx.
 * strength 1–4 maps to blockSize 8–64.
 */
export function compositeAll(ctx: CanvasRenderingContext2D, rects: Rect[], strength: number): void {
  const blockSize = strengthToBlockSize(strength);
  for (const rect of rects) {
    pixelate(ctx, rect, blockSize);
  }
}
