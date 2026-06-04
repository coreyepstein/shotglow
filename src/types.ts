/** A redaction rectangle drawn on the canvas. */
export type Rect = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

/** Key used to store a captured image in chrome.storage.session */
export type SessionImageKey = string;

// ── Beautify settings ────────────────────────────────────────────────────────
// Screenshot-beautifier state. Orthogonal to redactions (`Rect[]`): redactions
// are stored in source-image pixel coordinates, beautify settings describe the
// frame/background drawn AROUND that fixed coordinate space. They are composed
// only at export time (see clipboard.buildComposite).

/** A single gradient color stop. `offset` is 0..1. */
export type GradientStop = { offset: number; color: string };

/** The base layer drawn behind the (scaled, framed) image. */
export type BackgroundSpec =
  | { type: "solid"; color: string }
  | { type: "gradient"; presetId: string }
  | { type: "gradient"; custom: { angle: number; stops: GradientStop[] } }
  | { type: "image"; presetId: string };

/**
 * Optional repeating pattern drawn ON TOP of the background (and behind the
 * image card) — composes over any solid/gradient/image base.
 */
export type PatternOverlay = {
  presetId: string | null; // null = no overlay
  color: string;
  opacity: number; // 0..1
};

/** Drop shadow applied to the image card. Dimensions are in output pixels. */
export type ShadowSpec = {
  enabled: boolean;
  blur: number;
  opacity: number; // 0..1
  offsetX: number;
  offsetY: number;
};

/** Output aspect ratio. "auto" = no expansion (frame hugs the content). */
export type AspectPreset = "auto" | "1:1" | "4:3" | "16:9";

/** Full beautifier configuration, persisted to chrome.storage.local. */
export type BeautifySettings = {
  margin: number; // px of padding around the scaled image, in output px
  scale: number; // 0.1..1 multiplier of natural image size
  radius: number; // corner radius px applied to the image rect
  shadow: ShadowSpec;
  background: BackgroundSpec;
  pattern: PatternOverlay;
  aspect: AspectPreset;
};

/** Message sent from background to content script requesting a blob/data URL be bridged */
export type BlobBridgeMessage = {
  type: "REDACT_FETCH_BLOB";
  srcUrl: string;
};

/** Response from content script with the base64 data URL */
export type BlobBridgeResponse =
  | { success: true; dataUrl: string }
  | { success: false; error: string };
