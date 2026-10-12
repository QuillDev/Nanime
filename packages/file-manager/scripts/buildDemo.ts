// Offline demo bundle: React included, no network, opens from any static server.
import { build } from "esbuild";

const root = Bun.fileURLToPath(new URL("..", import.meta.url));
const out = `${root}demo/dist`;

await Bun.$`rm -rf ${out}`;
await Bun.$`mkdir -p ${out}`;

await build({
  absWorkingDir: import.meta.dirname,
  entryPoints: ["../demo/main.tsx"],
  outfile: `${out}/demo.js`,
  bundle: true,
  tsconfig: `${root}tsconfig.json`,
  format: "esm",
  platform: "browser",
  target: "es2022",
  jsx: "automatic",
  minify: true,
  sourcemap: true,
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "info",
});

await Bun.write(`${out}/file-manager.css`, Bun.file(`${root}src/styles.css`));
await Bun.write(`${out}/demo.css`, Bun.file(`${root}demo/demo.css`));
await Bun.write(`${out}/index.html`, Bun.file(`${root}demo/index.html`));
console.log("built demo/dist/");
