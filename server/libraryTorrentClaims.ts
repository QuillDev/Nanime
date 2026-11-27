import { randomUUID } from "node:crypto";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { database, db, execute, type LibraryTorrentAdditionRow, LibraryTorrentAdditionRowSchema, queryRows } from "./database.ts";
import { jsonObject } from "./json.ts";
import { claimLibraryPaths, retainTorrentOwnership } from "./libraryWriters.ts";
import type { TorrentPayload } from "./torrents.ts";

interface OwnedPath { readonly hash: string; readonly path: string }
interface Addition extends LibraryTorrentAdditionRow {
  ownedPaths: readonly OwnedPath[];
  release: () => void;
  observedAt: number;
}

// Unknown POST outcomes survive restart: only a tagged ownership observation
// may turn a broad pending reservation into individual payload ownership.
database.run(`CREATE TABLE IF NOT EXISTS library_torrent_additions (
  tag TEXT PRIMARY KEY, root TEXT NOT NULL, scope TEXT NOT NULL, owned TEXT NOT NULL
)`);
const additions = new Map<string, Addition>();
for (const row of queryRows(db.selectFrom("library_torrent_additions").selectAll(), LibraryTorrentAdditionRowSchema)) {
  const ownedPaths = JSON.parse(row.owned) as readonly OwnedPath[];
  const release = ownedPaths.length === 0
    ? claimLibraryPaths([row.scope], true) : retainTorrentOwnership(ownedPaths.map((entry) => entry.path));
  additions.set(row.tag, { ...row, ownedPaths, release, observedAt: 0 });
}
let sequence = 0;
export function torrentOwnershipRead(): number { return ++sequence; }

export function reserveTorrentAddition(root: string, scope: string): string {
  const release = claimLibraryPaths([scope], true);
  const tag = `nanime-${randomUUID()}`;
  try {
    execute(db.insertInto("library_torrent_additions").values({ tag, root: resolve(root), scope, owned: "[]" }));
    additions.set(tag, { tag, root: resolve(root), scope, owned: "[]", ownedPaths: [], release, observedAt: 0 });
    return tag;
  } catch (error) { release(); throw error; }
}

export function canonicalizeTorrentAdditionRoot(tag: string, root: string): void {
  const addition = additions.get(tag);
  if (addition !== undefined) {
    execute(db.updateTable("library_torrent_additions").set({ root }).where("tag", "=", tag));
    additions.set(tag, { ...addition, root });
  }
}

export function forgetTorrentAddition(tag: string): void {
  execute(db.deleteFrom("library_torrent_additions").where("tag", "=", tag));
  additions.get(tag)?.release();
  additions.delete(tag);
}

/** True while a torrent addition still holds its broad pending reservation. */
export function hasPendingTorrentAdditions(): boolean {
  return [...additions.values()].some((addition) => addition.ownedPaths.length === 0);
}

export function torrentAdditionObserved(tag: string): boolean {
  return (additions.get(tag)?.ownedPaths.length ?? 0) > 0;
}

function ownedPathsFor(addition: Addition, payloads: readonly TorrentPayload[], raw: readonly unknown[]): readonly OwnedPath[] {
  return payloads.flatMap((payload, index) => {
    const tags = jsonObject(raw[index])?.["tags"];
    const tagged = typeof tags === "string" && tags.split(",").some((tag) => tag.trim() === addition.tag);
    if (!tagged && !addition.ownedPaths.some((entry) => entry.hash === payload.hash)) {
      return [];
    }
    const path = relative(addition.root, payload.contentPath).split(sep).join("/");
    // Unexpected ownership stays broad and fail-closed rather than escaping.
    return [{ hash: payload.hash, path: isAbsolute(path) || path === ".." || path.startsWith("../") ? addition.scope : path }];
  });
}

export function refreshTorrentAdditions(payloads: readonly TorrentPayload[], raw: readonly unknown[], read: number): void {
  for (const addition of additions.values()) {
    if (read < addition.observedAt) {
      continue;
    }
    const ownedPaths = ownedPathsFor(addition, payloads, raw);
    if (ownedPaths.length === 0) {
      if (addition.ownedPaths.length > 0) {
        forgetTorrentAddition(addition.tag);
      }
      continue;
    }
    if (JSON.stringify(ownedPaths) === JSON.stringify(addition.ownedPaths)) {
      addition.observedAt = read;
      continue;
    }
    execute(db.updateTable("library_torrent_additions").set({ owned: JSON.stringify(ownedPaths) }).where("tag", "=", addition.tag));
    // No await between releasing the pending scope and retaining payload locks.
    addition.release();
    addition.release = retainTorrentOwnership(ownedPaths.map((entry) => entry.path));
    addition.ownedPaths = ownedPaths;
    addition.observedAt = read;
  }
}

/** Pending scopes appear in readonly listings as well as in the claim gate. */
export function pendingTorrentPayloads(): readonly TorrentPayload[] {
  return [...additions.values()].flatMap((addition) => addition.ownedPaths.length === 0 ? [{
    hash: addition.tag, name: "Pending torrent addition", contentPath: resolve(addition.root, addition.scope),
    progress: 0, state: "adding",
  }] : []);
}
