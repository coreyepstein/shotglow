import { describe, it, expect } from "bun:test";

// Utility extracted from background.ts for unit testing
function arrayBufferToDataUrl(buffer: ArrayBuffer, mimeType: string): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}

describe("arrayBufferToDataUrl", () => {
  it("produces a valid data URL with the given MIME type", () => {
    const buf = new TextEncoder().encode("hello").buffer;
    const result = arrayBufferToDataUrl(buf as ArrayBuffer, "image/png");
    expect(result.startsWith("data:image/png;base64,")).toBe(true);
  });

  it("round-trips bytes correctly via base64", () => {
    const input = new Uint8Array([0, 1, 2, 255]);
    const dataUrl = arrayBufferToDataUrl(input.buffer as ArrayBuffer, "application/octet-stream");
    const b64 = dataUrl.split(",")[1];
    const decoded = atob(b64);
    expect(decoded.charCodeAt(0)).toBe(0);
    expect(decoded.charCodeAt(1)).toBe(1);
    expect(decoded.charCodeAt(2)).toBe(2);
    expect(decoded.charCodeAt(3)).toBe(255);
  });
});
