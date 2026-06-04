import type { Rect, BeautifySettings, BackgroundSpec } from "./types.js";
import { copyRedactedToClipboard, downloadRedacted } from "./clipboard.js";
import { loadStrength, saveStrength, loadBeautify, saveBeautify } from "./storage.js";
import { DEFAULT_BEAUTIFY, applyPreview, debounce, type PreviewEls } from "./beautify.js";
import { GRADIENT_PRESETS, PATTERN_PRESETS, IMAGE_PRESETS, resolveBackgroundCss } from "./backgrounds.js";

console.log("Redact-It editor loaded.");

// ── Undo/Redo types ────────────────────────────────────────────────────────────

type UndoAction =
  | { type: "add"; rect: Rect }
  | { type: "delete"; rect: Rect; index: number };

// ── State ──────────────────────────────────────────────────────────────────────

let rects: Rect[] = [];
let selectedId: string | null = null;
let dragState: { startX: number; startY: number; live: Rect | null } | null = null;
let strength = 3;
let beautify: BeautifySettings = { ...DEFAULT_BEAUTIFY };

const undoStack: UndoAction[] = [];
const redoStack: UndoAction[] = [];

// Canvas references (populated after DOMContentLoaded)
let baseCanvas: HTMLCanvasElement;
let overlayCanvas: HTMLCanvasElement;
let overlayCtx: CanvasRenderingContext2D;

// Preview-frame references (populated after DOMContentLoaded)
let previewEls: PreviewEls | null = null;

const saveBeautifyDebounced = debounce((s: BeautifySettings) => {
  saveBeautify(s).catch((err) => console.error("Redact-It: failed to save beautify settings", err));
}, 250);

// ── Drawing ────────────────────────────────────────────────────────────────────

/** Normalize a rect so width/height are always positive. */
function normalizeRect(x: number, y: number, w: number, h: number): { x: number; y: number; w: number; h: number } {
  return {
    x: w >= 0 ? x : x + w,
    y: h >= 0 ? y : y + h,
    w: Math.abs(w),
    h: Math.abs(h),
  };
}

/** Re-render the overlay canvas from current state. */
function draw(livePreview?: Rect): void {
  overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

  // Draw committed rects
  for (const rect of rects) {
    const isSelected = rect.id === selectedId;

    // Semi-transparent dark fill
    overlayCtx.fillStyle = "#00000066";
    overlayCtx.fillRect(rect.x, rect.y, rect.w, rect.h);

    if (isSelected) {
      // Dashed yellow stroke for selected
      overlayCtx.strokeStyle = "#ffcc00";
      overlayCtx.lineWidth = 2;
      overlayCtx.setLineDash([6, 3]);
      overlayCtx.strokeRect(rect.x, rect.y, rect.w, rect.h);
      overlayCtx.setLineDash([]);

      // 8px corner handles
      drawCornerHandles(rect);
    } else {
      // Solid white stroke
      overlayCtx.strokeStyle = "#ffffff";
      overlayCtx.lineWidth = 2;
      overlayCtx.setLineDash([]);
      overlayCtx.strokeRect(rect.x, rect.y, rect.w, rect.h);
    }
  }

  // Draw live drag preview
  if (livePreview) {
    overlayCtx.strokeStyle = "#4444ff";
    overlayCtx.lineWidth = 2;
    overlayCtx.setLineDash([5, 4]);
    overlayCtx.strokeRect(livePreview.x, livePreview.y, livePreview.w, livePreview.h);
    overlayCtx.setLineDash([]);
  }

  updateRectCount();
}

/** Draw 8px filled square handles at the four corners of a rect. */
function drawCornerHandles(rect: Rect): void {
  const SIZE = 8;
  const HALF = SIZE / 2;
  const corners = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.w, y: rect.y },
    { x: rect.x, y: rect.y + rect.h },
    { x: rect.x + rect.w, y: rect.y + rect.h },
  ];
  overlayCtx.fillStyle = "#ffcc00";
  for (const corner of corners) {
    overlayCtx.fillRect(corner.x - HALF, corner.y - HALF, SIZE, SIZE);
  }
}

// ── Rect count indicator ───────────────────────────────────────────────────────

function updateRectCount(): void {
  const el = document.getElementById("rect-count");
  if (!el) return;
  const n = rects.length;
  el.textContent = n === 1 ? "1 rect" : `${n} rects`;
}

// ── Hit testing ────────────────────────────────────────────────────────────────

/** Return the topmost rect at (x, y), or null. */
function rectAtPoint(x: number, y: number): Rect | null {
  for (let i = rects.length - 1; i >= 0; i--) {
    const r = rects[i];
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
      return r;
    }
  }
  return null;
}

// ── Undo/Redo operations ───────────────────────────────────────────────────────

function pushAdd(rect: Rect): void {
  rects.push(rect);
  undoStack.push({ type: "add", rect });
  redoStack.length = 0; // new action clears redo
}

function pushDelete(rect: Rect): void {
  const index = rects.findIndex((r) => r.id === rect.id);
  if (index === -1) return;
  rects.splice(index, 1);
  undoStack.push({ type: "delete", rect, index });
  redoStack.length = 0;
}

function undo(): boolean {
  const action = undoStack.pop();
  if (!action) return false;

  if (action.type === "add") {
    rects = rects.filter((r) => r.id !== action.rect.id);
    redoStack.push(action);
  } else {
    // delete was undone — restore rect at its original index
    rects.splice(action.index, 0, action.rect);
    redoStack.push(action);
  }

  // Clear selection if the selected rect was affected
  if (selectedId && !rects.find((r) => r.id === selectedId)) {
    selectedId = null;
  }

  return true;
}

function redo(): boolean {
  const action = redoStack.pop();
  if (!action) return false;

  if (action.type === "add") {
    rects.push(action.rect);
    undoStack.push(action);
  } else {
    rects.splice(action.index, 1);
    undoStack.push(action);
  }

  // Clear selection if it no longer exists
  if (selectedId && !rects.find((r) => r.id === selectedId)) {
    selectedId = null;
  }

  return true;
}

// ── Keyboard shortcut routing ──────────────────────────────────────────────────

type ShortcutAction = "undo" | "redo" | "copy" | "download" | "close";

export function resolveKeyboardShortcut(e: {
  key: string;
  metaKey: boolean;
  shiftKey: boolean;
  ctrlKey: boolean;
}): ShortcutAction | null {
  const mod = e.metaKey || e.ctrlKey;

  if (mod && !e.shiftKey && e.key === "z") return "undo";
  if (mod && e.shiftKey && e.key === "z") return "redo";
  if (mod && e.key === "c") return "copy";
  if (mod && e.key === "s") return "download";
  if (!mod && e.key === "Escape") return "close";

  return null;
}

// ── Mouse interaction ──────────────────────────────────────────────────────────

/**
 * Convert a mouse event to source-image (bitmap) coordinates. Uses
 * getBoundingClientRect so it stays correct regardless of how the canvas is
 * CSS-sized (image scale) or visually transformed (fit-to-stage scaling) —
 * unlike e.offsetX/offsetY, which break under ancestor transforms.
 */
function eventToImageCoords(e: MouseEvent, canvas: HTMLCanvasElement): { x: number; y: number } {
  const r = canvas.getBoundingClientRect();
  const sx = r.width > 0 ? canvas.width / r.width : 1;
  const sy = r.height > 0 ? canvas.height / r.height : 1;
  return { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sy };
}

function onMouseDown(e: MouseEvent): void {
  const { x, y } = eventToImageCoords(e, overlayCanvas);

  const hit = rectAtPoint(x, y);

  if (hit) {
    // Select the hit rect; do NOT start a drag
    selectedId = hit.id;
    dragState = null;
    draw();
  } else {
    // Deselect and begin drag
    selectedId = null;
    dragState = { startX: x, startY: y, live: null };
    draw();
  }
}

function onMouseMove(e: MouseEvent): void {
  if (!dragState) return;

  const { x, y } = eventToImageCoords(e, overlayCanvas);

  const rawW = x - dragState.startX;
  const rawH = y - dragState.startY;
  const norm = normalizeRect(dragState.startX, dragState.startY, rawW, rawH);

  dragState.live = { id: "", ...norm };
  draw(dragState.live);
}

function onMouseUp(e: MouseEvent): void {
  if (!dragState) return;

  const { x, y } = eventToImageCoords(e, overlayCanvas);

  const rawW = x - dragState.startX;
  const rawH = y - dragState.startY;
  const norm = normalizeRect(dragState.startX, dragState.startY, rawW, rawH);

  if (norm.w > 4 && norm.h > 4) {
    const newRect: Rect = {
      id: crypto.randomUUID(),
      ...norm,
    };
    pushAdd(newRect);
    selectedId = newRect.id;
  }

  dragState = null;
  draw();
}

// ── Keyboard interaction ───────────────────────────────────────────────────────

function onKeyDown(e: KeyboardEvent): void {
  // Delete / Backspace: remove selected rect
  if (e.key === "Delete" || e.key === "Backspace") {
    if (selectedId) {
      const rect = rects.find((r) => r.id === selectedId);
      if (rect) {
        pushDelete(rect);
        selectedId = null;
        draw();
      }
    }
    return;
  }

  const action = resolveKeyboardShortcut(e);

  if (action === "undo") {
    e.preventDefault();
    undo();
    draw();
    return;
  }

  if (action === "redo") {
    e.preventDefault();
    redo();
    draw();
    return;
  }

  if (action === "copy") {
    e.preventDefault();
    onCopyRedacted().catch((err) => console.error("Redact-It: copy failed", err));
    return;
  }

  if (action === "download") {
    e.preventDefault();
    onDownload().catch((err) => console.error("Redact-It: download failed", err));
    return;
  }

  if (action === "close") {
    if (dragState) {
      // Cancel active drag
      dragState = null;
      draw();
    } else if (selectedId) {
      // Deselect without deleting
      selectedId = null;
      draw();
    } else {
      // Nothing selected and no drag — close the window
      chrome.windows.remove(chrome.windows.WINDOW_ID_CURRENT);
    }
  }
}

// ── Window sizing ──────────────────────────────────────────────────────────────

function resizeWindowToImage(img: HTMLImageElement): void {
  const chrome_chrome = 60; // approximate toolbar/chrome pixels
  const minW = 400;
  const minH = 300;

  const w = Math.max(
    minW,
    Math.min(Math.round(img.naturalWidth + 20), Math.round(screen.availWidth * 0.9))
  );
  const h = Math.max(
    minH,
    Math.min(Math.round(img.naturalHeight + chrome_chrome), Math.round(screen.availHeight * 0.9))
  );

  chrome.windows.update(chrome.windows.WINDOW_ID_CURRENT, { width: w, height: h });
}

// ── Image loading ──────────────────────────────────────────────────────────────

/** Draw a data URL onto a canvas element. Returns a promise that resolves with the loaded Image. */
function loadImageOntoCanvas(canvas: HTMLCanvasElement, dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Could not get 2D canvas context"));
        return;
      }
      ctx.drawImage(img, 0, 0);
      resolve(img);
    };
    img.onerror = () => reject(new Error("Failed to load data URL onto canvas"));
    img.src = dataUrl;
  });
}

// ── Toast ──────────────────────────────────────────────────────────────────────

let toastTimer: ReturnType<typeof setTimeout> | null = null;

function showToast(message: string, type: "success" | "error"): void {
  const toast = document.getElementById("toast");
  if (!toast) return;
  if (toastTimer !== null) {
    clearTimeout(toastTimer);
    toastTimer = null;
  }
  toast.textContent = message;
  toast.className = `visible ${type}`;
  toastTimer = setTimeout(() => {
    toast.className = "";
    toastTimer = null;
  }, 2000);
}

// ── Clipboard / download handlers ─────────────────────────────────────────────

async function onCopyRedacted(): Promise<void> {
  try {
    await copyRedactedToClipboard(baseCanvas, rects, strength, beautify);
    showToast("Copied to clipboard", "success");
  } catch (err) {
    console.error("Redact-It: clipboard write failed", err);
    showToast("Copy failed — use Download instead", "error");
  }
}

async function onDownload(): Promise<void> {
  try {
    await downloadRedacted(baseCanvas, rects, strength, beautify);
  } catch (err) {
    console.error("Redact-It: download failed", err);
    showToast("Download failed", "error");
  }
}

// ── Beautify controls ──────────────────────────────────────────────────────────

/** Re-render the live preview from current beautify settings. */
function applyPreviewNow(): void {
  if (!previewEls || !baseCanvas.width) return;
  applyPreview(beautify, previewEls, baseCanvas.width, baseCanvas.height);
}

/** Apply a settings patch: update state, refresh preview, debounce-save. */
function onBeautifyChange(patch: Partial<BeautifySettings>): void {
  beautify = { ...beautify, ...patch };
  applyPreviewNow();
  if (patch.background) syncSwatchSelection();
  saveBeautifyDebounced(beautify);
}

function $<T extends HTMLElement = HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

/** Mark the one button in a group whose data-attr matches `value` active. */
function setActive(container: HTMLElement | null, attr: string, value: string): void {
  if (!container) return;
  for (const btn of Array.from(container.querySelectorAll<HTMLElement>("button"))) {
    btn.classList.toggle("active", btn.dataset[attr] === value);
  }
}

/** Show only the background sub-panel matching the active type. */
function showBackgroundPanel(type: BackgroundSpec["type"]): void {
  for (const t of ["solid", "gradient", "pattern", "image"]) {
    const panel = $(`bf-panel-${t}`);
    if (panel) panel.hidden = t !== type;
  }
}

/** Build the preset swatch grids and seed all controls from current state. */
function setupBeautifyControls(): void {
  // ── Frame sliders ──
  bindRange("bf-margin", "bf-margin-val", (v) => onBeautifyChange({ margin: v }), (v) => String(v));
  bindRange("bf-scale", "bf-scale-val", (v) => onBeautifyChange({ scale: v / 100 }), (v) => `${v}%`);
  bindRange("bf-radius", "bf-radius-val", (v) => onBeautifyChange({ radius: v }), (v) => String(v));
  bindRange(
    "bf-shadow-blur",
    "bf-shadow-blur-val",
    (v) => onBeautifyChange({ shadow: { ...beautify.shadow, blur: v } }),
    (v) => String(v),
  );
  bindRange(
    "bf-shadow-opacity",
    "bf-shadow-opacity-val",
    (v) => onBeautifyChange({ shadow: { ...beautify.shadow, opacity: v / 100 } }),
    (v) => `${v}%`,
  );

  const shadowToggle = $<HTMLInputElement>("bf-shadow-enabled");
  shadowToggle?.addEventListener("change", () => {
    onBeautifyChange({ shadow: { ...beautify.shadow, enabled: !!shadowToggle.checked } });
  });

  // ── Background type segmented control ──
  const bgTypeEl = $("bf-bg-type");
  bgTypeEl?.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>("button[data-bgtype]");
    if (!btn) return;
    const type = btn.dataset.bgtype as BackgroundSpec["type"];
    selectBackgroundType(type);
  });

  // ── Solid ──
  const solid = $<HTMLInputElement>("bf-bg-solid");
  solid?.addEventListener("input", () => onBeautifyChange({ background: { type: "solid", color: solid.value } }));

  // ── Gradient presets ──
  const gradGrid = $("bf-gradient-grid");
  if (gradGrid) {
    for (const p of GRADIENT_PRESETS) {
      const btn = document.createElement("button");
      btn.className = "swatch";
      btn.dataset.preset = p.id;
      btn.title = p.name;
      btn.style.backgroundImage = resolveBackgroundCss({ type: "gradient", presetId: p.id }).backgroundImage;
      btn.addEventListener("click", () => onBeautifyChange({ background: { type: "gradient", presetId: p.id } }));
      gradGrid.appendChild(btn);
    }
  }

  // Custom gradient
  $("bf-gradient-custom-toggle")?.addEventListener("click", () => {
    const panel = $("bf-gradient-custom");
    if (panel) panel.hidden = !panel.hidden;
  });
  const gFrom = $<HTMLInputElement>("bf-grad-from");
  const gTo = $<HTMLInputElement>("bf-grad-to");
  const applyCustomGradient = (): void => {
    const angle = Number($<HTMLInputElement>("bf-grad-angle")?.value ?? 135);
    onBeautifyChange({
      background: {
        type: "gradient",
        custom: {
          angle,
          stops: [
            { offset: 0, color: gFrom?.value ?? "#6a11cb" },
            { offset: 1, color: gTo?.value ?? "#2575fc" },
          ],
        },
      },
    });
  };
  bindRange("bf-grad-angle", "bf-grad-angle-val", () => applyCustomGradient(), (v) => `${v}°`);
  gFrom?.addEventListener("input", applyCustomGradient);
  gTo?.addEventListener("input", applyCustomGradient);

  // ── Pattern presets ──
  const patGrid = $("bf-pattern-grid");
  const patColor = $<HTMLInputElement>("bf-pattern-color");
  if (patGrid) {
    for (const p of PATTERN_PRESETS) {
      const btn = document.createElement("button");
      btn.className = "swatch";
      btn.dataset.preset = p.id;
      btn.title = p.name;
      const css = resolveBackgroundCss({ type: "pattern", presetId: p.id, baseColor: p.defaultBaseColor });
      btn.style.backgroundColor = css.backgroundColor;
      btn.style.backgroundImage = css.backgroundImage;
      btn.style.backgroundRepeat = "repeat";
      btn.addEventListener("click", () => {
        const baseColor = patColor?.value ?? p.defaultBaseColor;
        onBeautifyChange({ background: { type: "pattern", presetId: p.id, baseColor } });
      });
      patGrid.appendChild(btn);
    }
  }
  patColor?.addEventListener("input", () => {
    if (beautify.background.type === "pattern") {
      onBeautifyChange({ background: { ...beautify.background, baseColor: patColor.value } });
    }
  });

  // ── Image presets ──
  const imgGrid = $("bf-image-grid");
  const imgEmpty = $("bf-image-empty");
  if (imgGrid) {
    for (const p of IMAGE_PRESETS) {
      const btn = document.createElement("button");
      btn.className = "swatch";
      btn.dataset.preset = p.id;
      btn.title = p.name;
      btn.style.backgroundImage = resolveBackgroundCss({ type: "image", presetId: p.id }).backgroundImage;
      btn.addEventListener("click", () => onBeautifyChange({ background: { type: "image", presetId: p.id } }));
      imgGrid.appendChild(btn);
    }
    if (imgEmpty) imgEmpty.hidden = IMAGE_PRESETS.length > 0;
  }

  // ── Aspect segmented control ──
  const aspectEl = $("bf-aspect");
  aspectEl?.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>("button[data-aspect]");
    if (!btn) return;
    const aspect = btn.dataset.aspect as BeautifySettings["aspect"];
    onBeautifyChange({ aspect });
    setActive(aspectEl, "aspect", aspect);
  });

  syncControlsFromState();
}

/** Switch background type, defaulting sub-settings the first time. */
function selectBackgroundType(type: BackgroundSpec["type"]): void {
  let background: BackgroundSpec;
  switch (type) {
    case "solid":
      background = { type: "solid", color: $<HTMLInputElement>("bf-bg-solid")?.value ?? "#1e293b" };
      break;
    case "gradient":
      background = { type: "gradient", presetId: GRADIENT_PRESETS[0]?.id ?? "sunset" };
      break;
    case "pattern": {
      const first = PATTERN_PRESETS[0];
      background = { type: "pattern", presetId: first?.id ?? "dots", baseColor: first?.defaultBaseColor ?? "#1e293b" };
      break;
    }
    case "image":
      background = IMAGE_PRESETS[0]
        ? { type: "image", presetId: IMAGE_PRESETS[0].id }
        : beautify.background; // no wallpapers: keep current, just show the panel
      break;
  }
  onBeautifyChange({ background });
  setActive($("bf-bg-type"), "bgtype", type);
  showBackgroundPanel(type);
  syncSwatchSelection();
}

/** Reflect the current beautify state onto every control widget. */
function syncControlsFromState(): void {
  setRange("bf-margin", "bf-margin-val", beautify.margin, String(beautify.margin));
  setRange("bf-scale", "bf-scale-val", Math.round(beautify.scale * 100), `${Math.round(beautify.scale * 100)}%`);
  setRange("bf-radius", "bf-radius-val", beautify.radius, String(beautify.radius));
  setRange("bf-shadow-blur", "bf-shadow-blur-val", beautify.shadow.blur, String(beautify.shadow.blur));
  setRange(
    "bf-shadow-opacity",
    "bf-shadow-opacity-val",
    Math.round(beautify.shadow.opacity * 100),
    `${Math.round(beautify.shadow.opacity * 100)}%`,
  );
  const toggle = $<HTMLInputElement>("bf-shadow-enabled");
  if (toggle) toggle.checked = beautify.shadow.enabled;

  setActive($("bf-bg-type"), "bgtype", beautify.background.type);
  showBackgroundPanel(beautify.background.type);
  setActive($("bf-aspect"), "aspect", beautify.aspect);

  if (beautify.background.type === "solid") {
    const solid = $<HTMLInputElement>("bf-bg-solid");
    if (solid) solid.value = beautify.background.color;
  }
  if (beautify.background.type === "pattern") {
    const patColor = $<HTMLInputElement>("bf-pattern-color");
    if (patColor) patColor.value = beautify.background.baseColor;
  }
  syncSwatchSelection();
}

/** Highlight the active preset swatch within the current background panel. */
function syncSwatchSelection(): void {
  const bg = beautify.background;
  const activeId = bg.type === "gradient" && "presetId" in bg ? bg.presetId
    : bg.type === "pattern" ? bg.presetId
    : bg.type === "image" ? bg.presetId
    : null;
  for (const gridId of ["bf-gradient-grid", "bf-pattern-grid", "bf-image-grid"]) {
    const grid = $(gridId);
    if (!grid) continue;
    for (const btn of Array.from(grid.querySelectorAll<HTMLElement>("button.swatch"))) {
      btn.classList.toggle("active", !!activeId && btn.dataset.preset === activeId);
    }
  }
}

// ── Small control-binding helpers ──

function bindRange(
  inputId: string,
  valueId: string,
  onChange: (value: number) => void,
  format: (value: number) => string,
): void {
  const input = $<HTMLInputElement>(inputId);
  const label = $(valueId);
  input?.addEventListener("input", () => {
    const v = Number(input.value);
    if (label) label.textContent = format(v);
    onChange(v);
  });
}

function setRange(inputId: string, valueId: string, value: number, formatted: string): void {
  const input = $<HTMLInputElement>(inputId);
  const label = $(valueId);
  if (input) input.value = String(value);
  if (label) label.textContent = formatted;
}

// ── Init ───────────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", async () => {
  baseCanvas = document.getElementById("base") as HTMLCanvasElement;
  overlayCanvas = document.getElementById("overlay") as HTMLCanvasElement;

  if (!baseCanvas || !overlayCanvas) {
    console.error("Redact-It: canvas elements not found.");
    return;
  }

  const ctx = overlayCanvas.getContext("2d");
  if (!ctx) {
    console.error("Redact-It: could not get overlay canvas context.");
    return;
  }
  overlayCtx = ctx;

  // ── Resolve preview-frame elements ──────────────────────────────────────────

  const stage = document.getElementById("canvas-stage");
  const outputFrame = document.getElementById("output-frame");
  const wrapper = document.getElementById("frame-wrapper");
  if (stage && outputFrame && wrapper) {
    previewEls = { stage, outputFrame, wrapper };
  }

  // ── Load persisted settings before rendering ────────────────────────────────

  strength = await loadStrength();
  beautify = await loadBeautify();
  setupBeautifyControls();
  const slider = document.getElementById("strength-slider") as HTMLInputElement | null;
  const strengthValue = document.getElementById("strength-value");
  if (slider) {
    slider.value = String(strength);
    if (strengthValue) strengthValue.textContent = String(strength);
    slider.addEventListener("input", () => {
      strength = Number(slider.value);
      if (strengthValue) strengthValue.textContent = String(strength);
      saveStrength(strength).catch((err) => console.error("Redact-It: failed to save strength", err));
    });
  }

  // ── Load image from session storage ────────────────────────────────────────

  const params = new URLSearchParams(window.location.search);
  const key = params.get("key");

  if (key) {
    try {
      const result = await chrome.storage.session.get(key);
      const dataUrl: string | undefined = result[key];

      if (!dataUrl) {
        console.error("Redact-It: no image data found for key", key);
      } else {
        const img = await loadImageOntoCanvas(baseCanvas, dataUrl);

        // Match overlay canvas dimensions to base
        overlayCanvas.width = baseCanvas.width;
        overlayCanvas.height = baseCanvas.height;

        // Resize editor window to fit the image
        resizeWindowToImage(img);

        // Render the beautify preview now that the image is loaded
        applyPreviewNow();

        // Clean up session storage after successful load
        await chrome.storage.session.remove(key);
        console.log("Redact-It: session key removed after load.");
      }
    } catch (err) {
      console.error("Redact-It: failed to load image from session storage", err);
    }
  } else {
    console.warn("Redact-It: no ?key= param found in editor URL.");
  }

  // ── Wire up mouse events ────────────────────────────────────────────────────

  overlayCanvas.addEventListener("mousedown", onMouseDown);
  overlayCanvas.addEventListener("mousemove", onMouseMove);
  overlayCanvas.addEventListener("mouseup", onMouseUp);

  // ── Wire up keyboard events ─────────────────────────────────────────────────

  document.addEventListener("keydown", onKeyDown);

  // Re-fit the preview when the window/pane size changes
  window.addEventListener("resize", applyPreviewNow);

  // ── Wire up toolbar buttons ─────────────────────────────────────────────────

  document.getElementById("btn-copy")?.addEventListener("click", () => {
    onCopyRedacted().catch((err) => console.error("Redact-It: copy failed", err));
  });
  document.getElementById("btn-download")?.addEventListener("click", () => {
    onDownload().catch((err) => console.error("Redact-It: download failed", err));
  });

  // Initial draw (empty state)
  draw();

  console.log("Redact-It editor ready.", { baseCanvas, overlayCanvas });
});
