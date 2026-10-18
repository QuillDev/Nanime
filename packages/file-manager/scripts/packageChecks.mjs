// Checks of the emitted package surface, shared by `verify` (the package
// directory) and `smoke:consumer` (a copy extracted from the packed tarball).

const ALLOWED_IMPORTS = new Set(["react", "react-dom", "react/jsx-runtime"]);
const REQUIRED_FILES = ["dist/index.js", "dist/index.d.ts", "dist/styles.css", "dist/types.d.ts", "dist/model.d.ts", "dist/THIRD_PARTY_NOTICES.txt"];
const EXPORTED_FUNCTIONS = ["FileManager", "planMove", "validateRename", "validateName", "validateCreateFolder", "findLock", "applyMove", "sizeColumn", "formatBytes"];
const DECLARED_TYPES = ["FileManagerProps", "FileOperation", "ItemLock", "FileColumn"];

/** Bare specifiers imported by an ES module's source text. */
export function importsOf(source) {
  return [...source.matchAll(/from\s*["'](?<specifier>[^"']+)["']/gu)].map((match) => match.groups?.specifier ?? "");
}

async function missingFiles(dir) {
  const present = await Promise.all(REQUIRED_FILES.map((file) => Bun.file(`${dir}/${file}`).exists()));
  return REQUIRED_FILES.filter((_, index) => !present[index]).map((file) => `missing ${file}`);
}

function bundleProblems(js) {
  const problems = [];
  const foreign = importsOf(js).filter((specifier) => !ALLOWED_IMPORTS.has(specifier));
  if (foreign.length > 0) {
    problems.push(`unexpected imports in dist/index.js: ${foreign.join(", ")}`);
  }
  if (/nanime|\/home\/|server\/|torrent/iu.test(js.replace(/\/\/# sourceMappingURL.*$/mu, ""))) {
    problems.push("dist/index.js mentions host-specific paths");
  }
  return problems;
}

function modelProblems(lib) {
  const index = lib.buildIndex([
    { id: "a", parentId: null, name: "A", kind: "folder" },
    { id: "b", parentId: "a", name: "B", kind: "folder" },
    { id: "c", parentId: null, name: "clip.mkv", kind: "file" },
    { id: "d", parentId: "a", name: "clip.mkv", kind: "file" },
  ]);
  const checks = [
    ["descendant move blocked", lib.planMove(index, ["a"], "b").entries[0]?.issue?.code === "descendant"],
    ["self move blocked", lib.planMove(index, ["a"], "a").entries[0]?.issue?.code === "self"],
    ["collision blocked", lib.planMove(index, ["c"], "a").ok === false],
    ["root move ok", lib.planMove(index, ["d"], "b").ok === true],
    ["extension kept", lib.validateRename(index, "c", "clip.mp4")?.code === "extension-change"],
    ["case-insensitive collision", lib.validateCreateFolder(index, null, "a")?.code === "collision"],
    ["bad name", lib.validateName("a/b")?.code === "invalid-name"],
  ];
  return { count: checks.length, problems: checks.filter(([, ok]) => !ok).map(([label]) => label) };
}

/** Top-level selectors of a stylesheet, without comments and keyframe steps. */
export function selectorsOf(css) {
  const bare = css.replaceAll(/\/\*[\s\S]*?\*\//gu, "");
  const blocks = [...bare.matchAll(/(?:^|\})\s*(?<selector>[^{}@]+)\{/gu)].map((match) => match.groups?.selector.trim() ?? "");
  return blocks.filter((selector) => !/^(?:from|to|\d+%)/u.test(selector));
}

function unscopedSelectors(css) {
  return selectorsOf(css)
    .flatMap((selector) => selector.split(/,(?![^(]*\))/u))
    .map((part) => part.trim())
    .filter((part) => part !== "" && !part.startsWith(".nfm"));
}

async function surfaceProblems(dir) {
  const [lib, dts] = await Promise.all([
    // The package under test is only known at runtime.
    // eslint-disable-next-line react-doctor/no-dynamic-import-path
    import(`${dir}/dist/index.js`),
    Bun.file(`${dir}/dist/index.d.ts`).text(),
  ]);
  const model = modelProblems(lib);
  const problems = [
    ...EXPORTED_FUNCTIONS.filter((name) => typeof lib[name] !== "function").map((name) => `export ${name} missing`),
    ...model.problems,
    // The declaration file is one string, so includes() is a substring search.
    // eslint-disable-next-line react-doctor/js-set-map-lookups
    ...DECLARED_TYPES.filter((name) => !dts.includes(name)).map((name) => `index.d.ts lacks ${name}`),
  ];
  return { count: model.count, problems };
}

/**
 * Verifies a built package directory. Resolves to the problems found and a
 * one-line summary of what passed.
 */
export async function checkPackage(dir) {
  const [missing, js, css, surface] = await Promise.all([
    missingFiles(dir),
    Bun.file(`${dir}/dist/index.js`).text(),
    Bun.file(`${dir}/dist/styles.css`).text(),
    surfaceProblems(dir),
  ]);
  const unscoped = unscopedSelectors(css);
  const problems = [...missing, ...bundleProblems(js), ...surface.problems];
  return {
    problems: unscoped.length > 0 ? [...problems, `unscoped selectors: ${unscoped.join(" | ")}`] : problems,
    summary: `${surface.count} model checks, ${selectorsOf(css).length} scoped selectors, imports: ${[...new Set(importsOf(js))].join(", ")}`,
  };
}
