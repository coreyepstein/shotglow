# Shotglow — launch video

A [Remotion](https://www.remotion.dev/) project that renders the Shotglow launch
video: a 25s, 1080×1080 (square) silent clip with kinetic captions.

Story beats (one continuous timeline in `src/ShotglowLaunch.tsx`):
intro lockup → a screenshot leaking an email + API key → redaction sweeps in →
the shot lands on a gradient, gains a frame, shadow, and pattern overlay → hero
+ brand outro.

## Develop

```bash
pnpm install            # toolchain installed with pnpm (see repo note below)
pnpm studio             # open the Remotion preview/editor
```

## Render

```bash
pnpm render             # → out/shotglow-launch.mp4 (h264, 1080×1080)
pnpm still              # → out/poster.png (a single hero frame)
```

`out/` and `node_modules/` are gitignored — the MP4 is a build artifact, not
committed. Re-render from source any time.

## Notes

- 30fps, 750 frames. Edit timings/captions in `src/ShotglowLaunch.tsx`; the
  composition is registered in `src/Root.tsx`.
- Brand assets (`public/icon.svg`, etc.) are copied from the extension's
  `assets/`. Update them there and re-copy if the icon changes.
- Silent by design (no licensing). Drop an `<Audio>` track into the composition
  if you want music.
