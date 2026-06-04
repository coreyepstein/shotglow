import type { Rect, BeautifySettings, BackgroundSpec } from "./types.js";
import { compositeAll } from "./redact.js";
import { computeOutputLayout, mapRectToOutput, roundedRectPath, makeGradientEndpoints, type OutputLayout } from "./layout.js";
import {
  getGradientPreset,
  loadBackgroundAssets,
  type ResolvedBackgroundAssets,
} from "./backgrounds.js";

/** Promisify canvas.toBlob */
export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("canvas.toBlob returned null"));
    }, "image/png");
  });
}

/** Cover-fit an image source across a w×h region, centered. */
function drawImageCover(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource,
  w: number,
  h: number,
): void {
  const iw = (img as { width: number }).width;
  const ih = (img as { height: number }).height;
  if (!iw || !ih) return;
  const scale = Math.max(w / iw, h / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

/** Fill the whole output canvas with the chosen background. */
function drawBackground(
  ctx: CanvasRenderingContext2D,
  layout: OutputLayout,
  bg: BackgroundSpec,
  assets: ResolvedBackgroundAssets,
): void {
  const { canvasW, canvasH } = layout;
  switch (bg.type) {
    case "solid":
      ctx.fillStyle = bg.color;
      ctx.fillRect(0, 0, canvasW, canvasH);
      break;
    case "gradient": {
      let angle: number;
      let stops;
      if ("custom" in bg) {
        angle = bg.custom.angle;
        stops = bg.custom.stops;
      } else {
        const p = getGradientPreset(bg.presetId);
        if (!p) {
          ctx.fillStyle = "#1a1a1a";
          ctx.fillRect(0, 0, canvasW, canvasH);
          break;
        }
        angle = p.angle;
        stops = p.stops;
      }
      const { x0, y0, x1, y1 } = makeGradientEndpoints(angle, canvasW, canvasH);
      const g = ctx.createLinearGradient(x0, y0, x1, y1);
      for (const s of stops) g.addColorStop(Math.max(0, Math.min(1, s.offset)), s.color);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, canvasW, canvasH);
      break;
    }
    case "pattern": {
      ctx.fillStyle = bg.baseColor;
      ctx.fillRect(0, 0, canvasW, canvasH);
      if (assets.patternBitmap) {
        const pat = ctx.createPattern(assets.patternBitmap, "repeat");
        if (pat) {
          ctx.fillStyle = pat;
          ctx.fillRect(0, 0, canvasW, canvasH);
        }
      }
      break;
    }
    case "image":
      if (assets.imageBitmap) {
        drawImageCover(ctx, assets.imageBitmap, canvasW, canvasH);
      } else {
        ctx.fillStyle = "#1a1a1a";
        ctx.fillRect(0, 0, canvasW, canvasH);
      }
      break;
  }
}

/**
 * Build the final export canvas: background → shadow → clipped (scaled) image →
 * redactions. The scaled image is drawn at its output offset BEFORE compositeAll
 * so pixelate samples the correct pixels; redaction rects are mapped into
 * output-canvas coordinates. Background image/pattern bitmaps must be
 * pre-decoded (see loadBackgroundAssets) so this stays synchronous.
 */
export function buildComposite(
  baseCanvas: HTMLCanvasElement,
  rects: Rect[],
  strength: number,
  settings: BeautifySettings,
  assets: ResolvedBackgroundAssets = {},
): HTMLCanvasElement {
  const layout = computeOutputLayout(settings, baseCanvas.width, baseCanvas.height);

  const composite = document.createElement("canvas");
  composite.width = layout.canvasW;
  composite.height = layout.canvasH;
  const ctx = composite.getContext("2d");
  if (!ctx) throw new Error("Could not get 2D canvas context");

  // (1) Background fills the entire canvas.
  drawBackground(ctx, layout, settings.background, assets);

  // (2) Drop shadow: fill the rounded image rect with opaque black so only the
  // shadow shows (the image then covers the fill). Cleared via save/restore.
  if (settings.shadow.enabled) {
    ctx.save();
    ctx.shadowColor = `rgba(0,0,0,${settings.shadow.opacity})`;
    ctx.shadowBlur = settings.shadow.blur;
    ctx.shadowOffsetX = settings.shadow.offsetX;
    ctx.shadowOffsetY = settings.shadow.offsetY;
    roundedRectPath(ctx, layout.imageX, layout.imageY, layout.imageW, layout.imageH, layout.radius);
    ctx.fillStyle = "#000000";
    ctx.fill();
    ctx.restore();
  }

  // (3) Clip to the rounded image rect, then draw the (scaled) source image.
  ctx.save();
  roundedRectPath(ctx, layout.imageX, layout.imageY, layout.imageW, layout.imageH, layout.radius);
  ctx.clip();
  ctx.drawImage(
    baseCanvas,
    0,
    0,
    baseCanvas.width,
    baseCanvas.height,
    layout.imageX,
    layout.imageY,
    layout.imageW,
    layout.imageH,
  );

  // (4) Apply redactions in output-canvas coordinates, inside the same clip so
  // the mosaic respects the rounded corners.
  const mapped = rects.map((r) => mapRectToOutput(r, layout));
  compositeAll(ctx, mapped, strength);
  ctx.restore();

  return composite;
}

/**
 * Copy the redacted + beautified image to clipboard.
 * Must be called from within a click handler (user gesture) for the clipboard API to work.
 */
export async function copyRedactedToClipboard(
  baseCanvas: HTMLCanvasElement,
  rects: Rect[],
  strength: number,
  settings: BeautifySettings,
): Promise<void> {
  const assets = await loadBackgroundAssets(settings.background);
  const composite = buildComposite(baseCanvas, rects, strength, settings, assets);
  const blob = await canvasToBlob(composite);
  await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
}

/**
 * Trigger a PNG download of the redacted + beautified image.
 */
export async function downloadRedacted(
  baseCanvas: HTMLCanvasElement,
  rects: Rect[],
  strength: number,
  settings: BeautifySettings,
): Promise<void> {
  const assets = await loadBackgroundAssets(settings.background);
  const composite = buildComposite(baseCanvas, rects, strength, settings, assets);
  const blob = await canvasToBlob(composite);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "redacted.png";
  a.click();
  URL.revokeObjectURL(url);
}
