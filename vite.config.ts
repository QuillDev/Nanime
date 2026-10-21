import { defineConfig, type Plugin } from "vite";
import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Both latin variable fonts are on every page, but the browser only finds them
// after the CSS is parsed and text is laid out, so headings painted in the
// fallback font and then swapped. Preloading them from the HTML fetches them
// alongside the CSS.
const PRELOADED_FONTS = [/geist-latin-wght-normal-[\w-]+\.woff2$/u, /bricolage-grotesque-latin-wght-normal-[\w-]+\.woff2$/u];

function preloadFonts(): Plugin {
  return {
    name: "nanime-preload-fonts",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler: (_html, context) => Object.keys(context.bundle ?? {})
        .filter((file) => PRELOADED_FONTS.some((pattern) => pattern.test(file)))
        .map((file) => ({
          tag: "link",
          attrs: { rel: "preload", href: `/${file}`, as: "font", type: "font/woff2", crossorigin: "" },
          injectTo: "head-prepend" as const,
        })),
    },
  };
}

// In dev, proxy media requests to the Bun server on :8096 so the
// React app and backend share an origin. In production the Bun server
// serves the built `dist/` directly.
export default defineConfig({
  plugins: [react(), tailwindcss(), preloadFonts()],
  resolve: {
    alias: [
      { find: "@", replacement: fileURLToPath(new URL("src", import.meta.url)) },
      // Nanime's playlists are single-rendition media playlists with no
      // alternate audio, HLS subtitles or DRM, so the light build plays them
      // all at about 60% of the full build's size. Types still come from "hls.js".
      { find: /^hls\.js$/u, replacement: "hls.js/light" },
    ],
  },
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8096",
      "/stream": "http://127.0.0.1:8096",
      "/offline-media": "http://127.0.0.1:8096",
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
