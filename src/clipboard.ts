import type { Rect, BeautifySettings, BackgroundSpec, PatternOverlay } from "./types.js";
import { compositeAll } from "./redact.js";
import { computeOutputLayout, mapRectToOutput, roundedRectPath, makeGradientEndpoints, type OutputLayout } from "./layout.js";
import { getGradientPreset, loadAssets, type ResolvedAssets } from "./backgrounds.js";

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
function drawImageCover(ctx: CanvasRenderingContext2D, img: CanvasImageSource, w: number, h: number): void {
  const iw = (img as { width: number }).width;
  const ih = (img as { height: number }).height;
  if (!iw || !ih) return;
  const scale = Math.max(w / iw, h / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

/** Fill the whole output canvas with the chosen base background. */
function drawBackground(
  ctx: CanvasRenderingContext2D,
  layout: OutputLayout,
  bg: BackgroundSpec,
  assets: ResolvedAssets,
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
    case "image":
      if (assets.baseImage) {
        drawImageCover(ctx, assets.baseImage, canvasW, canvasH);
      } else {
        ctx.fillStyle = "#1a1a1a";
        ctx.fillRect(0, 0, canvasW, canvasH);
      }
      break;
  }
}

/** Draw the tinted, repeating pattern overlay across the canvas, at its opacity. */
function drawPatternOverlay(
  ctx: CanvasRenderingContext2D,
  layout: OutputLayout,
  pattern: PatternOverlay,
  tile: CanvasImageSource | undefined,
): void {
  if (!pattern.presetId || !tile || pattern.opacity <= 0) return;
  const tw = (tile as { width: number }).width;
  const th = (tile as { height: number }).height;
  if (!tw || !th) return;

  // Recolor the (white-stroke) tile to the chosen color, preserving its alpha shape.
  const t = document.createElement("canvas");
  t.width = tw;
  t.height = th;
  const tc = t.getContext("2d");
  if (!tc) return;
  tc.drawImage(tile, 0, 0);
  tc.globalCompositeOperation = "source-in";
  tc.fillStyle = pattern.color;
  tc.fillRect(0, 0, tw, th);

  const pat = ctx.createPattern(t, "repeat");
  if (!pat) return;
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, pattern.opacity));
  ctx.fillStyle = pat;
  ctx.fillRect(0, 0, layout.canvasW, layout.canvasH);
  ctx.restore();
}

/**
 * Build the final export canvas: background → pattern overlay → shadow →
 * clipped (scaled) image → redactions. The scaled image is drawn at its output
 * offset BEFORE compositeAll so pixelate samples the correct pixels; redaction
 * rects are mapped into output-canvas coordinates. Image/pattern bitmaps must be
 * pre-decoded (see loadAssets) so this stays synchronous.
 */
export function buildComposite(
  baseCanvas: HTMLCanvasElement,
  rects: Rect[],
  strength: number,
  settings: BeautifySettings,
  assets: ResolvedAssets = {},
): HTMLCanvasElement {
  const layout = computeOutputLayout(settings, baseCanvas.width, baseCanvas.height);

  const composite = document.createElement("canvas");
  composite.width = layout.canvasW;
  composite.height = layout.canvasH;
  const ctx = composite.getContext("2d");
  if (!ctx) throw new Error("Could not get 2D canvas context");

  // (1) Base background fills the entire canvas.
  drawBackground(ctx, layout, settings.background, assets);

  // (1b) Pattern overlay on top of the background.
  drawPatternOverlay(ctx, layout, settings.pattern, assets.patternImage);

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
  const assets = await loadAssets(settings);
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
  const assets = await loadAssets(settings);
  const composite = buildComposite(baseCanvas, rects, strength, settings, assets);
  const blob = await canvasToBlob(composite);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "shotglow.png";
  a.click();
  URL.revokeObjectURL(url);
}
