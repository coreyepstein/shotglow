// Session-storage handoff between the service worker (capture) and the editor
// window (load). Exactly one capture is ever in flight: the worker writes a
// `shotglow:<timestamp>` key, the editor reads it then deletes it
// (see editor.ts). Anything left behind is a leak — an editor window that never
// opened or failed before its cleanup ran. Those orphaned blobs accumulate and
// eventually exceed chrome.storage.session's quota, which surfaces as the
// "Session storage quota bytes exceeded. Values were not stored." capture
// failure. `storeCapture` evicts prior captures before each write so session
// storage stays bounded to a single image.

import type { SessionImageKey } from "./types.js";

/** chrome.storage.session's default quota (10 MB). Used for the size guard. */
export const SESSION_QUOTA_BYTES = 10 * 1024 * 1024;

/** Prefix every capture key shares; used to find evictable leftovers. */
export const SESSION_KEY_PREFIX = "shotglow:";

/** Minimal surface of chrome.storage.session that storeCapture depends on. */
export interface SessionStorageLike {
  /** Return all stored items (chrome.storage.session.get() with no args). */
  get(): Promise<Record<string, unknown>>;
  set(items: Record<string, string>): Promise<void>;
  remove(keys: string[]): Promise<void>;
}

/** Byte length of a string as it will be measured against the quota. */
function byteLength(value: string): number {
  return new Blob([value]).size;
}

/**
 * Store a freshly captured image, evicting any earlier captures first so that
 * leftover handoff blobs can never accumulate past the session-storage quota.
 *
 * @param quotaBytes overridable for testing; defaults to {@link SESSION_QUOTA_BYTES}.
 * @throws if the single image is itself larger than the quota — surfaced with a
 *         clear message instead of Chrome's opaque quota error.
 */
export async function storeCapture(
  storage: SessionStorageLike,
  key: SessionImageKey,
  dataUrl: string,
  quotaBytes: number = SESSION_QUOTA_BYTES,
): Promise<void> {
  // Evict prior captures before writing the new one. Skip `key` itself in case
  // the (timestamp) key were ever to collide with an existing entry.
  const existing = await storage.get();
  const stale = Object.keys(existing).filter(
    (k) => k.startsWith(SESSION_KEY_PREFIX) && k !== key,
  );
  if (stale.length > 0) {
    await storage.remove(stale);
  }

  // A single image larger than the quota can never be stored — fail loudly with
  // a human-readable message rather than letting Chrome throw its cryptic one.
  const size = byteLength(dataUrl);
  if (size > quotaBytes) {
    const mb = (size / (1024 * 1024)).toFixed(1);
    const limit = Math.round(quotaBytes / (1024 * 1024));
    throw new Error(`Image too large to capture (${mb} MB exceeds the ${limit} MB limit).`);
  }

  await storage.set({ [key]: dataUrl });
}
