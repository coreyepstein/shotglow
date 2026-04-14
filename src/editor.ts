console.log("Redact-It editor loaded.");

document.addEventListener("DOMContentLoaded", async () => {
  const baseCanvas = document.getElementById("base") as HTMLCanvasElement;
  const overlayCanvas = document.getElementById("overlay") as HTMLCanvasElement;

  if (!baseCanvas || !overlayCanvas) {
    console.error("Redact-It: canvas elements not found.");
    return;
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
        await loadImageOntoCanvas(baseCanvas, dataUrl);

        // Match overlay canvas dimensions to base
        overlayCanvas.width = baseCanvas.width;
        overlayCanvas.height = baseCanvas.height;

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

  // TODO: wire up redaction drawing on overlayCanvas
  // TODO: implement undo stack
  // TODO: implement copy-to-clipboard of composited image

  console.log("Redact-It editor ready.", { baseCanvas, overlayCanvas });
});

/** Draw a data URL onto a canvas element. Returns a promise that resolves when drawn. */
function loadImageOntoCanvas(canvas: HTMLCanvasElement, dataUrl: string): Promise<void> {
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
      resolve();
    };
    img.onerror = () => reject(new Error("Failed to load data URL onto canvas"));
    img.src = dataUrl;
  });
}
