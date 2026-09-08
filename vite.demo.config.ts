import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  root: resolve(import.meta.dirname, "examples"),
  base: "./",
  build: {
    outDir: resolve(import.meta.dirname, "demo-dist"),
    emptyOutDir: true,
    sourcemap: true,
  },
});
