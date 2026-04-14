// Simple wrapper around chrome.storage.local for strength persistence

const STRENGTH_KEY = "redact-it.strength";
const DEFAULT_STRENGTH = 3;

export async function loadStrength(): Promise<number> {
  const result = await chrome.storage.local.get(STRENGTH_KEY);
  const val = result[STRENGTH_KEY];
  if (typeof val === "number" && val >= 1 && val <= 4) return val;
  return DEFAULT_STRENGTH;
}

export async function saveStrength(value: number): Promise<void> {
  await chrome.storage.local.set({ [STRENGTH_KEY]: value });
}
