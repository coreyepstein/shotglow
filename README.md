# Redact-It

A Chrome MV3 extension for redacting sensitive regions from images before sharing.

## Load Unpacked (Development)

1. Run `bun run build` to produce the `dist/` folder.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer Mode** (toggle in the top-right corner).
4. Click **Load unpacked**.
5. Select the `dist/` folder inside this repo.
6. The Redact-It extension icon will appear in your toolbar.

Whenever you make changes, re-run `bun run build` and click the refresh icon next to Redact-It on `chrome://extensions`.

## Dev Workflow

```bash
bun install          # install dependencies
bun run build        # build to dist/
bun run typecheck    # TypeScript check (no emit)
bun run lint         # lint (stub — wired in a later story)
bun run test         # tests (stub — wired in a later story)
```

## Permissions Justification

| Permission | Why it's needed |
|---|---|
| `contextMenus` | Adds a "Redact with Redact-It" item to the right-click menu on images. |
| `activeTab` | Grants temporary access to the current tab when the user invokes the extension. |
| `scripting` | Injects the content script dynamically for blob URL bridging between the page and the editor. |
| `storage` | `session` storage for transient image handoff between service worker and editor; `local` storage to persist user settings (e.g. redaction strength). |
| `clipboardWrite` | Writes the final redacted PNG to the clipboard so the user can paste it anywhere. |
| `host_permissions: <all_urls>` | The context menu must appear on images from any origin, so broad host permission is required for `contextMenus` to fire universally. |

## Project Structure

```
redact-it/
├── src/
│   ├── background.ts   # MV3 service worker
│   ├── content.ts      # Content script (injected into pages)
│   ├── editor.html     # Full-page redaction editor
│   ├── editor.ts       # Editor logic
│   └── types.ts        # Shared TypeScript types
├── icons/              # Extension icons (16/32/48/128 px)
├── manifest.json       # Chrome MV3 manifest
├── vite.config.ts      # Multi-entry Vite build config
├── tsconfig.json
└── package.json
```

After `bun run build`, the `dist/` folder mirrors what Chrome loads:

```
dist/
├── background.js
├── content.js
├── editor.html
├── editor.js           # (or assets/editor-[hash].js — referenced from editor.html)
├── icons/
│   ├── 16.png
│   ├── 32.png
│   ├── 48.png
│   └── 128.png
└── manifest.json
```
