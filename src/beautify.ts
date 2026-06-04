import type { BeautifySettings, BackgroundSpec, PatternOverlay, ShadowSpec, AspectPreset, GradientStop } from "./types.js";
import { computeOutputLayout, type OutputLayout } from "./layout.js";
import { resolveBackgroundCss, resolvePatternCss } from "./backgrounds.js";

// ── Defaults ─────────────────────────────────────────────────────────────────

export const DEFAULT_BEAUTIFY: BeautifySettings = {
  margin: 64,
  scale: 1,
  radius: 12,
  shadow: { enabled: true, blur: 40, opacity: 0.35, offsetX: 0, offsetY: 20 },
  background: { type: "gradient", presetId: "sunset" },
  pattern: { presetId: null, color: "#ffffff", opacity: 0.12 },
  aspect: "auto",
};

// Bounds used by both the sliders and the tolerant merge below.
export const BOUNDS = {
  margin: { min: 0, max: 400 },
  scale: { min: 0.1, max: 1 },
  radius: { min: 0, max: 200 },
  shadowBlur: { min: 0, max: 200 },
  shadowOpacity: { min: 0, max: 1 },
  shadowOffset: { min: -200, max: 200 },
  patternOpacity: { min: 0, max: 1 },
} as const;

const ASPECTS: AspectPreset[] = ["auto", "1:1", "4:3", "16:9"];

export function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function numIn(value: unknown, fallback: number, lo: number, hi: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return clamp(value, lo, hi);
  return fallback;
}

function isString(v: unknown): v is string {
  return typeof v === "string";
}

function validStop(s: unknown): s is GradientStop {
  return (
    !!s &&
    typeof s === "object" &&
    typeof (s as GradientStop).offset === "number" &&
    Number.isFinite((s as GradientStop).offset) &&
    typeof (s as GradientStop).color === "string"
  );
}

function mergeShadow(base: ShadowSpec, raw: unknown): ShadowSpec {
  if (!raw || typeof raw !== "object") return { ...base };
  const r = raw as Record<string, unknown>;
  return {
    enabled: typeof r.enabled === "boolean" ? r.enabled : base.enabled,
    blur: numIn(r.blur, base.blur, BOUNDS.shadowBlur.min, BOUNDS.shadowBlur.max),
    opacity: numIn(r.opacity, base.opacity, BOUNDS.shadowOpacity.min, BOUNDS.shadowOpacity.max),
    offsetX: numIn(r.offsetX, base.offsetX, BOUNDS.shadowOffset.min, BOUNDS.shadowOffset.max),
    offsetY: numIn(r.offsetY, base.offsetY, BOUNDS.shadowOffset.min, BOUNDS.shadowOffset.max),
  };
}

function mergeBackground(base: BackgroundSpec, raw: unknown): BackgroundSpec {
  if (!raw || typeof raw !== "object") return { ...base };
  const r = raw as Record<string, unknown>;
  switch (r.type) {
    case "solid":
      return isString(r.color) ? { type: "solid", color: r.color } : { ...base };
    case "gradient": {
      const custom = r.custom as { angle?: unknown; stops?: unknown } | undefined;
      if (custom && typeof custom === "object" && Array.isArray(custom.stops)) {
        const stops = custom.stops.filter(validStop);
        if (stops.length >= 2 && typeof custom.angle === "number" && Number.isFinite(custom.angle)) {
          return { type: "gradient", custom: { angle: custom.angle, stops } };
        }
        return { ...base };
      }
      return isString(r.presetId) ? { type: "gradient", presetId: r.presetId } : { ...base };
    }
    case "image":
      return isString(r.presetId) ? { type: "image", presetId: r.presetId } : { ...base };
    default:
      return { ...base };
  }
}

function mergePattern(base: PatternOverlay, raw: unknown): PatternOverlay {
  if (!raw || typeof raw !== "object") return { ...base };
  const r = raw as Record<string, unknown>;
  const presetId = isString(r.presetId) ? r.presetId : r.presetId === null ? null : base.presetId;
  return {
    presetId,
    color: isString(r.color) ? r.color : base.color,
    opacity: numIn(r.opacity, base.opacity, BOUNDS.patternOpacity.min, BOUNDS.patternOpacity.max),
  };
}

/**
 * Tolerant deep-merge of loaded storage onto defaults: validates and clamps
 * every field, fills missing ones, and ignores unknown keys. Forward-compatible
 * if new fields are added later.
 */
export function mergeBeautify(base: BeautifySettings, loaded: unknown): BeautifySettings {
  if (!loaded || typeof loaded !== "object") {
    return { ...base, shadow: { ...base.shadow }, background: { ...base.background }, pattern: { ...base.pattern } };
  }
  const l = loaded as Record<string, unknown>;
  return {
    margin: numIn(l.margin, base.margin, BOUNDS.margin.min, BOUNDS.margin.max),
    scale: numIn(l.scale, base.scale, BOUNDS.scale.min, BOUNDS.scale.max),
    radius: numIn(l.radius, base.radius, BOUNDS.radius.min, BOUNDS.radius.max),
    shadow: mergeShadow(base.shadow, l.shadow),
    background: mergeBackground(base.background, l.background),
    pattern: mergePattern(base.pattern, l.pattern),
    aspect: ASPECTS.includes(l.aspect as AspectPreset) ? (l.aspect as AspectPreset) : base.aspect,
  };
}

// ── Debounce ─────────────────────────────────────────────────────────────────

/** Trailing-edge debounce. */
export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): (...args: A) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (...args: A) => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, ms);
  };
}

// ── Live preview (DOM) ───────────────────────────────────────────────────────
// The one impure function in this module. Drives both the background host and
// the image card from the SAME computeOutputLayout result the export uses.

export type PreviewEls = {
  stage: HTMLElement; // visible pane (clips + centers the output frame)
  outputFrame: HTMLElement; // represents the full output canvas; carries the background
  patternLayer: HTMLElement; // pattern overlay, above background, behind the card
  wrapper: HTMLElement; // the image card (radius + shadow); holds the canvases
};

function shadowCss(s: ShadowSpec): string {
  if (!s.enabled) return "none";
  return `${s.offsetX}px ${s.offsetY}px ${s.blur}px rgba(0,0,0,${s.opacity})`;
}

/**
 * Apply current settings to the preview DOM. Returns the layout used (handy for
 * tests / callers). Image scale is realized via the output frame's CSS size and
 * a fit-to-stage transform — NOT a transform on the canvas itself — so canvas
 * pointer mapping (see editor.eventToImageCoords, which uses
 * getBoundingClientRect) stays correct under the fit scale.
 */
export function applyPreview(
  settings: BeautifySettings,
  els: PreviewEls,
  naturalW: number,
  naturalH: number,
): OutputLayout {
  const layout = computeOutputLayout(settings, naturalW, naturalH);

  // Background on the output frame.
  const bg = resolveBackgroundCss(settings.background);
  els.outputFrame.style.backgroundColor = bg.backgroundColor;
  els.outputFrame.style.backgroundImage = bg.backgroundImage;
  els.outputFrame.style.backgroundSize = bg.backgroundSize;
  els.outputFrame.style.backgroundRepeat = bg.backgroundRepeat;
  els.outputFrame.style.backgroundPosition = bg.backgroundPosition;

  // Pattern overlay on its own layer (above the background, behind the card).
  const pat = resolvePatternCss(settings.pattern);
  els.patternLayer.style.display = pat.display;
  els.patternLayer.style.backgroundColor = pat.backgroundColor;
  els.patternLayer.style.opacity = pat.opacity;
  els.patternLayer.style.maskImage = pat.maskImage;
  els.patternLayer.style.webkitMaskImage = pat.maskImage;

  // Output frame represents the full output canvas at 1:1 CSS px...
  els.outputFrame.style.width = `${layout.canvasW}px`;
  els.outputFrame.style.height = `${layout.canvasH}px`;

  // ...then scaled down to fit the visible stage (never scaled up past 1).
  const padPx = 24;
  const availW = Math.max(1, els.stage.clientWidth - padPx);
  const availH = Math.max(1, els.stage.clientHeight - padPx);
  const fit = Math.min(1, availW / layout.canvasW, availH / layout.canvasH);
  els.outputFrame.style.transform = `scale(${fit})`;
  els.outputFrame.style.transformOrigin = "center center";

  // Image card, positioned + sized within the output frame.
  els.wrapper.style.left = `${layout.imageX}px`;
  els.wrapper.style.top = `${layout.imageY}px`;
  els.wrapper.style.width = `${layout.imageW}px`;
  els.wrapper.style.height = `${layout.imageH}px`;
  els.wrapper.style.borderRadius = `${layout.radius}px`;
  els.wrapper.style.boxShadow = shadowCss(settings.shadow);

  return layout;
}
