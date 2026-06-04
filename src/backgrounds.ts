import type { BackgroundSpec, GradientStop } from "./types.js";

// ── Background preset registry ───────────────────────────────────────────────
// Single source of truth shared by the controls UI (to render swatches) and the
// export pipeline (to resolve assets). Gradients are defined as plain sRGB hex
// stops with a CSS angle so the CSS preview and the canvas export interpolate
// the same way (see core/clipboard makeGradientEndpoints + parity notes).

export type GradientPreset = {
  id: string;
  name: string;
  angle: number; // CSS degrees
  stops: GradientStop[];
};

export type PatternPreset = {
  id: string;
  name: string;
  asset: string; // tileable image under assets/patterns/
  defaultBaseColor: string;
};

export type ImagePreset = {
  id: string;
  name: string;
  asset: string; // full wallpaper under assets/backgrounds/
  thumb: string; // small thumbnail for the picker grid
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
  { id: "dots", name: "Dots", asset: "assets/patterns/dots.svg", defaultBaseColor: "#1e293b" },
  { id: "grid", name: "Grid", asset: "assets/patterns/grid.svg", defaultBaseColor: "#1e293b" },
  { id: "diagonal", name: "Diagonal", asset: "assets/patterns/diagonal.svg", defaultBaseColor: "#312e4e" },
  { id: "crosshatch", name: "Crosshatch", asset: "assets/patterns/crosshatch.svg", defaultBaseColor: "#0f2027" },
];

// Wallpaper image presets are generated at dev time via `bun run gen:wallpapers`
// (Codex CLI imagegen) and dropped into assets/backgrounds/. Add an entry here
// per generated wallpaper; until then the Image background tab shows an empty
// state. See scripts/gen-wallpapers.mjs for the prompt manifest.
export const IMAGE_PRESETS: ImagePreset[] = [];

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

/** Build the CSS background properties for a spec (for the editor preview). */
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
    case "pattern": {
      const p = getPatternPreset(bg.presetId);
      return {
        ...EMPTY_CSS,
        backgroundColor: bg.baseColor,
        backgroundImage: p ? `url("${assetUrl(p.asset)}")` : "none",
        backgroundRepeat: "repeat",
      };
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

// ── Asset resolution (export) ────────────────────────────────────────────────

export type ResolvedBackgroundAssets = {
  patternBitmap?: CanvasImageSource;
  imageBitmap?: CanvasImageSource;
};

const imageCache = new Map<string, Promise<HTMLImageElement>>();

function loadImage(url: string): Promise<HTMLImageElement> {
  const cached = imageCache.get(url);
  if (cached) return cached;
  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load background asset: ${url}`));
    img.src = url;
  });
  imageCache.set(url, promise);
  return promise;
}

/**
 * Pre-decode any bitmaps a background needs so buildComposite can stay
 * synchronous. Solid/gradient backgrounds resolve to {} (nothing to load).
 */
export async function loadBackgroundAssets(bg: BackgroundSpec): Promise<ResolvedBackgroundAssets> {
  if (bg.type === "pattern") {
    const p = getPatternPreset(bg.presetId);
    if (p) {
      try {
        return { patternBitmap: await loadImage(assetUrl(p.asset)) };
      } catch {
        return {};
      }
    }
  }
  if (bg.type === "image") {
    const p = getImagePreset(bg.presetId);
    if (p) {
      try {
        return { imageBitmap: await loadImage(assetUrl(p.asset)) };
      } catch {
        return {};
      }
    }
  }
  return {};
}
