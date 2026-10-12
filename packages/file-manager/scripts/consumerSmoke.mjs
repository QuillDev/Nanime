// Extracted-consumer smoke test: packs the package, unpacks the tarball in a
// fresh temporary directory outside the repository, and checks it from there.
// React is borrowed from this install; the package code comes only from the
// extracted tarball.
import { checkPackage } from "./packageChecks.mjs";

const root = Bun.fileURLToPath(new URL("..", import.meta.url));
const work = `${Bun.env["TMPDIR"] ?? "/tmp"}/nfm-consumer-${crypto.randomUUID()}`;
const extracted = `${work}/package`;

const RENDER = `
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { FileManager, sizeColumn } from "@nanime/file-manager";

const items = [
  { id: "shows", parentId: null, name: "Shows", kind: "folder" },
  { id: "pilot", parentId: "shows", name: "Pilot.mkv", kind: "file", size: 1048576 },
];
const html = renderToString(createElement(FileManager, {
  items,
  columns: [sizeColumn()],
  defaultFolderId: "shows",
  labels: { root: "Library" },
  onOperation: () => undefined,
}));
console.log(JSON.stringify({ html, entry: import.meta.resolve("@nanime/file-manager") }));
`;

function run(command, cwd) {
  const result = Bun.spawnSync(command, { cwd, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) {
    throw new Error(`${command.join(" ")} failed:\n${result.stderr.toString()}`);
  }
  return result.stdout.toString().trim();
}

/** Packs and unpacks the package, then links it and React into a consumer project. */
async function prepareConsumer() {
  run([process.execPath, "run", "build"], root);
  await Bun.$`mkdir -p ${work}/consumer ${work}/node_modules/@nanime`;
  const tarball = run([process.execPath, "pm", "pack", "--quiet", "--destination", work], root).split("\n").at(-1) ?? "";
  run(["tar", "-xzf", tarball.startsWith("/") ? tarball : `${work}/${tarball}`, "-C", work], work);
  const react = Bun.fileURLToPath(new URL(".", import.meta.resolve("react/package.json")));
  const reactDom = Bun.fileURLToPath(new URL(".", import.meta.resolve("react-dom/package.json")));
  await Bun.$`ln -s ${extracted} ${work}/node_modules/@nanime/file-manager && ln -s ${react} ${work}/node_modules/react && ln -s ${reactDom} ${work}/node_modules/react-dom`;
  await Bun.write(`${work}/consumer/render.mjs`, RENDER);
}

/** Exports declared in the extracted package.json resolve to files that exist. */
function resolutionProblems() {
  const problems = [];
  for (const specifier of ["@nanime/file-manager", "@nanime/file-manager/styles.css", "@nanime/file-manager/package.json"]) {
    const resolved = Bun.resolveSync(specifier, `${work}/consumer`);
    if (!resolved.startsWith(`${extracted}/`)) {
      problems.push(`${specifier} resolved outside the extracted package: ${resolved}`);
    }
  }
  return problems;
}

/** Server-renders the manager from the extracted copy. */
function renderProblems() {
  const { html, entry } = JSON.parse(run([process.execPath, "render.mjs"], `${work}/consumer`));
  const expected = ['class="nfm nfm--ledger"', 'role="grid"', 'data-nfm-id="pilot"', "Pilot.mkv", "Library"];
  const problems = expected.filter((fragment) => !html.includes(fragment)).map((fragment) => `server render lacks ${fragment}`);
  if (!Bun.fileURLToPath(entry).startsWith(`${extracted}/`)) {
    problems.push(`FileManager was loaded from ${entry}, not the extracted tarball`);
  }
  return problems;
}

try {
  await prepareConsumer();
  const { problems, summary } = await checkPackage(extracted);
  const all = [...problems, ...resolutionProblems(), ...renderProblems()];
  for (const problem of all) {
    console.error(`smoke:consumer: ${problem}`);
  }
  if (all.length > 0) {
    process.exitCode = 1;
  } else {
    console.log(`smoke:consumer: ok (extracted tarball outside the repository; exports resolve; server render ok; ${summary})`);
  }
} finally {
  await Bun.$`rm -rf ${work}`;
}
