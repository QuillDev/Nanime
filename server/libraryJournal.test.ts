import { afterAll, expect, test } from "bun:test";
import { link, lstat, mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { entryId } from "./libraryPaths.ts";

const directory = await mkdtemp(join(tmpdir(), "nanime-library-journal-"));

afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

/**
 * Simulates a process that crashed mid-operation: the journal row is pending
 * and the disk holds whatever the interrupted steps had done. A fresh process
 * then runs startup recovery against the same database and library.
 */
async function recoverInFreshProcess(
  name: string,
  steps: readonly object[],
  progress: readonly (object | null)[] | null = null,
): Promise<{ readonly status: string; readonly locks: readonly string[] }> {
  const script = `
    import { database } from "./server/database.ts";
    import { recoverInterruptedOperations } from "./server/libraryJournal.ts";
    import { currentLocks } from "./server/libraryLocks.ts";
    database.query("INSERT INTO library_file_operations (id, kind, status, actor_user_id, actor_username, steps, progress, created_at, updated_at) VALUES (?, 'move', 'pending', 1, 'admin', ?, ?, 1, 1)")
      .run(${JSON.stringify(name)}, ${JSON.stringify(JSON.stringify(steps))}, ${JSON.stringify(progress === null ? null : JSON.stringify(progress))});
    await recoverInterruptedOperations(${JSON.stringify(join(directory, name))});
    const row = database.query("SELECT status FROM library_file_operations WHERE id = ?").get(${JSON.stringify(name)});
    const locks = await currentLocks({ roots: [], torrents: async () => ({ state: "unconfigured" }), uploads: () => [] });
    console.log(JSON.stringify({ status: row.status, locks: locks.paths.map((lock) => lock.path) }));
  `;
  const child = Bun.spawn([process.execPath, "--eval", script], {
    cwd: join(import.meta.dir, ".."),
    env: { ...process.env, NANIME_DATABASE: join(directory, `${name}.sqlite`), NANIME_ADMIN_SETUP_TOKEN: "library-journal-test-setup-token-000001" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect({ code, stderr: stderr.replace(/^Library file operation .* needs manual recovery.*\n/mu, "") }).toEqual({ code: 0, stderr: "" });
  return JSON.parse(stdout) as { readonly status: string; readonly locks: readonly string[] };
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

const DONE = { state: "done", created: null } as const;

test("rolls back a completed step when the crash came before the next one", async () => {
  const root = await library("partial-move", { "Show/Season 1/a.mkv": "a", "Show/Season 1/b.mkv": "b", "Show/Misc/keep.txt": "k" });
  const [a, b] = [await idOf(join(root, "Show/Season 1/a.mkv")), await idOf(join(root, "Show/Season 1/b.mkv"))];
  await rename(join(root, "Show/Season 1/a.mkv"), join(root, "Show/Misc/a.mkv"));
  const result = await recoverInFreshProcess("partial-move", [
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
  const result = await recoverInFreshProcess("half-steps", [
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
  const result = await recoverInFreshProcess("trash", [
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
  const result = await recoverInFreshProcess("ambiguous", [{ kind: "move-file", from: "Show/a.mkv", to: "Target/a.mkv", id: "x" }]);
  expect(result).toEqual({ status: "recovery-required", locks: ["Show/a.mkv", "Target/a.mkv"] });
  expect(await readFile(join(root, "Show/a.mkv"), "utf8")).toBe("original");
  expect(await readFile(join(root, "Target/a.mkv"), "utf8")).toBe("someone else's file");
});
