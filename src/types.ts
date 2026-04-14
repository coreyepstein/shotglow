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

/** Message sent from background to content script requesting a blob/data URL be bridged */
export type BlobBridgeMessage = {
  type: "REDACT_FETCH_BLOB";
  srcUrl: string;
};

/** Response from content script with the base64 data URL */
export type BlobBridgeResponse =
  | { success: true; dataUrl: string }
  | { success: false; error: string };
