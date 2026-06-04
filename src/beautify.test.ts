import { describe, it, expect } from "bun:test";
import { DEFAULT_BEAUTIFY, mergeBeautify, debounce, clamp } from "./beautify.js";

describe("clamp", () => {
  it("clamps to range", () => {
    expect(clamp(5, 0, 4)).toBe(4);
    expect(clamp(-2, 0, 4)).toBe(0);
    expect(clamp(2, 0, 4)).toBe(2);
  });
});

describe("mergeBeautify", () => {
  it("returns a clone of defaults for empty/invalid input", () => {
    const merged = mergeBeautify(DEFAULT_BEAUTIFY, undefined);
    expect(merged).toEqual(DEFAULT_BEAUTIFY);
    expect(merged).not.toBe(DEFAULT_BEAUTIFY);
    expect(merged.shadow).not.toBe(DEFAULT_BEAUTIFY.shadow);
  });

  it("clamps out-of-range numeric fields", () => {
    const merged = mergeBeautify(DEFAULT_BEAUTIFY, { margin: 9999, scale: 5, radius: -10 });
    expect(merged.margin).toBe(400); // BOUNDS.margin.max
    expect(merged.scale).toBe(1); // BOUNDS.scale.max
    expect(merged.radius).toBe(0); // BOUNDS.radius.min
  });

  it("fills missing fields from base and ignores unknown keys", () => {
    const merged = mergeBeautify(DEFAULT_BEAUTIFY, { margin: 10, bogus: "x" } as Record<string, unknown>);
    expect(merged.margin).toBe(10);
    expect(merged.scale).toBe(DEFAULT_BEAUTIFY.scale);
    expect("bogus" in merged).toBe(false);
  });

  it("merges shadow partially and clamps opacity", () => {
    const merged = mergeBeautify(DEFAULT_BEAUTIFY, { shadow: { opacity: 2, enabled: false } });
    expect(merged.shadow.opacity).toBe(1);
    expect(merged.shadow.enabled).toBe(false);
    expect(merged.shadow.blur).toBe(DEFAULT_BEAUTIFY.shadow.blur);
  });

  it("accepts a valid solid background", () => {
    const merged = mergeBeautify(DEFAULT_BEAUTIFY, { background: { type: "solid", color: "#abcdef" } });
    expect(merged.background).toEqual({ type: "solid", color: "#abcdef" });
  });

  it("accepts a valid custom gradient", () => {
    const merged = mergeBeautify(DEFAULT_BEAUTIFY, {
      background: { type: "gradient", custom: { angle: 90, stops: [{ offset: 0, color: "#000" }, { offset: 1, color: "#fff" }] } },
    });
    expect(merged.background).toEqual({
      type: "gradient",
      custom: { angle: 90, stops: [{ offset: 0, color: "#000" }, { offset: 1, color: "#fff" }] },
    });
  });

  it("falls back to base for an invalid background", () => {
    const merged = mergeBeautify(DEFAULT_BEAUTIFY, { background: { type: "bogus" } as never });
    expect(merged.background).toEqual(DEFAULT_BEAUTIFY.background);
  });

  it("falls back to base for an invalid aspect", () => {
    const merged = mergeBeautify(DEFAULT_BEAUTIFY, { aspect: "21:9" as never });
    expect(merged.aspect).toBe(DEFAULT_BEAUTIFY.aspect);
  });
});

describe("debounce", () => {
  it("only fires once with the last args after the delay", async () => {
    const calls: number[] = [];
    const fn = debounce((n: number) => calls.push(n), 20);
    fn(1);
    fn(2);
    fn(3);
    expect(calls).toEqual([]); // nothing yet
    await new Promise((r) => setTimeout(r, 40));
    expect(calls).toEqual([3]);
  });
});
