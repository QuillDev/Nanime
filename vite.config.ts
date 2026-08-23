import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// In dev, proxy media requests to the Bun server on :8096 so the
// React app and backend share an origin. In production the Bun server
// serves the built `dist/` directly.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("src", import.meta.url)),
    },
  },
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8096",
      "/stream": "http://127.0.0.1:8096",
      "/thumbnail": "http://127.0.0.1:8096",
      "/subtitle": "http://127.0.0.1:8096",
      "/hls": "http://127.0.0.1:8096",
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
