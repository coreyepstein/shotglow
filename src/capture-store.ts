// Capture handoff between the service worker (capture) and the editor window
// (load), backed by IndexedDB.
//
// Why IndexedDB and not chrome.storage.session: session storage is capped at
// 10 MB per extension, and a single Retina screenshot encoded as a base64 data
// URL routinely exceeds that on its own ("Image too large to capture"). The
// IndexedDB quota is a share of free disk space, and it stores the raw image
// bytes instead of a base64 string, so captures of any realistic size fit.
//
// Lifecycle: the worker writes one record per capture under a
// `shotglow:<timestamp>` key and opens the editor with that key. The editor
// takes the record (read + delete in one transaction). Records that were never
// taken — an editor window that failed to open — are evicted on the next write
// once they are older than CAPTURE_TTL_MS, so leftovers can never pile up.

import type { SessionImageKey } from "./types.js";

/** Prefix every capture key shares. */
export const CAPTURE_KEY_PREFIX = "shotglow:";

/** Leftover captures older than this are evicted on the next write. */
export const CAPTURE_TTL_MS = 10 * 60 * 1000;

export const CAPTURE_DB_NAME = "shotglow";
export const CAPTURE_STORE_NAME = "captures";
const CAPTURE_DB_VERSION = 1;
const CREATED_AT_INDEX = "createdAt";

/** One stored capture. Bytes are kept raw so no base64 inflation applies. */
export interface CaptureRecord {
  key: SessionImageKey;
  bytes: ArrayBuffer;
  type: string;
  createdAt: number;
}

/** Minimal persistence surface storeCapture/takeCapture depend on. */
export interface CaptureBackend {
  put(record: CaptureRecord): Promise<void>;
  /** Read and delete the record in one step; undefined when absent. */
  take(key: SessionImageKey): Promise<CaptureRecord | undefined>;
  /** Delete every record created before `before` (ms epoch); returns the count. */
  evictOlderThan(before: number): Promise<number>;
}

/**
 * Store a freshly captured image for the editor to pick up. Stale leftovers
 * from earlier captures are evicted first so the store stays bounded.
 */
export async function storeCapture(
  backend: CaptureBackend,
  key: SessionImageKey,
  blob: Blob,
  now: number = Date.now(),
): Promise<void> {
  await backend.evictOlderThan(now - CAPTURE_TTL_MS);
  const bytes = await blob.arrayBuffer();
  await backend.put({ key, bytes, type: blob.type || "image/png", createdAt: now });
}

/** Retrieve a capture as a Blob and remove it from the store. */
export async function takeCapture(
  backend: CaptureBackend,
  key: SessionImageKey,
): Promise<Blob | undefined> {
  const record = await backend.take(key);
  if (!record) return undefined;
  return new Blob([record.bytes], { type: record.type });
}

// ─── IndexedDB backend ───────────────────────────────────────────────────────

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

function openCaptureDb(factory: IDBFactory): Promise<IDBDatabase> {
  const request = factory.open(CAPTURE_DB_NAME, CAPTURE_DB_VERSION);
  request.onupgradeneeded = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains(CAPTURE_STORE_NAME)) {
      const store = db.createObjectStore(CAPTURE_STORE_NAME, { keyPath: "key" });
      store.createIndex(CREATED_AT_INDEX, "createdAt", { unique: false });
    }
  };
  return requestToPromise(request);
}

/**
 * CaptureBackend over IndexedDB. Both the service worker and the editor page
 * share the extension origin, so they see the same database.
 */
export function indexedDbCaptureBackend(factory: IDBFactory = indexedDB): CaptureBackend {
  const withStore = async <T>(
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore) => Promise<T>,
  ): Promise<T> => {
    const db = await openCaptureDb(factory);
    try {
      const tx = db.transaction(CAPTURE_STORE_NAME, mode);
      const result = await run(tx.objectStore(CAPTURE_STORE_NAME));
      await transactionDone(tx);
      return result;
    } finally {
      db.close();
    }
  };

  return {
    async put(record) {
      await withStore("readwrite", async (store) => {
        await requestToPromise(store.put(record));
      });
    },

    async take(key) {
      return withStore("readwrite", async (store) => {
        const record = (await requestToPromise(store.get(key))) as CaptureRecord | undefined;
        if (record) await requestToPromise(store.delete(key));
        return record;
      });
    },

    async evictOlderThan(before) {
      return withStore("readwrite", async (store) => {
        const range = IDBKeyRange.upperBound(before, /* open */ true);
        const staleKeys = await requestToPromise(store.index(CREATED_AT_INDEX).getAllKeys(range));
        for (const staleKey of staleKeys) {
          await requestToPromise(store.delete(staleKey));
        }
        return staleKeys.length;
      });
    },
  };
}
