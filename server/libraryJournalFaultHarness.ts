// Fresh-process fault harness. Hooks run synchronously at real native mutation
// boundaries; all fixture changes and resulting inode/content assertions are real.
import { mock, test } from "bun:test";
import { lstatSync, mkdirSync, readFileSync, readlinkSync, renameSync, symlinkSync, writeFileSync } from "node:fs";
import type { Pointer } from "bun:ffi";
import type { Anchor, AnchoredEntry, JOURNAL_NATIVE_SYMBOLS } from "./libraryJournalNative.ts";
import { link, lstat, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.env["NANIME_FAULT_ROOT"] ?? "";
const scenario = process.env["NANIME_FAULT_SCENARIO"] ?? "";
const output = process.env["NANIME_FAULT_OUT"] ?? "";
const abs = (path: string): string => join(root, ...path.split("/"));
const failure = (code: string): Error => Object.assign(new Error(`${code}: injected failure`), { code });

type Hook = (from: string, to: string) => void;
interface BoundaryHooks { before: Hook | null; after: Hook | null; mkdir: Hook | null; stat: Hook | null; syscall: Hook | null }
const hooks: BoundaryHooks = { before: null, after: null, mkdir: null, stat: null, syscall: null };
if (scenario.startsWith("lateboundary-")) {
  const ffi = await import("bun:ffi");
  const realOpen = ffi.dlopen;
  await mock.module("bun:ffi", () => ({ ...ffi, dlopen: (library: Parameters<typeof ffi.dlopen>[0], symbols: typeof JOURNAL_NATIVE_SYMBOLS) => {
    const loaded = realOpen(library, symbols);
    const symbol = loaded.symbols["renameat2"];
    if (symbol === undefined) { throw new Error("Missing native renameat2"); }

    return { ...loaded, symbols: { ...loaded.symbols, renameat2: (...call: [number, Pointer, number, Pointer, number]) => {
      const [fromFd, fromName, toFd, toName] = call;
      const sourceName = String(new ffi.CString(fromName));
      const targetName = String(new ffi.CString(toName));
      const source = join(readlinkSync(`/proc/self/fd/${fromFd}`), sourceName);
      const target = join(readlinkSync(`/proc/self/fd/${toFd}`), targetName);
      hooks.syscall?.(source, target);
      return symbol(...call);
    } } };
  } }));
}
if (scenario.startsWith("atomic-unsupported-")) {
  const ffi = await import("bun:ffi");
  const errno = new Int32Array([Number(scenario.slice("atomic-unsupported-".length))]);
  await mock.module("bun:ffi", () => ({ ...ffi, dlopen: (...args: Parameters<typeof ffi.dlopen>) => {
    const loaded = ffi.dlopen(...args);
    return { ...loaded, symbols: { ...loaded.symbols, renameat2: () => -1, __errno_location: () => ffi.ptr(errno) } };
  } }));
}
const native = { ...await import("./libraryJournalNative.ts") };
await mock.module("./libraryJournalNative.ts", () => ({
  ...native,
  renameAtNoReplace: (from: AnchoredEntry, to: AnchoredEntry): void => {
    const source = join(from.parent.path, from.name); const target = join(to.parent.path, to.name);
    hooks.before?.(source, target);
    native.renameAtNoReplace(from, to);
    hooks.after?.(source, target);
  },
  mkdirAt: (parent: Anchor, name: string, mode?: number): void => {
    hooks.mkdir?.(join(parent.path, name), ""); native.mkdirAt(parent, name, mode);
    hooks.after?.(join(parent.path, name), join(parent.path, name));
  },
  statsAt: (parent: Anchor, name: string) => {
    hooks.stat?.(join(parent.path, name), ""); return native.statsAt(parent, name);
  },
}));
const journal = await import("./libraryJournal.ts");
const paths = await import("./libraryPaths.ts");
const { database } = await import("./database.ts");
type Step = Parameters<typeof journal.runSteps>[2][number];
export interface RunOutcome { readonly status: number | null; readonly message: string; readonly rolledBack: boolean | null }
async function files(entries: Readonly<Record<string, string>>): Promise<void> {
  for (const [path, body] of Object.entries(entries)) { await mkdir(join(abs(path), ".."), { recursive: true }); await writeFile(abs(path), body); }
}
async function contents(path: string): Promise<string | null> { return await readFile(abs(path), "utf8").catch(() => null); }
async function listing(path: string): Promise<readonly string[] | null> { return await readdir(abs(path)).then((names) => names.toSorted()).catch(() => null); }
async function idOf(path: string): Promise<string> { return paths.entryId(await lstat(abs(path))); }
function syncId(path: string): string { return paths.entryId(lstatSync(abs(path))); }
async function run(steps: readonly Step[]): Promise<RunOutcome> {
  journal.recordPending({ id: scenario, kind: "move", actor: { id: 1, username: "admin" }, steps, revertsOperationId: null });
  try { await journal.runSteps(root, scenario, steps); return { status: null, message: "completed", rolledBack: null }; }
  catch (error) {
    const cause = error instanceof journal.StepFailureError ? error.failure : error;
    journal.markOperation(scenario, error instanceof journal.StepFailureError && error.rolledBack ? "rolled-back" : "recovery-required");
    return { status: cause instanceof paths.LibraryFileError ? cause.status : null, message: cause instanceof Error ? cause.message : String(cause), rolledBack: error instanceof journal.StepFailureError ? error.rolledBack : null };
  }
}
const moveFile = (from: string, to: string, id: string): Step => ({ kind: "move-file", from, to, id });
async function recoveryState() {
  const { currentLocks } = await import("./libraryLocks.ts");
  const locks = await currentLocks({ roots: [], torrents: () => Promise.resolve({ state: "unconfigured" }), uploads: () => [] });
  return { status: journal.storedOperation(scenario)?.status, locks: locks.paths.map((lock) => lock.path) };
}
function rejectProgress(condition: string): void {
  database.run(`CREATE TRIGGER reject_progress BEFORE UPDATE OF progress ON library_file_operations WHEN ${condition} BEGIN SELECT RAISE(ABORT, 'injected checkpoint failure'); END`);
}
async function checkpointStep(kind: Step["kind"]): Promise<Step> {
  if (kind === "mkdir") { return { kind, from: null, to: "T/New" }; }
  if (kind === "rmdir") { await mkdir(abs("T/Empty")); return { kind, from: null, to: "T/Empty", id: await idOf("T/Empty") }; }
  const from = kind === "move-file" ? "S/a.mkv" : "S/F";
  return { kind, from, to: kind === "move-file" ? "T/a.mkv" : "T/F", id: await idOf(from) };
}
async function failedCheckpoint(kind: Step["kind"]) {
  await files({ "S/F/inside.mkv": "inside", "S/a.mkv": "original", "T/keep.txt": "keep" });
  const step = await checkpointStep(kind); rejectProgress(`NEW.progress LIKE '%"done"%'`);
  const outcome = await run([step]);
  return { outcome, ...await recoveryState(), source: await listing("S"), target: await listing("T"), original: await contents("S/a.mkv"), inside: await contents("S/F/inside.mkv"), keep: await contents("T/keep.txt") };
}
async function failedMkdir(mode: "checkpoint" | "lstat" | "mkdir" | "post-mkdir") {
  await files({ "T/keep.txt": "keep" });
  if (mode === "checkpoint") { rejectProgress(`NEW.progress LIKE '%"created":"%'`); }
  if (mode === "lstat") { hooks.stat = (path) => { if (path.includes("/.nanime-journal/")) { hooks.stat = null; throw failure("EIO"); } }; }
  if (mode === "mkdir" || mode === "post-mkdir") {
    hooks.mkdir = (path) => {
      const name = path.slice(path.lastIndexOf("/") + 1);
      if (!/^[\da-f-]{36}$/u.test(name)) { return; }
      hooks.mkdir = null; if (mode === "post-mkdir") { mkdirSync(path); } throw failure("EIO");
    };
  }
  const outcome = await run([{ kind: "mkdir", from: null, to: "T/New" }]);
  return { outcome, ...await recoveryState(), target: await listing("T"), keep: await contents("T/keep.txt") };
}
async function failedSecondCheckpoint(replaced: boolean) {
  await files({ "S/a.mkv": "a", "S/b.mkv": "b", "T/keep.txt": "keep" });
  if (replaced) {
    hooks.after = (_from, to) => { if (to === abs("T/b.mkv")) { hooks.after = null; renameSync(to, abs("T/original-b.mkv")); writeFileSync(to, "foreign"); throw failure("EIO"); } };
  } else { rejectProgress(`json_extract(NEW.progress, '$[1].state') = 'done'`); }
  const outcome = await run([moveFile("S/a.mkv", "T/a.mkv", await idOf("S/a.mkv")), moveFile("S/b.mkv", "T/b.mkv", await idOf("S/b.mkv"))]);
  return { outcome, ...await recoveryState(), source: await listing("S"), target: await listing("T"), foreign: await contents("T/b.mkv"), saved: await contents("T/original-b.mkv"), keep: await contents("T/keep.txt") };
}
async function unsupportedFolder() {
  await files({ "S/F/inside.mkv": "inside", "T/keep.txt": "keep" });
  const outcome = await run([{ kind: "move-folder", from: "S/F", to: "T/F", id: await idOf("S/F") }]);
  return { outcome, ...await recoveryState(), source: await contents("S/F/inside.mkv"), target: await listing("T"), keep: await contents("T/keep.txt") };
}
async function destinationFolder(empty: boolean) {
  await files({ "S/F/inside.mkv": "inside", "T/keep.txt": "keep" });
  let foreignId: string | null = null;
  hooks.before = (_from, to) => { if (to === abs("T/F")) { hooks.before = null; mkdirSync(to); foreignId = syncId("T/F"); if (!empty) { writeFileSync(join(to, "foreign.txt"), "foreign"); } } };
  const outcome = await run([{ kind: "move-folder", from: "S/F", to: "T/F", id: await idOf("S/F") }]);
  return { outcome, source: await contents("S/F/inside.mkv"), foreign: await contents("T/F/foreign.txt"), target: await listing("T/F"), foreignId, targetId: await idOf("T/F"), keep: await contents("T/keep.txt") };
}
async function parentBoundary() {
  const [outside] = await Promise.all([outsideSentinel(), files({ "S/a.mkv": "original", "T/keep.txt": "keep" })]);
  hooks.before = (_from, to) => { if (to === abs("T/a.mkv")) { hooks.before = null; renameSync(abs("T"), abs("T-real")); symlinkSync(outside, abs("T")); } };
  const outcome = await run([moveFile("S/a.mkv", "T/a.mkv", await idOf("S/a.mkv"))]);
  return { ...await outsideAfterOutcome(outside, outcome), source: await contents("S/a.mkv"), sentinel: await readFile(join(outside, "sentinel"), "utf8") };
}
async function sourceBoundary() {
  await files({ "S/a.mkv": "original", "T/keep.txt": "keep" });
  let foreignId: string | null = null;
  hooks.before = (from) => { if (from === abs("S/a.mkv")) { hooks.before = null; renameSync(from, abs("S/original.mkv")); writeFileSync(from, "foreign replacement"); foreignId = syncId("S/a.mkv"); } };
  const outcome = await run([moveFile("S/a.mkv", "T/a.mkv", await idOf("S/a.mkv"))]);
  return { outcome, foreign: await contents("S/a.mkv"), foreignId, actualId: await idOf("S/a.mkv"), original: await contents("S/original.mkv") };
}
const scenarios = {
  "private-stage-isolation": async () => {
    await mkdir(abs(".nanime-journal"), { mode: 0o700 });
    await files({ "S/a.mkv": "original", "T/keep.txt": "keep", ".nanime-journal/peer.txt": "downloader-owned data" });
    const outcome = await run([moveFile("S/a.mkv", "T/a.mkv", await idOf("S/a.mkv"))]);
    const rootAnchor = native.anchorRoot(root);
    let location = "";
    try {
      const stageAnchor = native.privateStage(rootAnchor);
      location = stageAnchor.path;
      native.closeAnchor(stageAnchor);
    } finally { native.closeAnchor(rootAnchor); }
    const stage = await lstat(location);
    return { outcome, location, root, uid: stage.uid, expectedUid: process.getuid?.(), mode: stage.mode & 0o777,
      decoy: await contents(".nanime-journal/peer.txt"), original: await contents("T/a.mkv"), inside: await listing(".nanime-journal") };
  },
  "capture-foreign-collision": async () => {
    await files({ "S/a.mkv": "original", "T/keep.txt": "keep" });
    const originalId = await idOf("S/a.mkv");
    let foreignId: string | null = null;
    hooks.before = (from) => {
      if (from !== abs("S/a.mkv")) { return; }
      hooks.before = null; renameSync(from, abs("S/original.mkv")); writeFileSync(from, "captured foreign"); foreignId = syncId("S/a.mkv");
    };
    hooks.after = (from) => {
      if (from !== abs("S/a.mkv")) { return; }
      hooks.after = null; writeFileSync(from, "second foreign");
    };
    const outcome = await run([moveFile("S/a.mkv", "T/a.mkv", originalId)]);
    const stage = journal.storedOperation(scenario)?.checkpoints[0]?.stage ?? "missing";
    const capturedPath = join(native.journalStageLocation(root), stage);
    await journal.recoverInterruptedOperations(root);
    return { outcome, ...await recoveryState(), foreignId, capturedId: paths.entryId(lstatSync(capturedPath)), captured: readFileSync(capturedPath, "utf8"), public: await contents("S/a.mkv"), original: await contents("S/original.mkv") };
  },
  "post-validation-parent": parentBoundary,
  "post-link-source": sourceBoundary,
  "atomic-unsupported-38": unsupportedFolder,
  "atomic-unsupported-22": unsupportedFolder,
  "atomic-unsupported-95": unsupportedFolder,
  "second-checkpoint-failure": () => failedSecondCheckpoint(false),
  "second-checkpoint-replaced": () => failedSecondCheckpoint(true),
  "final-checkpoint-file": () => failedCheckpoint("move-file"),
  "final-checkpoint-folder": () => failedCheckpoint("move-folder"),
  "final-checkpoint-mkdir": () => failedCheckpoint("mkdir"),
  "final-checkpoint-rmdir": () => failedCheckpoint("rmdir"),
  "created-checkpoint-mkdir": () => failedMkdir("checkpoint"),
  "lstat-failure-mkdir": () => failedMkdir("lstat"),
  "mkdir-failure": () => failedMkdir("mkdir"),
  "post-mkdir-failure": () => failedMkdir("post-mkdir"),
  "link-refused": async () => {
    await files({ "S/a.mkv": "original", "T/keep.txt": "keep" });
    hooks.before = () => { hooks.before = null; throw Object.assign(new paths.LibraryFileError(409, "Native mutation failed (EPERM). No unsafe rename fallback was attempted."), { code: "EPERM" }); };
    const outcome = await run([moveFile("S/a.mkv", "T/a.mkv", await idOf("S/a.mkv"))]);
    return { outcome, renames: 0, source: await contents("S/a.mkv"), target: await listing("T") };
  },
  "destination-appears": async () => {
    await files({ "S/a.mkv": "original", "T/keep.txt": "keep" });
    hooks.before = (_from, to) => { if (to === abs("T/a.mkv")) { hooks.before = null; writeFileSync(to, "someone else's file"); } };
    const outcome = await run([moveFile("S/a.mkv", "T/a.mkv", await idOf("S/a.mkv"))]);
    return { outcome, renames: 0, source: await contents("S/a.mkv"), target: await contents("T/a.mkv") };
  },
  "cleanup-skips-replaced-destination": async () => {
    await files({ "S/a.mkv": "original", "T/keep.txt": "keep" });
    hooks.after = (_from, to) => { if (to === abs("T/a.mkv")) { hooks.after = null; renameSync(to, abs("T/moved-away.mkv")); writeFileSync(to, "someone else's file"); writeFileSync(abs("S/a.mkv"), "original"); throw failure("EIO"); } };
    const outcome = await run([moveFile("S/a.mkv", "T/a.mkv", await idOf("S/a.mkv"))]);
    return { outcome, source: await contents("S/a.mkv"), target: await contents("T/a.mkv") };
  },
  "reservation-replaced": () => destinationFolder(false),
  "empty-destination-replaced": () => destinationFolder(true),
  "undo-refuses-changed-entry": async () => {
    await files({ "S/a.mkv": "a", "S/b.mkv": "b", "T/keep.txt": "keep" });
    const steps = [moveFile("S/a.mkv", "T/a.mkv", await idOf("S/a.mkv")), moveFile("S/b.mkv", "T/b.mkv", await idOf("S/b.mkv"))];
    hooks.before = (from) => { if (from === abs("S/b.mkv")) { hooks.before = null; renameSync(abs("T/a.mkv"), abs("T/a-elsewhere.mkv")); writeFileSync(abs("T/a.mkv"), "someone else's file"); throw failure("EIO"); } };
    const outcome = await run(steps);
    return { outcome, source: await listing("S"), target: await listing("T"), foreign: await contents("T/a.mkv") };
  },
  "parent-swapped-for-symlink": async () => {
    await files({ "S/a.mkv": "original", "T/keep.txt": "keep" });
    const outside = join(root, "..", `${scenario}-outside`); await mkdir(outside); const id = await idOf("S/a.mkv");
    renameSync(abs("T"), abs("T-real")); symlinkSync(outside, abs("T"));
    const outcome = await run([moveFile("S/a.mkv", "T/a.mkv", id)]);
    return { outcome, source: await contents("S/a.mkv"), outside: await readdir(outside) };
  },
  "same-inode-is-not-case-rename": async () => {
    await files({ "S/a.mkv": "original" }); await link(abs("S/a.mkv"), abs("S/b.mkv"));
    const outcome = await run([moveFile("S/a.mkv", "S/b.mkv", await idOf("S/a.mkv"))]);
    return { outcome, renames: 0, names: await listing("S") };
  },
  "case-spelled-hardlink-collision": async () => {
    await files({ "S/a.mkv": "original" }); await link(abs("S/a.mkv"), abs("S/A.mkv"));
    const outcome = await run([moveFile("S/a.mkv", "S/A.mkv", await idOf("S/a.mkv"))]);
    return { outcome, source: await contents("S/a.mkv"), target: await contents("S/A.mkv"), names: await listing("S") };
  },
  checkpoints: async () => {
    await files({ "S/F/inside.mkv": "inside" });
    const outcome = await run([{ kind: "mkdir", from: null, to: "N" }, { kind: "move-folder", from: "S/F", to: "N/F", id: await idOf("S/F") }]);
    const row = database.query<{ readonly progress: string }, [string]>("SELECT progress FROM library_file_operations WHERE id = ?").get(scenario);
    return { outcome, progress: JSON.parse(row?.progress ?? "null") as unknown, created: await idOf("N"), movedId: await idOf("N/F"), moved: await contents("N/F/inside.mkv") };
  },
} satisfies Readonly<Record<string, () => Promise<object>>>;

function boundaryStep(kind: string | undefined, id: string | null): Step {
  if (kind === "file" || kind === "folder") {
    return { kind: kind === "file" ? "move-file" : "move-folder", from: "P/New", to: "Q/New", id: id ?? "" };
  }
  if (kind === "rmdir") { return { kind, from: null, to: "P/New", id: id ?? "" }; }
  return { kind: "mkdir", from: null, to: "P/New" };
}
async function boundaryFixture(phase: string | undefined, kind: string | undefined) {
  await files({ "P/keep.txt": "keep", "Q/keep.txt": "keep" });
  const unpublished = kind === "mkdir" && phase === "apply";
  if (!unpublished) { await (kind === "file" ? writeFile(abs("P/New"), "original") : mkdir(abs("P/New"))); }
  const id = unpublished ? null : await idOf("P/New");
  const step = boundaryStep(kind, id);
  if (phase === "recovery" && step.from !== null) { renameSync(abs("P/New"), abs("Q/New")); }
  if (phase === "recovery" && kind === "rmdir") { renameSync(abs("P/New"), abs("P/removed")); }
  return { id, step, publicAbsent: unpublished || (kind === "rmdir" && phase === "recovery") };
}
interface ForeignEntry { id: string | null; path: string | null }
function installBoundaryHook(options: { outside: string; substitution: string | undefined; directory: boolean; publicAbsent: boolean; late: boolean }): ForeignEntry {
  const foreign: ForeignEntry = { id: null, path: null };
  const substitute: Hook = (from, to) => {
    const publicPath = from.includes("/.nanime-journal/") ? to : from;
    if (!publicPath.endsWith("/New")) { return; }
    hooks.before = null;
    hooks.syscall = null;
    if (options.substitution === "parent") {
      const parent = join(publicPath, ".."); renameSync(parent, `${parent}-saved`); symlinkSync(options.outside, parent);
      return;
    }
    foreign.path = publicPath;
    if (!options.publicAbsent) { renameSync(publicPath, `${publicPath}-original`); }
    if (options.directory) { mkdirSync(publicPath); } else { writeFileSync(publicPath, "foreign"); }
    foreign.id = paths.entryId(lstatSync(publicPath));
  };
  if (options.late) { hooks.syscall = substitute; } else { hooks.before = substitute; }
  return foreign;
}
async function boundaryRecovery(step: Step, created: string | null): Promise<RunOutcome> {
  journal.recordPending({ id: scenario, kind: "move", actor: { id: 1, username: "admin" }, steps: [step], revertsOperationId: null });
  database.query("UPDATE library_file_operations SET progress = ? WHERE id = ?").run(JSON.stringify([{ state: "done", created }]), scenario);
  await journal.recoverInterruptedOperations(root);
  const status = journal.storedOperation(scenario)?.status ?? "";
  return { status: null, message: status, rolledBack: status === "rolled-back" };
}
async function boundaryScenario() {
  const [, phase, kind, substitution] = scenario.split("-");
  const [{ id, step, publicAbsent }, outside] = await Promise.all([boundaryFixture(phase, kind), outsideSentinel()]);
  const directory = kind !== "file";
  const foreign = installBoundaryHook({ outside, substitution, directory, publicAbsent, late: scenario.startsWith("lateboundary-") });
  const created = kind === "rmdir" ? null : id;
  const outcome = await (phase === "recovery" ? boundaryRecovery(step, created) : run([step]));
  return { ...await outsideAfterOutcome(outside, outcome), ...await recoveryState(), foreignId: foreign.id,
    actualId: foreign.path === null ? null : paths.entryId(lstatSync(foreign.path)),
    foreign: foreign.path === null || directory ? null : readFileSync(foreign.path, "utf8"),
    sentinel: await readFile(join(outside, "sentinel"), "utf8"), keep: await contents("Q/keep.txt") };
}
async function outsideAfterOutcome(outside: string, outcome: RunOutcome) {
  // This observation belongs AFTER the completed mutation, not in parallel.
  const names = await readdir(outside);
  return { outcome, outside: names.toSorted() };
}
async function outsideSentinel(): Promise<string> {
  const outside = join(root, "..", `${scenario}-outside`);
  await mkdir(outside); await writeFile(join(outside, "sentinel"), "outside");
  return outside;
}
async function crashScenario() {
  const [, kind, boundary] = scenario.split("-");
  await files({ "S/F/inside.mkv": "inside", "S/a.mkv": "original", "T/keep.txt": "keep" });
  const stepKinds = new Map<string, Step["kind"]>([["file", "move-file"], ["folder", "move-folder"], ["rmdir", "rmdir"], ["mkdir", "mkdir"]]);
  const step = await checkpointStep(stepKinds.get(kind ?? "") ?? "mkdir");
  const recovery = boundary?.startsWith("recovery") === true;
  if (recovery) { await run([step]); }
  hooks.after = (from, to) => {
    const isStageFrom = from.includes("/.nanime-journal/");
    const isStageTo = to.includes("/.nanime-journal/");
    if ((boundary?.endsWith("capture") && !isStageFrom && isStageTo)
      || (boundary?.endsWith("publication") && isStageFrom && !isStageTo)
      || (boundary?.endsWith("create") && isStageFrom && from === to && /^[\da-f-]{36}$/u.test(from.slice(from.lastIndexOf("/") + 1)))) { process.exit(86); }
  };
  if (recovery) { await journal.recoverInterruptedOperations(root); return {}; }
  const outcome = await run([step]);
  return { outcome };
}

test(`journal fault scenario ${scenario}`, async () => {
  const dynamic = new Map<string, () => Promise<object>>([["boundary", boundaryScenario], ["lateboundary", boundaryScenario], ["crash", crashScenario]]);
  const body = dynamic.get(scenario.split("-")[0] ?? "") ?? Object.entries(scenarios).find(([name]) => name === scenario)?.[1];
  if (body === undefined) { throw new Error(`Unknown scenario ${scenario}`); }
  await writeFile(output, JSON.stringify(await body()));
});
