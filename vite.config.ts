import { defineConfig } from "vite";
import { resolve } from "path";
import fs from "fs";

export default defineConfig({
  root: "src",
  build: {
    outDir: resolve(__dirname, "dist"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        // HTML page entry — Vite handles the TS script tag transform
        editor: resolve(__dirname, "src/editor.html"),
        // Script entries for background and content
        background: resolve(__dirname, "src/background.ts"),
        content: resolve(__dirname, "src/content.ts"),
      },
      output: {
        // background.js and content.js must be flat in dist/
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === "background" || chunkInfo.name === "content") {
            return "[name].js";
          }
          return "assets/[name]-[hash].js";
        },
        // Put editor JS output in assets/ (it's referenced from editor.html automatically)
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
  plugins: [
    {
      name: "copy-manifest-and-icons",
      writeBundle(options) {
        const outDir = options.dir ?? resolve(__dirname, "dist");

        // Copy manifest.json to dist/
        fs.copyFileSync(
          resolve(__dirname, "manifest.json"),
          resolve(outDir, "manifest.json")
        );

        // Recursively copy a directory tree if it exists.
        const copyDir = (src: string, dest: string): void => {
          if (!fs.existsSync(src)) return;
          fs.mkdirSync(dest, { recursive: true });
          for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
            const srcPath = resolve(src, entry.name);
            const destPath = resolve(dest, entry.name);
            if (entry.isDirectory()) copyDir(srcPath, destPath);
            else fs.copyFileSync(srcPath, destPath);
          }
        };

        // Copy icons/ to dist/icons/
        copyDir(resolve(__dirname, "icons"), resolve(outDir, "icons"));

        // Copy bundled background assets to dist/assets/
        copyDir(resolve(__dirname, "assets"), resolve(outDir, "assets"));
      },
    },
  ],
});
