import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

// data/ sits above app/ on purpose: the pipeline contract belongs to the repo,
// not to the frontend. We import the JSON as a module so Vite inlines it at
// build time (single static artifact, no fetch, no loading state) and HMR
// reloads the page the moment merge.py rewrites the file.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
      "@data": path.resolve(import.meta.dirname, "../data"),
    },
  },
  server: {
    fs: { allow: [path.resolve(import.meta.dirname, "..")] },
  },
});
