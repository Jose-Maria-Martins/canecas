import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The SPA builds to ./dist and is served by the single Caneca Worker via
// Workers Static Assets (see TASKS.md §9). During local dev, /api and /ws are
// proxied to the local Worker (wrangler dev on :8787) when it exists; until the
// backend is up, the app falls back to its in-app mock layer (see src/api).
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    sourcemap: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8787",
        changeOrigin: true,
      },
      "/ws": {
        target: "ws://localhost:8787",
        ws: true,
      },
    },
  },
});
