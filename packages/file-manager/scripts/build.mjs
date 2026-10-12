// Library build: ESM bundle (React external) + .d.ts + standalone CSS.
// Dependencies are located through module resolution, so this works with the
// hoisted workspace install as well as a standalone one.
import { build } from "esbuild";

const root = Bun.fileURLToPath(new URL("..", import.meta.url));
const dist = `${root}dist`;

/** Path of a file inside an installed package, wherever the linker put it. */
function packageFile(specifier) {
  return Bun.fileURLToPath(import.meta.resolve(specifier));
}

async function emitDeclarations() {
  const manifest = import.meta.resolve("typescript/package.json");
  const { bin } = await Bun.file(Bun.fileURLToPath(manifest)).json();
  const tsc = Bun.fileURLToPath(new URL(bin.tsc, manifest));
  const result = Bun.spawnSync([process.execPath, tsc, "-p", `${root}tsconfig.build.json`], { stdout: "inherit", stderr: "inherit" });
  if (result.exitCode !== 0) {
    process.exit(result.exitCode ?? 1);
  }
}

await Bun.$`rm -rf ${dist}`;
await Bun.$`mkdir -p ${dist}`;

await build({
  entryPoints: [`${root}src/index.ts`],
  outfile: `${dist}/index.js`,
  bundle: true,
  tsconfig: `${root}tsconfig.json`,
  format: "esm",
  platform: "neutral",
  mainFields: ["module", "main"],
  target: "es2022",
  jsx: "automatic",
  sourcemap: true,
  external: ["react", "react-dom", "react/jsx-runtime"],
  logLevel: "info",
});

await Bun.write(`${dist}/styles.css`, Bun.file(`${root}src/styles.css`));
await Bun.write(`${dist}/THIRD_PARTY_NOTICES.txt`, Bun.file(packageFile("lucide-react/LICENSE")));
await emitDeclarations();
console.log("built dist/index.js, dist/index.d.ts, dist/styles.css, dist/THIRD_PARTY_NOTICES.txt");
