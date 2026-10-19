import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

/**
 * Probed keyframe times on disk, so a restart or deploy doesn't send the next
 * playlist request back through a full read of the episode (several seconds
 * cold). Entries carry the file's size:mtime signature and are ignored once
 * the file changes.
 */
const STORE_ROOT = resolve(import.meta.dir, "..", ".nanime-cache", "keyframes");

interface StoredKeyframes {
  readonly signature: string;
  readonly keyframes: readonly number[];
}

function entryPath(abs: string): string {
  return join(STORE_ROOT, `${createHash("sha256").update(abs).digest("hex")}.json`);
}

function isStoredKeyframes(value: unknown): value is StoredKeyframes {
  const entry = value as Partial<StoredKeyframes> | null;
  return typeof entry?.signature === "string" && Array.isArray(entry.keyframes) &&
    entry.keyframes.every((time) => typeof time === "number" && Number.isFinite(time));
}

function parseEntry(text: string): StoredKeyframes | null {
  try {
    const entry: unknown = JSON.parse(text);
    return isStoredKeyframes(entry) ? entry : null;
  } catch {
    return null;
  }
}

export async function readStoredKeyframes(abs: string, signature: string): Promise<readonly number[] | null> {
  const text = await readFile(entryPath(abs), "utf8").catch(() => null);
  if (text === null) {
    return null;
  }
  const entry = parseEntry(text);
  return entry?.signature === signature ? entry.keyframes : null;
}

export async function storeKeyframes(abs: string, entry: StoredKeyframes): Promise<void> {
  await mkdir(STORE_ROOT, { recursive: true, mode: 0o700 });
  const path = entryPath(abs);
  await writeFile(`${path}.tmp`, JSON.stringify(entry), { mode: 0o600 });
  await rename(`${path}.tmp`, path);
}
