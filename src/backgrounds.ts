import type { BackgroundSpec, PatternOverlay, GradientStop } from "./types.js";

// ── Background + overlay preset registry ─────────────────────────────────────
// Single source of truth shared by the controls UI (to render swatches) and the
// export pipeline (to resolve assets). Gradients are plain sRGB hex stops with a
// CSS angle so the CSS preview and the canvas export interpolate the same way.

export type GradientPreset = {
  id: string;
  name: string;
  angle: number; // CSS degrees
  stops: GradientStop[];
};

export type PatternPreset = {
  id: string;
  name: string;
  asset: string; // tileable, solid-stroke SVG under assets/patterns/ (tinted at runtime)
};

export type ImagePreset = {
  id: string;
  name: string;
  asset: string; // full wallpaper under assets/backgrounds/
};

export const GRADIENT_PRESETS: GradientPreset[] = [
  { id: "sunset", name: "Sunset", angle: 135, stops: [{ offset: 0, color: "#ff7e5f" }, { offset: 1, color: "#feb47b" }] },
  { id: "ocean", name: "Ocean", angle: 135, stops: [{ offset: 0, color: "#2193b0" }, { offset: 1, color: "#6dd5ed" }] },
  { id: "grape", name: "Grape", angle: 135, stops: [{ offset: 0, color: "#6a11cb" }, { offset: 1, color: "#2575fc" }] },
  { id: "mint", name: "Mint", angle: 135, stops: [{ offset: 0, color: "#11998e" }, { offset: 1, color: "#38ef7d" }] },
  { id: "candy", name: "Candy", angle: 135, stops: [{ offset: 0, color: "#ff9a9e" }, { offset: 1, color: "#fecfef" }] },
  { id: "peach", name: "Peach", angle: 135, stops: [{ offset: 0, color: "#ee9ca7" }, { offset: 1, color: "#ffdde1" }] },
  {
    id: "dusk",
    name: "Dusk",
    angle: 135,
    stops: [{ offset: 0, color: "#355c7d" }, { offset: 0.5, color: "#c06c84" }, { offset: 1, color: "#f67280" }],
  },
  {
    id: "midnight",
    name: "Midnight",
    angle: 135,
    stops: [{ offset: 0, color: "#0f2027" }, { offset: 0.5, color: "#203a43" }, { offset: 1, color: "#2c5364" }],
  },
];

export const PATTERN_PRESETS: PatternPreset[] = [
  { id: "dots", name: "Dots", asset: "assets/patterns/dots.svg" },
  { id: "grid", name: "Grid", asset: "assets/patterns/grid.svg" },
  { id: "diagonal", name: "Diagonal", asset: "assets/patterns/diagonal.svg" },
  { id: "crosshatch", name: "Crosshatch", asset: "assets/patterns/crosshatch.svg" },
];

export const IMAGE_PRESETS: ImagePreset[] = [
  { id: "aurora", name: "Aurora", asset: "assets/backgrounds/aurora.svg" },
  { id: "sunset", name: "Sunset", asset: "assets/backgrounds/sunset.svg" },
  { id: "ocean", name: "Ocean", asset: "assets/backgrounds/ocean.svg" },
  { id: "dusk", name: "Dusk", asset: "assets/backgrounds/dusk.svg" },
  { id: "forest", name: "Forest", asset: "assets/backgrounds/forest.svg" },
  { id: "graphite", name: "Graphite", asset: "assets/backgrounds/graphite.svg" },
];

export function getGradientPreset(id: string): GradientPreset | undefined {
  return GRADIENT_PRESETS.find((p) => p.id === id);
}
export function getPatternPreset(id: string): PatternPreset | undefined {
  return PATTERN_PRESETS.find((p) => p.id === id);
}
export function getImagePreset(id: string): ImagePreset | undefined {
  return IMAGE_PRESETS.find((p) => p.id === id);
}

/** Resolve a bundled asset path to a runtime URL (chrome ext URL at runtime). */
export function assetUrl(path: string): string {
  if (typeof chrome !== "undefined" && chrome.runtime && typeof chrome.runtime.getURL === "function") {
    return chrome.runtime.getURL(path);
  }
  return path;
}

// ── CSS resolution (live preview) ────────────────────────────────────────────

/** A set of CSS background-* properties to apply to the preview stage. */
export type BackgroundCss = {
  backgroundColor: string;
  backgroundImage: string;
  backgroundSize: string;
  backgroundRepeat: string;
  backgroundPosition: string;
};

const EMPTY_CSS: BackgroundCss = {
  backgroundColor: "transparent",
  backgroundImage: "none",
  backgroundSize: "auto",
  backgroundRepeat: "no-repeat",
  backgroundPosition: "center",
};

function gradientCss(angle: number, stops: GradientStop[]): string {
  const parts = stops.map((s) => `${s.color} ${Math.round(s.offset * 100)}%`).join(", ");
  return `linear-gradient(${angle}deg, ${parts})`;
}

/** Build the CSS background properties for the base background (editor preview). */
export function resolveBackgroundCss(bg: BackgroundSpec): BackgroundCss {
  switch (bg.type) {
    case "solid":
      return { ...EMPTY_CSS, backgroundColor: bg.color };
    case "gradient": {
      if ("custom" in bg) {
        return { ...EMPTY_CSS, backgroundImage: gradientCss(bg.custom.angle, bg.custom.stops) };
      }
      const p = getGradientPreset(bg.presetId);
      if (!p) return { ...EMPTY_CSS, backgroundColor: "#1a1a1a" };
      return { ...EMPTY_CSS, backgroundImage: gradientCss(p.angle, p.stops) };
    }
    case "image": {
      const p = getImagePreset(bg.presetId);
      return {
        ...EMPTY_CSS,
        backgroundColor: "#1a1a1a",
        backgroundImage: p ? `url("${assetUrl(p.asset)}")` : "none",
        backgroundSize: "cover",
        backgroundPosition: "center",
      };
    }
    default:
      return EMPTY_CSS;
  }
}

/** CSS for the pattern overlay layer (a separate element above the background). */
export type PatternCss = {
  display: string;
  maskImage: string;
  backgroundColor: string;
  opacity: string;
};

export function resolvePatternCss(p: PatternOverlay): PatternCss {
  const preset = p.presetId ? getPatternPreset(p.presetId) : undefined;
  if (!preset) {
    return { display: "none", maskImage: "none", backgroundColor: "transparent", opacity: "0" };
  }
  return {
    display: "block",
    maskImage: `url("${assetUrl(preset.asset)}")`,
    backgroundColor: p.color,
    opacity: String(p.opacity),
  };
}

// ── Asset resolution (export) ────────────────────────────────────────────────

export type ResolvedAssets = {
  baseImage?: CanvasImageSource;
  patternImage?: CanvasImageSource;
};

const imageCache = new Map<string, Promise<HTMLImageElement>>();

function loadImage(url: string): Promise<HTMLImageElement> {
  const cached = imageCache.get(url);
  if (cached) return cached;
  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load asset: ${url}`));
    img.src = url;
  });
  imageCache.set(url, promise);
  return promise;
}

async function tryLoad(url: string): Promise<HTMLImageElement | undefined> {
  try {
    return await loadImage(url);
  } catch {
    return undefined;
  }
}

/**
 * Pre-decode any bitmaps the export needs (base wallpaper image + pattern tile)
 * so buildComposite can stay synchronous. Solid/gradient with no pattern → {}.
 */
export async function loadAssets(settings: {
  background: BackgroundSpec;
  pattern: PatternOverlay;
}): Promise<ResolvedAssets> {
  const out: ResolvedAssets = {};
  if (settings.background.type === "image") {
    const p = getImagePreset(settings.background.presetId);
    if (p) out.baseImage = await tryLoad(assetUrl(p.asset));
  }
  if (settings.pattern.presetId) {
    const p = getPatternPreset(settings.pattern.presetId);
    if (p) out.patternImage = await tryLoad(assetUrl(p.asset));
  }
  return out;
}
