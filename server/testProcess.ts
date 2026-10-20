/** Test-only support: isolated temporary state and Bun child processes. */
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPOSITORY = join(import.meta.dir, "..");

/** A new private directory under the system temporary root, with symbolic links resolved. */
export async function temporaryDirectory(prefix: string): Promise<string> {
  const created = await mkdtemp(join(tmpdir(), prefix));
  return await realpath(created);
}

export async function withTemporaryDirectory<T>(prefix: string, body: (directory: string) => Promise<T>): Promise<T> {
  const directory = await temporaryDirectory(prefix);
  try {
    return await body(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export type ChildEnvironment = Record<string, string | undefined>;

/**
 * Environment for server modules loaded in a child process: its own database,
 * media root, metadata file and setup token, and no qBittorrent.
 */
export function isolatedEnvironment(directory: string, extra: Readonly<Record<string, string>> = {}) {
  return {
    ...process.env,
    NANIME_DATABASE: join(directory, "test.sqlite"),
    NANIME_ADMIN_SETUP_TOKEN: "isolated-nanime-test-setup-token-0001",
    MEDIA_DIR: join(directory, "media"),
    NANIME_MEDIA_DIR: join(directory, "media"),
    MEDIA_METADATA_FILE: join(directory, "metadata.json"),
    QBITTORRENT_URL: "",
    QBITTORRENT_USERNAME: "",
    QBITTORRENT_PASSWORD: "",
    ...extra,
  };
}

export interface ChildResult {
  readonly code: number;
  readonly output: string;
  readonly error: string;
}

/** Runs Bun with `args` from the repository root and collects its exit code and output. */
export async function runBun(args: readonly string[], env: ChildEnvironment): Promise<ChildResult> {
  const child = Bun.spawn([process.execPath, ...args], { cwd: REPOSITORY, env, stdout: "pipe", stderr: "pipe" });
  const [code, output, error] = await Promise.all([
    child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
  ]);
  return { code, output, error };
}

/** Evaluates a module script (it may import `./server/...` and `bun:test`) in a fresh Bun process. */
export function runScript(script: string, env: ChildEnvironment): Promise<ChildResult> {
  return runBun(["--eval", script], env);
}

/** Runs a scenario harness from `server/` with its arguments. */
export function runHarness(file: string, args: readonly string[], env: ChildEnvironment): Promise<ChildResult> {
  return runBun([join(REPOSITORY, "server", file), ...args], env);
}

/** Polls `probe` until it returns a value, failing with `what` after `timeoutMs`. */
export async function waitUntil<T>(what: string, probe: () => Promise<T | undefined>, timeoutMs = 30_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value !== undefined) {
      return value;
    }
    await Bun.sleep(50);
  }
  throw new Error(`Timed out waiting for ${what}`);
}
