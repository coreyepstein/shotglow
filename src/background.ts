import type { BlobBridgeMessage, BlobBridgeResponse, SessionImageKey } from "./types.js";

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

/** Open the editor popup with a reference to a session storage key */
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

/** Convert an ArrayBuffer to a base64 data URL */
function arrayBufferToDataUrl(buffer: ArrayBuffer, mimeType: string): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}

// ─── HTTP(S) fetch path ───────────────────────────────────────────────────────

async function captureHttpImage(srcUrl: string): Promise<string> {
  const response = await fetch(srcUrl);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} fetching image`);
  }
  const mimeType = response.headers.get("content-type") ?? "image/png";
  const buffer = await response.arrayBuffer();
  return arrayBufferToDataUrl(buffer, mimeType.split(";")[0].trim());
}

// ─── Blob / data URL bridge path (via content script) ────────────────────────

async function captureBlobImage(srcUrl: string, tabId: number): Promise<string> {
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
  return result.dataUrl;
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
    let dataUrl: string;

    if (srcUrl.startsWith("http://") || srcUrl.startsWith("https://")) {
      dataUrl = await captureHttpImage(srcUrl);
    } else if (srcUrl.startsWith("blob:") || srcUrl.startsWith("data:")) {
      if (tabId == null) {
        showError("Cannot bridge blob URL: no active tab.");
        return;
      }
      dataUrl = await captureBlobImage(srcUrl, tabId);
    } else {
      showError(`Unsupported image URL scheme: ${srcUrl.slice(0, 30)}`);
      return;
    }

    // Store in session storage (short-lived, tab-session scoped)
    await chrome.storage.session.set({ [key]: dataUrl });

    openEditor(key);
  };

  run().catch((err) => {
    console.error("Shotglow: capture failed", err);
    showError(`Failed to capture image: ${err instanceof Error ? err.message : String(err)}`);
  });
});
