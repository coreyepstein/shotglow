// Simple wrappers around chrome.storage.local for persisted editor settings.

import type { BeautifySettings } from "./types.js";
import { DEFAULT_BEAUTIFY, mergeBeautify } from "./beautify.js";

const STRENGTH_KEY = "redact-it.strength";
const DEFAULT_STRENGTH = 3;
const BEAUTIFY_KEY = "redact-it.beautify";

export async function loadStrength(): Promise<number> {
  const result = await chrome.storage.local.get(STRENGTH_KEY);
  const val = result[STRENGTH_KEY];
  if (typeof val === "number" && val >= 1 && val <= 4) return val;
  return DEFAULT_STRENGTH;
}

export async function saveStrength(value: number): Promise<void> {
  await chrome.storage.local.set({ [STRENGTH_KEY]: value });
}

export async function loadBeautify(): Promise<BeautifySettings> {
  const result = await chrome.storage.local.get(BEAUTIFY_KEY);
  return mergeBeautify(DEFAULT_BEAUTIFY, result[BEAUTIFY_KEY]);
}

export async function saveBeautify(settings: BeautifySettings): Promise<void> {
  await chrome.storage.local.set({ [BEAUTIFY_KEY]: settings });
}
