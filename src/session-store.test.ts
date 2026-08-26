import { describe, it, expect } from "bun:test";
import { storeCapture, SESSION_KEY_PREFIX } from "./session-store.js";

/** In-memory stand-in for chrome.storage.session. */
function fakeStorage(initial: Record<string, string> = {}) {
  const store: Record<string, string> = { ...initial };
  return {
    store,
    get: async () => ({ ...store }),
    set: async (items: Record<string, string>) => {
      Object.assign(store, items);
    },
    remove: async (keys: string[]) => {
      for (const k of keys) delete store[k];
    },
  };
}

describe("storeCapture", () => {
  it("stores the new capture under its key", async () => {
    const storage = fakeStorage();
    await storeCapture(storage, `${SESSION_KEY_PREFIX}1`, "data:image/png;base64,AAA");
    expect(storage.store[`${SESSION_KEY_PREFIX}1`]).toBe("data:image/png;base64,AAA");
  });

  it("evicts a prior capture so session storage holds only one image", async () => {
    const storage = fakeStorage({ [`${SESSION_KEY_PREFIX}1`]: "old" });
    await storeCapture(storage, `${SESSION_KEY_PREFIX}2`, "new");

    const keys = Object.keys(storage.store);
    expect(keys).toEqual([`${SESSION_KEY_PREFIX}2`]);
    expect(storage.store[`${SESSION_KEY_PREFIX}2`]).toBe("new");
  });

  it("evicts multiple leaked captures (the quota-exceeded scenario)", async () => {
    const storage = fakeStorage({
      [`${SESSION_KEY_PREFIX}1`]: "leak-a",
      [`${SESSION_KEY_PREFIX}2`]: "leak-b",
      [`${SESSION_KEY_PREFIX}3`]: "leak-c",
    });
    await storeCapture(storage, `${SESSION_KEY_PREFIX}4`, "fresh");

    expect(Object.keys(storage.store)).toEqual([`${SESSION_KEY_PREFIX}4`]);
  });

  it("leaves non-shotglow keys untouched", async () => {
    const storage = fakeStorage({ "other:setting": "keep", [`${SESSION_KEY_PREFIX}1`]: "drop" });
    await storeCapture(storage, `${SESSION_KEY_PREFIX}2`, "new");

    expect(storage.store["other:setting"]).toBe("keep");
    expect(storage.store[`${SESSION_KEY_PREFIX}1`]).toBeUndefined();
    expect(storage.store[`${SESSION_KEY_PREFIX}2`]).toBe("new");
  });

  it("rejects a single image larger than the quota with a clear message", async () => {
    const storage = fakeStorage();
    const big = "x".repeat(50);
    await expect(
      storeCapture(storage, `${SESSION_KEY_PREFIX}1`, big, /* quotaBytes */ 10),
    ).rejects.toThrow(/too large to capture/);

    // Nothing stored when the image cannot fit.
    expect(storage.store[`${SESSION_KEY_PREFIX}1`]).toBeUndefined();
  });

  it("still evicts stale captures even when the new image is rejected", async () => {
    const storage = fakeStorage({ [`${SESSION_KEY_PREFIX}1`]: "old" });
    await expect(
      storeCapture(storage, `${SESSION_KEY_PREFIX}2`, "x".repeat(50), 10),
    ).rejects.toThrow();

    // The leaked blob is gone, freeing the quota for the next attempt.
    expect(storage.store[`${SESSION_KEY_PREFIX}1`]).toBeUndefined();
  });
});
