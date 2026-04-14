import type { BlobBridgeMessage, BlobBridgeResponse } from "./types.js";

console.log("Redact-It content script loaded.");

/**
 * Blob URL bridge: called by background service worker via chrome.scripting.executeScript.
 *
 * Listens for REDACT_FETCH_BLOB messages, renders the blob/data URL onto an
 * offscreen canvas (which has page-context access to origin-locked blob: URLs),
 * and returns the result as a PNG data URL.
 *
 * Note: chrome.scripting.executeScript injects bridgeBlob directly, so this
 * message listener is a fallback for content-script-based messaging.
 */
chrome.runtime.onMessage.addListener(
  (message: BlobBridgeMessage, _sender, sendResponse: (r: BlobBridgeResponse) => void) => {
    if (message.type !== "REDACT_FETCH_BLOB") return false;

    const { srcUrl } = message;

    const img = new Image();
    img.crossOrigin = "anonymous";

    const finish = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          sendResponse({ success: false, error: "Could not get 2D canvas context" });
          return;
        }
        ctx.drawImage(img, 0, 0);
        const dataUrl = canvas.toDataURL("image/png");
        sendResponse({ success: true, dataUrl });
      } catch (err) {
        sendResponse({ success: false, error: String(err) });
      }
    };

    img.onload = finish;
    img.onerror = () => sendResponse({ success: false, error: "Image failed to load" });

    img.src = srcUrl;

    // If image is already complete (e.g. from browser cache), onload may not fire
    if (img.complete && img.naturalWidth > 0) {
      finish();
    }

    // Return true to keep the message channel open for the async response
    return true;
  }
);
