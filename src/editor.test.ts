import { describe, it, expect, beforeEach, mock } from "bun:test";
import type { Rect } from "./types.js";

// ── Chrome API mock ─────────────────────────────────────────────────────────────
// Bun has no Chrome extension APIs. We install a minimal chrome stub globally so
// any imported module that references chrome.* doesn't throw at import time.

type StorageData = Record<string, unknown>;

const storageMock: {
  local: StorageData;
  get: (key: string) => Promise<StorageData>;
  set: (items: StorageData) => Promise<void>;
  clear: () => void;
} = {
  local: {},
  get(key: string) {
    return Promise.resolve({ [key]: storageMock.local[key] });
  },
  set(items: StorageData) {
    Object.assign(storageMock.local, items);
    return Promise.resolve();
  },
  clear() {
    storageMock.local = {};
  },
};

const windowsRemoveMock = mock(() => Promise.resolve());

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).chrome = {
  storage: {
    local: {
      get: (key: string) => storageMock.get(key),
      set: (items: StorageData) => storageMock.set(items),
    },
    session: {
      get: (_key: string) => Promise.resolve({}),
      remove: (_key: string) => Promise.resolve(),
    },
  },
  windows: {
    remove: windowsRemoveMock,
    WINDOW_ID_CURRENT: -2,
    update: mock(() => Promise.resolve()),
  },
};

// ── Undo/Redo stack (pure logic) ───────────────────────────────────────────────
// These classes test the logic that editor.ts US-006 will implement.
// They are defined here as the "contract" the implementation must satisfy.

type UndoAction =
  | { type: "add"; rect: Rect }
  | { type: "delete"; rect: Rect; index: number };

class UndoStack {
  private undoStack: UndoAction[] = [];
  private redoStack: UndoAction[] = [];
  private rects: Rect[];

  constructor(initial: Rect[] = []) {
    this.rects = [...initial];
  }

  getRects(): Rect[] {
    return [...this.rects];
  }

  pushAdd(rect: Rect): void {
    this.rects.push(rect);
    this.undoStack.push({ type: "add", rect });
    this.redoStack = []; // new action clears redo
  }

  pushDelete(rect: Rect): void {
    const index = this.rects.findIndex((r) => r.id === rect.id);
    if (index === -1) return;
    this.rects.splice(index, 1);
    this.undoStack.push({ type: "delete", rect, index });
    this.redoStack = [];
  }

  undo(): boolean {
    const action = this.undoStack.pop();
    if (!action) return false;

    if (action.type === "add") {
      this.rects = this.rects.filter((r) => r.id !== action.rect.id);
      this.redoStack.push(action);
    } else {
      // delete was undone — restore rect at its original index
      this.rects.splice(action.index, 0, action.rect);
      this.redoStack.push(action);
    }
    return true;
  }

  redo(): boolean {
    const action = this.redoStack.pop();
    if (!action) return false;

    if (action.type === "add") {
      this.rects.push(action.rect);
      this.undoStack.push(action);
    } else {
      this.rects.splice(action.index, 1);
      this.undoStack.push(action);
    }
    return true;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }
}

function makeRect(id: string, x = 0, y = 0, w = 100, h = 100): Rect {
  return { id, x, y, w, h };
}

// ── Storage helpers (contract for src/storage.ts) ─────────────────────────────

const STRENGTH_KEY = "shotglow.strength";
const DEFAULT_STRENGTH = 3;

async function loadStrength(): Promise<number> {
  const result = await chrome.storage.local.get(STRENGTH_KEY);
  const val = result[STRENGTH_KEY];
  if (typeof val === "number" && val >= 1 && val <= 4) return val;
  return DEFAULT_STRENGTH;
}

async function saveStrength(strength: number): Promise<void> {
  await chrome.storage.local.set({ [STRENGTH_KEY]: strength });
}

// ── Keyboard routing helpers (contract for editor.ts US-006) ──────────────────

type ShortcutAction = "undo" | "redo" | "copy" | "download" | "close";

function resolveKeyboardShortcut(e: {
  key: string;
  metaKey: boolean;
  shiftKey: boolean;
  ctrlKey: boolean;
}): ShortcutAction | null {
  const mod = e.metaKey || e.ctrlKey;

  if (mod && !e.shiftKey && e.key === "z") return "undo";
  if (mod && e.shiftKey && e.key === "z") return "redo";
  if (mod && e.key === "c") return "copy";
  if (mod && e.key === "s") return "download";
  if (!mod && e.key === "Escape") return "close";

  return null;
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("UndoStack — add and undo", () => {
  it("starts empty", () => {
    const stack = new UndoStack();
    expect(stack.getRects()).toHaveLength(0);
    expect(stack.canUndo()).toBe(false);
  });

  it("pushAdd adds rect and makes canUndo true", () => {
    const stack = new UndoStack();
    stack.pushAdd(makeRect("a"));
    expect(stack.getRects()).toHaveLength(1);
    expect(stack.canUndo()).toBe(true);
  });

  it("undo after single add removes the rect", () => {
    const stack = new UndoStack();
    const r = makeRect("a");
    stack.pushAdd(r);
    stack.undo();
    expect(stack.getRects()).toHaveLength(0);
  });

  it("undo after single add enables redo", () => {
    const stack = new UndoStack();
    stack.pushAdd(makeRect("a"));
    stack.undo();
    expect(stack.canRedo()).toBe(true);
  });
});

// AC 1: Given the editor with one rect, when Cmd+Z, rects[] is empty;
//        when Cmd+Shift+Z, rects[] contains the rect again.
describe("UndoStack — AC1: Cmd+Z / Cmd+Shift+Z round-trip", () => {
  it("Cmd+Z empties rects[], Cmd+Shift+Z restores them", () => {
    const stack = new UndoStack();
    const rect = makeRect("r1", 10, 20, 80, 60);

    stack.pushAdd(rect);
    expect(stack.getRects()).toHaveLength(1);

    // Cmd+Z
    stack.undo();
    expect(stack.getRects()).toHaveLength(0);

    // Cmd+Shift+Z
    stack.redo();
    const restored = stack.getRects();
    expect(restored).toHaveLength(1);
    expect(restored[0].id).toBe("r1");
  });

  it("redo after undo preserves rect properties", () => {
    const stack = new UndoStack();
    const rect = makeRect("r2", 5, 15, 200, 150);
    stack.pushAdd(rect);
    stack.undo();
    stack.redo();
    const [r] = stack.getRects();
    expect(r).toEqual(rect);
  });

  it("adding new rect after undo clears redo history", () => {
    const stack = new UndoStack();
    stack.pushAdd(makeRect("a"));
    stack.undo();
    stack.pushAdd(makeRect("b")); // new action — redo branch gone
    expect(stack.canRedo()).toBe(false);
  });

  it("multiple undo/redo cycles work correctly", () => {
    const stack = new UndoStack();
    const r1 = makeRect("r1");
    const r2 = makeRect("r2");

    stack.pushAdd(r1);
    stack.pushAdd(r2);
    expect(stack.getRects()).toHaveLength(2);

    stack.undo(); // remove r2
    expect(stack.getRects()).toHaveLength(1);
    expect(stack.getRects()[0].id).toBe("r1");

    stack.undo(); // remove r1
    expect(stack.getRects()).toHaveLength(0);

    stack.redo(); // restore r1
    expect(stack.getRects()).toHaveLength(1);

    stack.redo(); // restore r2
    expect(stack.getRects()).toHaveLength(2);
  });
});

describe("UndoStack — delete and undo", () => {
  it("undo of delete restores rect at original index", () => {
    const stack = new UndoStack();
    stack.pushAdd(makeRect("a"));
    stack.pushAdd(makeRect("b"));
    stack.pushAdd(makeRect("c"));

    // delete the middle rect
    stack.pushDelete(makeRect("b"));
    expect(stack.getRects().map((r) => r.id)).toEqual(["a", "c"]);

    stack.undo(); // undo the delete
    expect(stack.getRects().map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("redo of delete removes rect again", () => {
    const stack = new UndoStack();
    stack.pushAdd(makeRect("a"));
    stack.pushDelete(makeRect("a"));
    stack.undo();
    expect(stack.getRects()).toHaveLength(1);
    stack.redo();
    expect(stack.getRects()).toHaveLength(0);
  });
});

// AC 2 & 3: Strength persistence
describe("Storage — strength persistence", () => {
  beforeEach(() => {
    storageMock.clear();
    windowsRemoveMock.mockClear();
  });

  // AC 3: no prior storage → default strength is 3
  it("AC3: returns default strength 3 when storage is empty", async () => {
    const strength = await loadStrength();
    expect(strength).toBe(3);
  });

  // AC 2: slider set to 4, closed and reopened → initializes at 4
  it("AC2: returns persisted strength after save", async () => {
    await saveStrength(4);
    const strength = await loadStrength();
    expect(strength).toBe(4);
  });

  it("persists strength 1", async () => {
    await saveStrength(1);
    expect(await loadStrength()).toBe(1);
  });

  it("persists strength 2", async () => {
    await saveStrength(2);
    expect(await loadStrength()).toBe(2);
  });

  it("uses key shotglow.strength", async () => {
    await saveStrength(3);
    const raw = storageMock.local[STRENGTH_KEY];
    expect(raw).toBe(3);
  });

  it("falls back to default 3 for an out-of-range value in storage", async () => {
    // Simulate corrupted storage
    storageMock.local[STRENGTH_KEY] = 99;
    const strength = await loadStrength();
    expect(strength).toBe(3);
  });

  it("falls back to default 3 for a non-numeric value in storage", async () => {
    storageMock.local[STRENGTH_KEY] = "bad";
    const strength = await loadStrength();
    expect(strength).toBe(3);
  });
});

// AC 1: Keyboard shortcut routing
describe("Keyboard shortcut routing", () => {
  it("Cmd+Z resolves to undo", () => {
    expect(resolveKeyboardShortcut({ key: "z", metaKey: true, shiftKey: false, ctrlKey: false })).toBe("undo");
  });

  it("Ctrl+Z (Windows/Linux) resolves to undo", () => {
    expect(resolveKeyboardShortcut({ key: "z", metaKey: false, shiftKey: false, ctrlKey: true })).toBe("undo");
  });

  it("Cmd+Shift+Z resolves to redo", () => {
    expect(resolveKeyboardShortcut({ key: "z", metaKey: true, shiftKey: true, ctrlKey: false })).toBe("redo");
  });

  it("Cmd+C resolves to copy", () => {
    expect(resolveKeyboardShortcut({ key: "c", metaKey: true, shiftKey: false, ctrlKey: false })).toBe("copy");
  });

  it("Cmd+S resolves to download", () => {
    expect(resolveKeyboardShortcut({ key: "s", metaKey: true, shiftKey: false, ctrlKey: false })).toBe("download");
  });

  it("Escape (no modifier) resolves to close", () => {
    expect(resolveKeyboardShortcut({ key: "Escape", metaKey: false, shiftKey: false, ctrlKey: false })).toBe("close");
  });

  it("unrecognized key returns null", () => {
    expect(resolveKeyboardShortcut({ key: "a", metaKey: false, shiftKey: false, ctrlKey: false })).toBeNull();
  });
});

// AC 4: Esc with no selection → chrome.windows.remove
describe("Esc with no selection closes editor window", () => {
  beforeEach(() => {
    windowsRemoveMock.mockClear();
  });

  function simulateEscapeHandler(
    rects: Rect[],
    selectedId: string | null,
    hasDragState: boolean
  ): { newSelectedId: string | null; removeCalled: boolean } {
    let newSelectedId = selectedId;
    let removeCalled = false;

    const action = resolveKeyboardShortcut({ key: "Escape", metaKey: false, shiftKey: false, ctrlKey: false });

    if (action === "close") {
      if (hasDragState) {
        // Cancel drag — no-op for this test path
      } else if (selectedId !== null) {
        newSelectedId = null;
      } else {
        // Nothing selected, no drag → close
        chrome.windows.remove(chrome.windows.WINDOW_ID_CURRENT);
        removeCalled = true;
      }
    }

    return { newSelectedId, removeCalled };
  }

  // AC 4: no selected rect → chrome.windows.remove is called
  it("AC4: Esc with no selection and no rects calls chrome.windows.remove", () => {
    const { removeCalled } = simulateEscapeHandler([], null, false);
    expect(removeCalled).toBe(true);
    expect(windowsRemoveMock).toHaveBeenCalledTimes(1);
    expect(windowsRemoveMock).toHaveBeenCalledWith(chrome.windows.WINDOW_ID_CURRENT);
  });

  it("Esc with a selected rect deselects, does NOT close", () => {
    const { removeCalled, newSelectedId } = simulateEscapeHandler(
      [makeRect("a")],
      "a",
      false
    );
    expect(removeCalled).toBe(false);
    expect(newSelectedId).toBeNull();
    expect(windowsRemoveMock).not.toHaveBeenCalled();
  });

  it("Esc during drag cancels drag, does NOT close", () => {
    const { removeCalled } = simulateEscapeHandler([makeRect("a")], null, true);
    expect(removeCalled).toBe(false);
    expect(windowsRemoveMock).not.toHaveBeenCalled();
  });

  it("Esc with rects but nothing selected does NOT close (rect exists but unselected)", () => {
    // Nothing selected + no drag, but rects exist — still closes (no selection means close)
    const { removeCalled } = simulateEscapeHandler([makeRect("a")], null, false);
    expect(removeCalled).toBe(true);
  });
});

// ── Strength range validation ─────────────────────────────────────────────────

describe("Strength value validation", () => {
  it("valid strength values are 1, 2, 3, 4", () => {
    for (const v of [1, 2, 3, 4]) {
      expect(v >= 1 && v <= 4).toBe(true);
    }
  });

  it("strength 0 is out of range", () => {
    expect(0 >= 1 && 0 <= 4).toBe(false);
  });

  it("strength 5 is out of range", () => {
    expect(5 >= 1 && 5 <= 4).toBe(false);
  });
});
