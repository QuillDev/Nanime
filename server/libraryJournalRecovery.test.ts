import { afterAll, expect, test } from "bun:test";
import { link, lstat, mkdir, mkdtemp, readdir, readFile, rename, rm, rmdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { entryId } from "./libraryPaths.ts";
import type { RunOutcome as Outcome } from "./libraryJournalFaultHarness.ts";
import { runBun, runScript } from "./testProcess.ts";

const directory = await mkdtemp(join(tmpdir(), "nanime-journal-recovery-"));

afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

interface Recovery {
  readonly status: string;
  readonly locks: readonly string[];
}

function childEnvironment(name: string) {
  return { ...process.env, NANIME_DATABASE: join(directory, `${name}.sqlite`), NANIME_ADMIN_SETUP_TOKEN: "journal-recovery-test-setup-token-0001" };
}

/**
 * Starts a fresh process against the same database and library, as Nanime
 * does after a crash. `steps`/`progress` insert the interrupted operation
 * first; omit them to rerun recovery on what is already journaled.
 */
async function startupRecovery(name: string, steps?: readonly object[], progress?: readonly (object | null)[] | null): Promise<Recovery> {
  const insert = steps === undefined ? "" : `
    database.query("INSERT INTO library_file_operations (id, kind, status, actor_user_id, actor_username, steps, progress, created_at, updated_at) VALUES (?, 'move', 'pending', 1, 'admin', ?, ?, 1, 1)")
      .run(${JSON.stringify(name)}, ${JSON.stringify(JSON.stringify(steps))}, ${JSON.stringify(progress === null || progress === undefined ? null : JSON.stringify(progress))});`;
  const script = `
    import { database } from "./server/database.ts";
    import { recoverInterruptedOperations } from "./server/libraryJournal.ts";
    import { currentLocks } from "./server/libraryLocks.ts";
    ${insert}
    await recoverInterruptedOperations(${JSON.stringify(join(directory, name))});
    const row = database.query("SELECT status FROM library_file_operations WHERE id = ?").get(${JSON.stringify(name)});
    const locks = await currentLocks({ roots: [], torrents: async () => ({ state: "unconfigured" }), uploads: () => [] });
    console.log(JSON.stringify({ status: row.status, locks: locks.paths.map((lock) => lock.path) }));
  `;
  const { code, output, error } = await runScript(script, childEnvironment(name));
  expect({ code, error: error.replaceAll(/^Library file operation .* needs manual recovery.*\n/gmu, "") }).toEqual({ code: 0, error: "" });
  return JSON.parse(output) as Recovery;
}

async function library(name: string, files: Readonly<Record<string, string>>): Promise<string> {
  const root = join(directory, name);
  for (const [path, body] of Object.entries(files)) {
    await mkdir(join(root, ...path.split("/").slice(0, -1)), { recursive: true });
    await writeFile(join(root, ...path.split("/")), body);
  }
  return root;
}

async function idOf(abs: string): Promise<string> {
  return entryId(await lstat(abs));
}

async function exists(abs: string): Promise<boolean> {
  return await lstat(abs).then(() => true, () => false);
}

const STARTED = { state: "started", created: null } as const;
const DONE = { state: "done", created: null } as const;

test("rolls back a completed step when the crash came before the next one", async () => {
  const root = await library("partial-move", { "Show/Season 1/a.mkv": "a", "Show/Season 1/b.mkv": "b", "Show/Misc/keep.txt": "k" });
  const [a, b] = [await idOf(join(root, "Show/Season 1/a.mkv")), await idOf(join(root, "Show/Season 1/b.mkv"))];
  await rename(join(root, "Show/Season 1/a.mkv"), join(root, "Show/Misc/a.mkv"));
  const result = await startupRecovery("partial-move", [
    { kind: "move-file", from: "Show/Season 1/a.mkv", to: "Show/Misc/a.mkv", id: a },
    { kind: "move-file", from: "Show/Season 1/b.mkv", to: "Show/Misc/b.mkv", id: b },
  ], [DONE, null]);
  expect(result).toEqual({ status: "rolled-back", locks: [] });
  const season = await readdir(join(root, "Show/Season 1"));
  expect(season.toSorted()).toEqual(["a.mkv", "b.mkv"]);
  expect(await readdir(join(root, "Show/Misc"))).toEqual(["keep.txt"]);
});

test("removes a half-made hard link and an unused folder reservation", async () => {
  const root = await library("half-steps", { "Show/a.mkv": "a", "Show/Folder/inside.mkv": "i", "Target/.keep": "" });
  await link(join(root, "Show/a.mkv"), join(root, "Target/a.mkv"));
  await mkdir(join(root, "Target/Folder"));
  const result = await startupRecovery("half-steps", [
    { kind: "move-file", from: "Show/a.mkv", to: "Target/a.mkv", id: await idOf(join(root, "Show/a.mkv")) },
    { kind: "move-folder", from: "Show/Folder", to: "Target/Folder", id: await idOf(join(root, "Show/Folder")) },
  ], [{ state: "started", created: null }, { state: "started", created: await idOf(join(root, "Target/Folder")) }]);
  expect(result.status).toBe("rolled-back");
  expect(await readdir(join(root, "Target"))).toEqual([".keep"]);
  expect(await readFile(join(root, "Show/a.mkv"), "utf8")).toBe("a");
  expect(await readFile(join(root, "Show/Folder/inside.mkv"), "utf8")).toBe("i");
});

test("restores a folder from an interrupted trash and removes its staging folders", async () => {
  const root = await library("trash", { "Show/Season 1/a.mkv": "a" });
  const season = await idOf(join(root, "Show/Season 1"));
  await mkdir(join(root, ".nanime-trash/op/1"), { recursive: true });
  await rename(join(root, "Show/Season 1"), join(root, ".nanime-trash/op/1/Season 1"));
  const result = await startupRecovery("trash", [
    { kind: "mkdir", from: null, to: ".nanime-trash/op" },
    { kind: "mkdir", from: null, to: ".nanime-trash/op/1" },
    { kind: "move-folder", from: "Show/Season 1", to: ".nanime-trash/op/1/Season 1", id: season },
  ], [
    { state: "done", created: await idOf(join(root, ".nanime-trash/op")) },
    { state: "done", created: await idOf(join(root, ".nanime-trash/op/1")) },
    DONE,
  ]);
  expect(result.status).toBe("rolled-back");
  expect(await readFile(join(root, "Show/Season 1/a.mkv"), "utf8")).toBe("a");
  expect(await readdir(join(root, ".nanime-trash"))).toEqual([]);
});

test("leaves ambiguous state untouched and locks it instead of guessing", async () => {
  const root = await library("ambiguous", { "Show/a.mkv": "original", "Target/a.mkv": "someone else's file" });
  const result = await startupRecovery("ambiguous", [{ kind: "move-file", from: "Show/a.mkv", to: "Target/a.mkv", id: "x" }]);
  expect(result).toEqual({ status: "recovery-required", locks: ["Show/a.mkv", "Target/a.mkv"] });
  expect(await readFile(join(root, "Show/a.mkv"), "utf8")).toBe("original");
  expect(await readFile(join(root, "Target/a.mkv"), "utf8")).toBe("someone else's file");
});

test("never moves an unrelated entry that appeared at the target back to the source", async () => {
  const root = await library("foreign-target", { "Show/a.mkv": "original", "Target/keep.txt": "k" });
  const id = await idOf(join(root, "Show/a.mkv"));
  // Interrupted before the step ran; meanwhile something else took the target and the source vanished.
  // Create the unrelated file first so it cannot reuse the source's freed inode (and so its identity).
  await writeFile(join(root, "Target/a.mkv"), "unrelated file");
  await rm(join(root, "Show/a.mkv"));
  const result = await startupRecovery("foreign-target", [{ kind: "move-file", from: "Show/a.mkv", to: "Target/a.mkv", id }], [STARTED]);
  expect(result).toEqual({ status: "recovery-required", locks: ["Show/a.mkv", "Target/a.mkv"] });
  expect(await exists(join(root, "Show/a.mkv"))).toBe(false);
  expect(await readFile(join(root, "Target/a.mkv"), "utf8")).toBe("unrelated file");
});

test("never removes a directory a step didn't prove it created", async () => {
  const root = await library("unproven-mkdir", { "Show/keep.txt": "k" });
  await mkdir(join(root, "Show/New"));
  // The crash came after the step started; the folder may be someone else's.
  const unproven = await startupRecovery("unproven-mkdir", [{ kind: "mkdir", from: null, to: "Show/New" }], [STARTED]);
  expect(unproven.status).toBe("recovery-required");
  expect(await exists(join(root, "Show/New"))).toBe(true);
  // A legacy row without checkpoints is treated the same way.
  const legacyRoot = await library("legacy-mkdir", { "Show/keep.txt": "k" });
  await mkdir(join(legacyRoot, "Show/New"));
  const legacy = await startupRecovery("legacy-mkdir", [{ kind: "mkdir", from: null, to: "Show/New" }], null);
  expect(legacy.status).toBe("recovery-required");
  expect(await exists(join(legacyRoot, "Show/New"))).toBe(true);
});

test("never removes a created folder that was replaced by another one", async () => {
  const root = await library("replaced-mkdir", { "Show/keep.txt": "k" });
  await mkdir(join(root, "Show/New"));
  const created = await idOf(join(root, "Show/New"));
  await rmdir(join(root, "Show/New"));
  await mkdir(join(root, "Show/Spacer"));
  await mkdir(join(root, "Show/New"));
  expect(await idOf(join(root, "Show/New"))).not.toBe(created);
  const result = await startupRecovery("replaced-mkdir", [{ kind: "mkdir", from: null, to: "Show/New" }], [{ state: "done", created }]);
  expect(result.status).toBe("recovery-required");
  expect(await exists(join(root, "Show/New"))).toBe(true);
});

test("ignores steps that never started, whatever is at their paths", async () => {
  const root = await library("not-started", { "Show/a.mkv": "a", "Show/b.mkv": "b", "Target/b.mkv": "unrelated" });
  const [a, b] = [await idOf(join(root, "Show/a.mkv")), await idOf(join(root, "Show/b.mkv"))];
  await rename(join(root, "Show/a.mkv"), join(root, "Target/a.mkv"));
  const result = await startupRecovery("not-started", [
    { kind: "move-file", from: "Show/a.mkv", to: "Target/a.mkv", id: a },
    { kind: "move-file", from: "Show/b.mkv", to: "Target/b.mkv", id: b },
  ], [DONE, null]);
  expect(result).toEqual({ status: "rolled-back", locks: [] });
  expect(await readFile(join(root, "Show/a.mkv"), "utf8")).toBe("a");
  expect(await readFile(join(root, "Show/b.mkv"), "utf8")).toBe("b");
  expect(await readFile(join(root, "Target/b.mkv"), "utf8")).toBe("unrelated");
});

test("refuses to recover through a folder swapped for a symbolic link", async () => {
  const root = await library("symlink-recovery", { "Show/keep.txt": "k", "Target/a.mkv": "moved" });
  const outside = join(directory, "symlink-recovery-outside");
  await mkdir(outside);
  await writeFile(join(outside, "a.mkv"), "outside file");
  const id = await idOf(join(root, "Target/a.mkv"));
  await rename(join(root, "Target"), join(root, "Target-real"));
  await symlink(outside, join(root, "Target"));
  const result = await startupRecovery("symlink-recovery", [{ kind: "move-file", from: "Show/a.mkv", to: "Target/a.mkv", id }], [DONE]);
  expect(result.status).toBe("recovery-required");
  expect(await readdir(outside)).toEqual(["a.mkv"]);
  expect(await readFile(join(outside, "a.mkv"), "utf8")).toBe("outside file");
  expect(await exists(join(root, "Show/a.mkv"))).toBe(false);
});

test("stays locked until the operator resolves the ambiguity, then rolls back on the next start", async () => {
  const root = await library("operator", { "Show/a.mkv": "a", "Target/keep.txt": "k" });
  const id = await idOf(join(root, "Show/a.mkv"));
  await link(join(root, "Show/a.mkv"), join(root, "Target/a.mkv"));
  await rename(join(root, "Show/a.mkv"), join(root, "Show/a-renamed-by-someone.mkv"));
  const steps = [{ kind: "move-file", from: "Show/a.mkv", to: "Target/a.mkv", id }];
  // Our file is at the target, but the source name is taken... by the same
  // file under another name, so the source path is free: it moves back.
  const recovered = await startupRecovery("operator", steps, [STARTED]);
  expect(recovered.status).toBe("rolled-back");
  expect(await readFile(join(root, "Show/a.mkv"), "utf8")).toBe("a");

  const blockedRoot = await library("operator-blocked", { "Show/a.mkv": "a", "Target/keep.txt": "k" });
  const blockedId = await idOf(join(blockedRoot, "Show/a.mkv"));
  await rename(join(blockedRoot, "Show/a.mkv"), join(blockedRoot, "Target/a.mkv"));
  await writeFile(join(blockedRoot, "Show/a.mkv"), "a new file took the old name");
  const blockedSteps = [{ kind: "move-file", from: "Show/a.mkv", to: "Target/a.mkv", id: blockedId }];
  const blocked = await startupRecovery("operator-blocked", blockedSteps, [DONE]);
  const stillBlocked = await startupRecovery("operator-blocked");
  expect(blocked.status).toBe("recovery-required");
  expect(stillBlocked.status).toBe("recovery-required");
  expect(await readFile(join(blockedRoot, "Show/a.mkv"), "utf8")).toBe("a new file took the old name");
  expect(await readFile(join(blockedRoot, "Target/a.mkv"), "utf8")).toBe("a");
  // The operator moves the newcomer aside; the next start finishes the rollback.
  await rename(join(blockedRoot, "Show/a.mkv"), join(blockedRoot, "Show/newcomer.mkv"));
  expect(await startupRecovery("operator-blocked")).toEqual({ status: "rolled-back", locks: [] });
  expect(await readFile(join(blockedRoot, "Show/a.mkv"), "utf8")).toBe("a");
  expect(await readFile(join(blockedRoot, "Show/newcomer.mkv"), "utf8")).toBe("a new file took the old name");
});


test("rmdir recovery keeps a foreign replacement locked rather than claiming restoration", async () => {
  const name = "rmdir-replacement";
  const root = await library(name, { "keep.txt": "keep" });
  await mkdir(join(root, "Empty"));
  const id = await idOf(join(root, "Empty"));
  await rename(join(root, "Empty"), join(root, "Original"));
  await mkdir(join(root, "Empty"));
  const foreign = await idOf(join(root, "Empty"));
  const result = await startupRecovery(name, [{ kind: "rmdir", from: null, to: "Empty", id }], [DONE]);
  expect(result).toEqual({ status: "recovery-required", locks: ["Empty"] });
  expect(await idOf(join(root, "Empty"))).toBe(foreign);
  expect(await readFile(join(root, "keep.txt"), "utf8")).toBe("keep");
});

for (const kind of ["mkdir", "rmdir"] as const) {
  test(`${kind} recovery never touches a relocated parent outside the root`, async () => {
    const name = `relocated-${kind}`;
    const root = await library(name, { "Parent/keep.txt": "keep" });
    await mkdir(join(root, "Parent/New"));
    const id = await idOf(join(root, "Parent/New"));
    const outside = join(directory, `${name}-outside`);
    await rename(join(root, "Parent"), outside);
    if (kind === "rmdir") {
      await rmdir(join(outside, "New"));
    }
    await symlink(outside, join(root, "Parent"));
    const result = await startupRecovery(name, [{ kind, from: null, to: "Parent/New", id }], [{ state: "done", created: id }]);
    expect(result).toEqual({ status: "recovery-required", locks: ["Parent/New"] });
    expect(await exists(join(outside, "New"))).toBe(kind === "mkdir");
    expect(await readFile(join(outside, "keep.txt"), "utf8")).toBe("keep");
  });
}

test("recovery refuses a library root replaced by a symbolic link", async () => {
  const name = "root-symlink";
  const root = await library(name, { "keep.txt": "keep" });
  await mkdir(join(root, "New"));
  const created = await idOf(join(root, "New"));
  const outside = join(directory, `${name}-outside`);
  await rename(root, outside);
  await symlink(outside, root);
  const result = await startupRecovery(name, [{ kind: "mkdir", from: null, to: "New" }], [{ state: "done", created }]);
  expect(result).toEqual({ status: "recovery-required", locks: ["New"] });
  expect(await exists(join(outside, "New"))).toBe(true);
  expect(await readFile(join(outside, "keep.txt"), "utf8")).toBe("keep");
});

/** Runs one scenario of the fault harness in its own `bun test` process. */
async function faultScenario<T extends { readonly outcome: Outcome }>(scenario: string): Promise<T> {
  const root = join(directory, `fault-${scenario}`);
  await mkdir(root);
  const output = join(directory, `fault-${scenario}.json`);
  const run = await runBun(["test", "./server/libraryJournalFaultHarness.ts"], {
    ...childEnvironment(`fault-${scenario}`), NANIME_FAULT_ROOT: root, NANIME_FAULT_SCENARIO: scenario, NANIME_FAULT_OUT: output,
  });
  expect({ code: run.code, log: run.code === 0 ? "" : `${run.output}\n${run.error}` }).toEqual({ code: 0, log: "" });
  return JSON.parse(await readFile(output, "utf8")) as T;
}

test("post-validation parent substitution cannot publish outside the library", async () => {
  const result = await faultScenario<{ outcome: Outcome; outside: readonly string[]; sentinel: string }>("post-validation-parent");
  expect(result.outside).toEqual(["sentinel"]);
  expect(result.sentinel).toBe("outside");
});

test("post-validation source substitution preserves the foreign inode and contents", async () => {
  const result = await faultScenario<{ outcome: Outcome; foreign: string; foreignId: string; actualId: string; original: string }>("post-link-source");
  expect(result.foreign).toBe("foreign replacement");
  expect(result.actualId).toBe(result.foreignId);
  expect(result.original).toBe("original");
});

test("a refused native file mutation fails closed without an unsafe fallback", async () => {
  const result = await faultScenario<{ outcome: Outcome; source: string; target: readonly string[] }>("link-refused");
  expect(result.outcome.status).toBe(409);
  expect(result.outcome.message).toContain("(EPERM)");
  expect(result.outcome.message).toContain("No unsafe rename fallback");
  expect(result.outcome.rolledBack).toBe(true);
  expect(result.source).toBe("original");
  expect(result.target).toEqual(["keep.txt"]);
});

test("a destination that appears just before the link is never overwritten", async () => {
  const result = await faultScenario<{ outcome: Outcome; source: string; target: string }>("destination-appears");
  expect(result.outcome.status).toBe(409);
  expect(result.outcome.message).toContain("Nothing was overwritten");
  expect(result).toMatchObject({ source: "original", target: "someone else's file" });
});

test("cleanup after a failed move never removes a destination that changed identity", async () => {
  const result = await faultScenario<{ outcome: Outcome; source: string; target: string }>("cleanup-skips-replaced-destination");
  expect(result.outcome.message).toContain("EIO");
  expect(result).toMatchObject({ source: "original", target: "someone else's file" });
});

test("a foreign nonempty folder destination is neither merged into nor removed", async () => {
  const result = await faultScenario<{ outcome: Outcome; source: string; foreign: string }>("reservation-replaced");
  expect(result.outcome.rolledBack).toBe(true);
  expect(result).toMatchObject({ source: "inside", foreign: "foreign" });
});

test("an empty directory arriving at the folder destination is never overwritten", async () => {
  const result = await faultScenario<{ outcome: Outcome; source: string; target: readonly string[]; targetId: string; foreignId: string; keep: string }>("empty-destination-replaced");
  expect(result.outcome.status).toBe(409);
  expect(result.source).toBe("inside");
  expect(result.target).toEqual([]);
  expect(result.targetId).toBe(result.foreignId);
  expect(result.keep).toBe("keep");
});

test("rollback refuses to move back an entry that is no longer the one the step moved", async () => {
  const result = await faultScenario<{ outcome: Outcome; source: readonly string[]; target: readonly string[]; foreign: string }>("undo-refuses-changed-entry");
  expect(result.outcome.rolledBack).toBe(false);
  expect(result.source).toEqual(["b.mkv"]);
  expect(result.target).toEqual(["a-elsewhere.mkv", "a.mkv", "keep.txt"]);
  expect(result.foreign).toBe("someone else's file");
});

test("every step re-checks that its folders are still real folders", async () => {
  const result = await faultScenario<{ outcome: Outcome; source: string; outside: readonly string[] }>("parent-swapped-for-symlink");
  expect(result.outcome.status).toBe(409);
  expect(result.outcome.message).toContain("changed while the operation was running");
  expect(result).toMatchObject({ source: "original", outside: [] });
});

test("two names for one file are a collision, not a case-only rename", async () => {
  const result = await faultScenario<{ outcome: Outcome; names: readonly string[] }>("same-inode-is-not-case-rename");
  expect(result.outcome.status).toBe(409);
  expect(result).toMatchObject({ names: ["a.mkv", "b.mkv"] });
});

test("case-spelled hard links remain a collision with both names unchanged", async () => {
  const result = await faultScenario<{ outcome: Outcome; source: string; target: string; names: readonly string[] }>("case-spelled-hardlink-collision");
  expect(result.outcome.status).toBe(409);
  expect(result).toMatchObject({ source: "original", target: "original", names: ["A.mkv", "a.mkv"] });
});

for (const kind of ["file", "folder", "mkdir", "rmdir"] as const) {
  test(`a final SQLite checkpoint failure restores the current ${kind} step`, async () => {
    const result = await faultScenario<{ outcome: Outcome; status: string; locks: readonly string[]; source: readonly string[]; target: readonly string[]; original: string; inside: string; keep: string }>(`final-checkpoint-${kind}`);
    expect(result.outcome.message).toContain("injected checkpoint failure");
    expect(result.outcome.rolledBack).toBe(true);
    expect(result.status).toBe("rolled-back");
    expect(result.locks).toEqual([]);
    expect(result.source).toEqual(["F", "a.mkv"]);
    expect(result.target).toEqual(kind === "rmdir" ? ["Empty", "keep.txt"] : ["keep.txt"]);
    expect(result).toMatchObject({ original: "original", inside: "inside", keep: "keep" });
  });
}

for (const scenario of ["created-checkpoint-mkdir", "lstat-failure-mkdir", "mkdir-failure", "post-mkdir-failure"] as const) {
  test(`${scenario} reports rollback truthfully without deleting unproven directories`, async () => {
    const result = await faultScenario<{ outcome: Outcome; status: string; locks: readonly string[]; target: readonly string[]; keep: string }>(scenario);
    // Failure occurs in trusted staging, before publication.
    expect(result.outcome.rolledBack).toBe(true);
    expect(result.status).toBe("rolled-back");
    expect(result.locks).toEqual([]);
    expect(result.target).toEqual(["keep.txt"]);
    expect(result.keep).toBe("keep");
  });
}

test("a failing second step restores both its own move and its completed predecessor", async () => {
  const result = await faultScenario<{ outcome: Outcome; status: string; locks: readonly string[]; source: readonly string[]; target: readonly string[]; keep: string }>("second-checkpoint-failure");
  expect(result.outcome.rolledBack).toBe(true);
  expect(result.status).toBe("rolled-back");
  expect(result.locks).toEqual([]);
  expect(result.source).toEqual(["a.mkv", "b.mkv"]);
  expect(result.target).toEqual(["keep.txt"]);
  expect(result.keep).toBe("keep");
});

test("an ambiguous failing current step stays locked and stops predecessor rollback", async () => {
  const result = await faultScenario<{ outcome: Outcome; status: string; locks: readonly string[]; source: readonly string[]; target: readonly string[]; foreign: string; saved: string; keep: string }>("second-checkpoint-replaced");
  expect(result.outcome.rolledBack).toBe(false);
  expect(result.status).toBe("recovery-required");
  expect(result.locks.toSorted()).toEqual(["S/a.mkv", "S/b.mkv", "T/a.mkv", "T/b.mkv"]);
  expect(result.source).toEqual([]);
  expect(result.target).toEqual(["a.mkv", "b.mkv", "keep.txt", "original-b.mkv"]);
  expect(result).toMatchObject({ foreign: "foreign", saved: "b", keep: "keep" });
});

for (const [errno, code] of [[38, "ENOSYS"], [22, "EINVAL"], [95, "ENOTSUP"]] as const) {
  test(`an unsupported atomic folder syscall (${code}) fails closed`, async () => {
    const result = await faultScenario<{ outcome: Outcome; status: string; locks: readonly string[]; source: string; target: readonly string[]; keep: string }>(`atomic-unsupported-${errno}`);
    expect(result.outcome.status).toBe(409);
    expect(result.outcome.rolledBack).toBe(true);
    expect(result.outcome.message).toContain(`(${code})`);
    expect(result.outcome.message).toContain("No unsafe rename fallback");
    expect(result.status).toBe("rolled-back");
    expect(result.locks).toEqual([]);
    expect(result.source).toBe("inside");
    expect(result.target).toEqual(["keep.txt"]);
    expect(result.keep).toBe("keep");
  });
}

test("a captured foreign inode is retained durably when its public name is occupied again", async () => {
  const result = await faultScenario<{ outcome: Outcome; status: string; foreignId: string; capturedId: string; captured: string; public: string; original: string }>("capture-foreign-collision");
  expect(result.outcome.rolledBack).toBe(false);
  expect(result.status).toBe("recovery-required");
  expect(result.capturedId).toBe(result.foreignId);
  expect(result.captured).toBe("captured foreign");
  expect(result.public).toBe("second foreign");
  expect(result.original).toBe("original");
});

test("private journal storage stays outside the downloader-shared library and ignores its internal-name decoys", async () => {
  const result = await faultScenario<{ outcome: Outcome; location: string; root: string; uid: number; expectedUid: number; mode: number; decoy: string; original: string; inside: string[] }>("private-stage-isolation");
  expect(result.outcome.message).toBe("completed");
  expect(result.location.startsWith(`${result.root}/`)).toBe(false);
  expect(result.uid).toBe(result.expectedUid);
  expect(result.mode).toBe(0o700);
  expect(result).toMatchObject({ decoy: "downloader-owned data", original: "original", inside: ["peer.txt"] });
});

for (const boundary of ["boundary", "lateboundary"] as const) {
for (const phase of ["apply", "recovery"] as const) {
  for (const kind of ["file", "folder", "mkdir", "rmdir"] as const) {
    for (const substitution of ["parent", "entry"] as const) {
      test(`${phase} ${kind} preserves outside sentinels and foreign entries at ${boundary} (${substitution})`, async () => {
        const result = await faultScenario<{ outcome: Outcome; status: string; foreignId: string | null; actualId: string | null; foreign: string | null; outside: readonly string[]; sentinel: string }>(`${boundary}-${phase}-${kind}-${substitution}`);
        expect(result.outside).toEqual(["sentinel"]);
        expect(result.sentinel).toBe("outside");
        if (substitution === "parent") {
          expect(result.outcome.message).not.toBe("completed");
          expect(result.status).toBe("recovery-required");
        }
        if (substitution === "entry") {
          expect(result.foreignId).not.toBeNull();
          expect(result.actualId).toBe(result.foreignId);
          if (kind === "file") { expect(result.foreign).toBe("foreign"); }
        }
      });
    }
  }
}
}

for (const [kind, boundary] of [["file", "capture"], ["file", "publication"], ["folder", "capture"], ["folder", "publication"], ["mkdir", "create"], ["mkdir", "publication"], ["rmdir", "capture"], ["file", "recoverycapture"], ["file", "recoverypublication"], ["folder", "recoverycapture"], ["folder", "recoverypublication"], ["mkdir", "recoverycapture"], ["rmdir", "recoverypublication"]] as const) {
  test(`a real process exit after ${kind} ${boundary} recovers the original library on restart`, async () => {
    const scenario = `crash-${kind}-${boundary}`;
    const name = `fault-${scenario}`;
    const root = join(directory, name);
    await mkdir(root);
    const crashed = await runBun(["test", "./server/libraryJournalFaultHarness.ts"], {
      ...childEnvironment(name), NANIME_FAULT_ROOT: root, NANIME_FAULT_SCENARIO: scenario, NANIME_FAULT_OUT: join(directory, `${name}.json`),
    });
    expect(crashed.code).toBe(86);
    // The row's id is the scenario, whereas this fixture/database is prefixed.
    const script = `import { database } from './server/database.ts'; import { recoverInterruptedOperations } from './server/libraryJournal.ts';
      const before = database.query('SELECT progress FROM library_file_operations WHERE id = ?').get(${JSON.stringify(scenario)});
      await recoverInterruptedOperations(${JSON.stringify(root)});
      const row = database.query('SELECT status FROM library_file_operations WHERE id = ?').get(${JSON.stringify(scenario)});
      console.log(JSON.stringify({ status: row.status, progress: JSON.parse(before.progress) }));`;
    const recovery = await runScript(script, childEnvironment(name));
    expect({ code: recovery.code, error: recovery.error }).toEqual({ code: 0, error: "" });
    const row = JSON.parse(recovery.output) as { status: string; progress: readonly { state: string; stage: string; created: string | null }[] };
    expect(row.status).toBe("rolled-back");
    expect(row.progress[0]?.state).toBe(boundary.startsWith("recovery") ? "done" : "started");
    expect(row.progress[0]?.stage).toBeString();
    if (kind === "mkdir" && boundary === "publication") { expect(row.progress[0]?.created).toBeString(); }
    expect(await readFile(join(root, "S/a.mkv"), "utf8")).toBe("original");
    expect(await readFile(join(root, "S/F/inside.mkv"), "utf8")).toBe("inside");
    const names = await readdir(join(root, "T"));
    expect(names.toSorted()).toEqual(kind === "rmdir" ? ["Empty", "keep.txt"] : ["keep.txt"]);
    expect(await readFile(join(root, "T/keep.txt"), "utf8")).toBe("keep");
  });
}
