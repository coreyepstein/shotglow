console.log("Redact-It editor loaded.");

document.addEventListener("DOMContentLoaded", () => {
  const baseCanvas = document.getElementById("base") as HTMLCanvasElement;
  const overlayCanvas = document.getElementById("overlay") as HTMLCanvasElement;

  if (!baseCanvas || !overlayCanvas) {
    console.error("Redact-It: canvas elements not found.");
    return;
  }

  // TODO: load image from session storage / blob URL passed via message
  // TODO: wire up redaction drawing on overlayCanvas
  // TODO: implement undo stack
  // TODO: implement copy-to-clipboard of composited image

  console.log("Redact-It editor ready.", { baseCanvas, overlayCanvas });
});
