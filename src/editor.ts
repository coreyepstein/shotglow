import type { Rect } from "./types.js";
import { copyRedactedToClipboard, downloadRedacted } from "./clipboard.js";

console.log("Redact-It editor loaded.");

// ── State ──────────────────────────────────────────────────────────────────────

let rects: Rect[] = [];
let selectedId: string | null = null;
let dragState: { startX: number; startY: number; live: Rect | null } | null = null;

// Canvas references (populated after DOMContentLoaded)
let baseCanvas: HTMLCanvasElement;
let overlayCanvas: HTMLCanvasElement;
let overlayCtx: CanvasRenderingContext2D;

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

// ── Mouse interaction ──────────────────────────────────────────────────────────

function onMouseDown(e: MouseEvent): void {
  const x = e.offsetX;
  const y = e.offsetY;

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

  const x = e.offsetX;
  const y = e.offsetY;

  const rawW = x - dragState.startX;
  const rawH = y - dragState.startY;
  const norm = normalizeRect(dragState.startX, dragState.startY, rawW, rawH);

  dragState.live = { id: "", ...norm };
  draw(dragState.live);
}

function onMouseUp(e: MouseEvent): void {
  if (!dragState) return;

  const x = e.offsetX;
  const y = e.offsetY;

  const rawW = x - dragState.startX;
  const rawH = y - dragState.startY;
  const norm = normalizeRect(dragState.startX, dragState.startY, rawW, rawH);

  if (norm.w > 4 && norm.h > 4) {
    const newRect: Rect = {
      id: crypto.randomUUID(),
      ...norm,
    };
    rects.push(newRect);
    selectedId = newRect.id;
  }

  dragState = null;
  draw();
}

// ── Keyboard interaction ───────────────────────────────────────────────────────

function onKeyDown(e: KeyboardEvent): void {
  if (e.key === "Delete" || e.key === "Backspace") {
    if (selectedId) {
      rects = rects.filter((r) => r.id !== selectedId);
      selectedId = null;
      draw();
    }
    return;
  }

  if (e.key === "Escape") {
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

// ── Toolbar button handlers ────────────────────────────────────────────────────

function onUndo(): void {
  if (rects.length === 0) return;
  const removed = rects.pop()!;
  if (selectedId === removed.id) {
    selectedId = null;
  }
  draw();
}

function onClearAll(): void {
  rects = [];
  selectedId = null;
  draw();
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
    await copyRedactedToClipboard(baseCanvas, rects, 3);
    showToast("Copied to clipboard", "success");
  } catch (err) {
    console.error("Redact-It: clipboard write failed", err);
    showToast("Copy failed — use Download instead", "error");
  }
}

async function onDownload(): Promise<void> {
  try {
    await downloadRedacted(baseCanvas, rects, 3);
  } catch (err) {
    console.error("Redact-It: download failed", err);
    showToast("Download failed", "error");
  }
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

  // ── Wire up toolbar buttons ─────────────────────────────────────────────────

  document.getElementById("btn-undo")?.addEventListener("click", onUndo);
  document.getElementById("btn-clear")?.addEventListener("click", onClearAll);
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
