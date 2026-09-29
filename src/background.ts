import type { BlobBridgeResponse, SessionImageKey } from "./types.js";
import { storeCapture, indexedDbCaptureBackend } from "./capture-store.js";

console.log("Shotglow service worker started.");

// ─── Context menu registration ────────────────────────────────────────────────

function registerContextMenu(): void {
  // Remove first to avoid "already exists" error on re-registration
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "shotglow-open",
      title: "Edit in Shotglow",
      contexts: ["image"],
    });
  });
}

chrome.runtime.onInstalled.addListener(() => {
  registerContextMenu();
});

chrome.runtime.onStartup.addListener(() => {
  registerContextMenu();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Open the editor popup with a reference to a stored capture key */
function openEditor(key: SessionImageKey): void {
  const url = `${chrome.runtime.getURL("editor.html")}?key=${encodeURIComponent(key)}`;
  chrome.windows.create({ url, type: "popup", width: 800, height: 600 });
}

/** Show an error notification */
function showError(message: string): void {
  chrome.notifications.create({
    type: "basic",
    iconUrl: chrome.runtime.getURL("icons/48.png"),
    title: "Shotglow",
    message,
  });
}

// ─── HTTP(S) fetch path ───────────────────────────────────────────────────────

async function captureHttpImage(srcUrl: string): Promise<Blob> {
  const response = await fetch(srcUrl);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} fetching image`);
  }
  const mimeType = (response.headers.get("content-type") ?? "image/png").split(";")[0].trim();
  const buffer = await response.arrayBuffer();
  return new Blob([buffer], { type: mimeType });
}

// ─── Blob / data URL bridge path (via content script) ────────────────────────

async function captureBlobImage(srcUrl: string, tabId: number): Promise<Blob> {
  // bridgeBlob returns a Promise in the injected context; the resolved value is
  // BlobBridgeResponse. The executeScript generic tracks the raw return type of
  // func, which is Promise<BlobBridgeResponse>.
  const results = await chrome.scripting.executeScript<[string], Promise<BlobBridgeResponse>>({
    target: { tabId },
    func: bridgeBlob,
    args: [srcUrl],
  });

  const result = results[0]?.result;
  if (!result) {
    throw new Error("No response from blob bridge script");
  }
  if (!result.success) {
    throw new Error(result.error);
  }
  // The bridge hands back a PNG data URL; decode it to raw bytes for storage.
  return (await fetch(result.dataUrl)).blob();
}

/**
 * Injected into page context by chrome.scripting.executeScript.
 * Reads a blob: or data: URL (which the page has access to) and returns
 * a data URL via canvas toDataURL.
 *
 * This function runs in the page's context, NOT the service worker, so it
 * can resolve origin-locked blob: URLs.
 */
function bridgeBlob(srcUrl: string): Promise<BlobBridgeResponse> {
  return new Promise((resolve) => {
    try {
      const img = new Image();
      img.crossOrigin = "anonymous";

      const finish = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = img.naturalWidth || img.width;
          canvas.height = img.naturalHeight || img.height;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            resolve({ success: false, error: "Could not get 2D canvas context" });
            return;
          }
          ctx.drawImage(img, 0, 0);
          const dataUrl = canvas.toDataURL("image/png");
          resolve({ success: true, dataUrl });
        } catch (err) {
          resolve({ success: false, error: String(err) });
        }
      };

      img.onload = finish;
      img.onerror = () => resolve({ success: false, error: "Image failed to load" });

      img.src = srcUrl;

      // If image is already loaded (e.g. from cache), onload won't fire
      if (img.complete && img.naturalWidth > 0) {
        finish();
      }
    } catch (err) {
      resolve({ success: false, error: String(err) });
    }
  });
}

// ─── Context menu click handler ───────────────────────────────────────────────

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== "shotglow-open") return;

  const srcUrl = info.srcUrl;
  if (!srcUrl) {
    showError("Could not determine image URL.");
    return;
  }

  const tabId = tab?.id;

  const key: SessionImageKey = `shotglow:${Date.now()}`;

  const run = async () => {
    let image: Blob;

    if (srcUrl.startsWith("http://") || srcUrl.startsWith("https://")) {
      image = await captureHttpImage(srcUrl);
    } else if (srcUrl.startsWith("blob:") || srcUrl.startsWith("data:")) {
      if (tabId == null) {
        showError("Cannot bridge blob URL: no active tab.");
        return;
      }
      image = await captureBlobImage(srcUrl, tabId);
    } else {
      showError(`Unsupported image URL scheme: ${srcUrl.slice(0, 30)}`);
      return;
    }

    // Hand the image to the editor through IndexedDB (no 10 MB session-storage
    // cap; stale leftovers are evicted by storeCapture).
    await storeCapture(indexedDbCaptureBackend(), key, image);

    openEditor(key);
  };

  run().catch((err) => {
    console.error("Shotglow: capture failed", err);
    showError(`Failed to capture image: ${err instanceof Error ? err.message : String(err)}`);
  });
});
