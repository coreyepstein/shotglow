#!/usr/bin/env node
// Dev-time wallpaper generator for Redact-It background presets.
//
// Image generation cannot run in-browser, so bundled wallpapers are produced
// here at dev time and committed into assets/backgrounds/. This is intentionally
// NOT wired into `vite build` so CI needs no image-gen credentials.
//
// Usage:  bun run gen:wallpapers
//
// After generating, add a matching entry to IMAGE_PRESETS in src/backgrounds.ts
// (the UI's Image tab reads that registry) and commit both the PNG and the code.
//
// This uses the Codex CLI's image generation. The exact subcommand can vary by
// Codex version — adjust `codexImageArgs` below to match your installed CLI.

import { existsSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, "..", "assets", "backgrounds");

// id → image-generation prompt. Keep prompts reproducible and documented here.
const WALLPAPERS = [
  { id: "aurora", prompt: "Soft abstract aurora gradient, deep indigo to teal, smooth, no text, 1600x1000" },
  { id: "mesh-warm", prompt: "Warm mesh gradient blobs, coral peach and amber, blurred, no text, 1600x1000" },
  { id: "waves-blue", prompt: "Minimal flowing wave layers, cool blues, gentle, no text, 1600x1000" },
  { id: "studio-gray", prompt: "Neutral studio backdrop, soft gray vignette, subtle, no text, 1600x1000" },
];

function codexImageArgs(prompt, outPath) {
  // Adjust to your Codex CLI's image-gen interface.
  return ["image", "generate", "--prompt", prompt, "--out", outPath];
}

function hasCodex() {
  const probe = spawnSync("codex", ["--version"], { stdio: "ignore" });
  return probe.status === 0;
}

function main() {
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  if (!hasCodex()) {
    console.log("Codex CLI not found on PATH.");
    console.log("Install it, then re-run `bun run gen:wallpapers`. Prompt manifest:");
    for (const w of WALLPAPERS) console.log(`  - ${w.id}: ${w.prompt}`);
    process.exit(0);
  }

  for (const w of WALLPAPERS) {
    const outPath = resolve(OUT_DIR, `${w.id}.png`);
    console.log(`Generating ${w.id} → ${outPath}`);
    const res = spawnSync("codex", codexImageArgs(w.prompt, outPath), { stdio: "inherit" });
    if (res.status !== 0) {
      console.warn(`  ! generation failed for ${w.id} (status ${res.status}) — skipping`);
    }
  }

  console.log("\nDone. Add an IMAGE_PRESETS entry per generated file in src/backgrounds.ts.");
}

main();
