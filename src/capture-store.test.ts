import { describe, it, expect } from "bun:test";
import {
  storeCapture,
  takeCapture,
  CAPTURE_KEY_PREFIX,
  CAPTURE_TTL_MS,
  type CaptureBackend,
  type CaptureRecord,
} from "./capture-store.js";

/** In-memory CaptureBackend with the same contract as the IndexedDB one. */
function fakeBackend(initial: CaptureRecord[] = []) {
  const records = new Map(initial.map((r) => [r.key, r]));
  const backend: CaptureBackend = {
    async put(record) {
      records.set(record.key, record);
    },
    async take(key) {
      const record = records.get(key);
      records.delete(key);
      return record;
    },
    async evictOlderThan(before) {
      let n = 0;
      for (const [key, record] of records) {
        if (record.createdAt < before) {
          records.delete(key);
          n++;
        }
      }
      return n;
    },
  };
  return { backend, records };
}

const png = (bytes: number[]) => new Blob([new Uint8Array(bytes)], { type: "image/png" });

describe("storeCapture / takeCapture", () => {
  it("round-trips the image bytes and MIME type", async () => {
    const { backend } = fakeBackend();
    const key = `${CAPTURE_KEY_PREFIX}1`;
    await storeCapture(backend, key, png([137, 80, 78, 71]));

    const blob = await takeCapture(backend, key);
    expect(blob).toBeDefined();
    expect(blob!.type).toBe("image/png");
    expect(Array.from(new Uint8Array(await blob!.arrayBuffer()))).toEqual([137, 80, 78, 71]);
  });

  it("stores raw bytes, not a base64 string (no 33% inflation)", async () => {
    const { backend, records } = fakeBackend();
    const key = `${CAPTURE_KEY_PREFIX}1`;
    await storeCapture(backend, key, png(new Array(3000).fill(7)));
    expect(records.get(key)!.bytes.byteLength).toBe(3000);
  });

  it("has no fixed size ceiling: a capture well over 10 MB is stored", async () => {
    const { backend, records } = fakeBackend();
    const key = `${CAPTURE_KEY_PREFIX}1`;
    const seventeenMb = new Blob([new Uint8Array(17 * 1024 * 1024)], { type: "image/png" });
    await storeCapture(backend, key, seventeenMb);
    expect(records.get(key)!.bytes.byteLength).toBe(17 * 1024 * 1024);
  });

  it("take removes the record so it is read exactly once", async () => {
    const { backend, records } = fakeBackend();
    const key = `${CAPTURE_KEY_PREFIX}1`;
    await storeCapture(backend, key, png([1]));
    await takeCapture(backend, key);
    expect(records.has(key)).toBe(false);
    expect(await takeCapture(backend, key)).toBeUndefined();
  });

  it("evicts leftovers older than the TTL on the next write", async () => {
    const now = 1_000_000_000;
    const { backend, records } = fakeBackend([
      { key: `${CAPTURE_KEY_PREFIX}old`, bytes: new ArrayBuffer(1), type: "image/png", createdAt: now - CAPTURE_TTL_MS - 1 },
    ]);
    await storeCapture(backend, `${CAPTURE_KEY_PREFIX}new`, png([1]), now);
    expect([...records.keys()]).toEqual([`${CAPTURE_KEY_PREFIX}new`]);
  });

  it("keeps a recent in-flight capture when another one is stored", async () => {
    // Two quick captures: the first editor window may not have loaded yet, so
    // its record must survive the second write.
    const now = 1_000_000_000;
    const { backend, records } = fakeBackend([
      { key: `${CAPTURE_KEY_PREFIX}a`, bytes: new ArrayBuffer(1), type: "image/png", createdAt: now - 500 },
    ]);
    await storeCapture(backend, `${CAPTURE_KEY_PREFIX}b`, png([1]), now);
    expect([...records.keys()].sort()).toEqual([`${CAPTURE_KEY_PREFIX}a`, `${CAPTURE_KEY_PREFIX}b`]);
  });

  it("defaults an untyped blob to image/png", async () => {
    const { backend } = fakeBackend();
    const key = `${CAPTURE_KEY_PREFIX}1`;
    await storeCapture(backend, key, new Blob([new Uint8Array([1])]));
    expect((await takeCapture(backend, key))!.type).toBe("image/png");
  });
});
