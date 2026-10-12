import { isAbsolute, relative, sep } from "node:path";
import type { LibraryFileLock, TorrentOwnershipState } from "../shared/libraryFiles.ts";
import { database } from "./database.ts";
import { isInternalName, isSameOrInside } from "./libraryPaths.ts";
import type { TorrentOwnership, TorrentPayload } from "./torrents.ts";
import { durableRecoveryPaths, RECOVERY_LOCK } from "./libraryRecoveryScopes.ts";
import { activeTranscodeWorkerPaths } from "./libraryWriters.ts";

export interface PathLock {
  readonly path: string;
  readonly lock: LibraryFileLock;
}

export interface LockState {
  readonly global: LibraryFileLock | null;
  readonly paths: readonly PathLock[];
  readonly ownership: TorrentOwnershipState;
}

export interface LockSources {
  /** Absolute spellings of the library root that external tools may report. */
  readonly roots: readonly string[];
  readonly torrents: () => Promise<TorrentOwnership>;
  readonly uploads: () => readonly string[];
}

interface SourceRow {
  readonly source_rel: string;
}

const activeTranscodes = database.query<SourceRow, []>(
  "SELECT source_rel FROM transcode_jobs WHERE status IN ('queued', 'processing')",
);
const activeOfflinePreparation = database.query<SourceRow, []>(
  "SELECT source_rel FROM offline_media_artifacts WHERE status IN ('queued', 'preparing')",
);
const TORRENT_UNAVAILABLE: LibraryFileLock = {
  source: "torrent-unavailable",
  reason: "qBittorrent can't be reached, so torrent-owned files can't be identified. Renames, moves and deletes are paused until it responds.",
  tone: "locked",
};

/** Library-relative form of an absolute path, or null when it lies elsewhere. */
export function libraryRelative(roots: readonly string[], abs: string): string | null {
  for (const root of roots) {
    const rel = relative(root, abs);
    if (rel === "") {
      return "";
    }
    // "..Special" is a valid name inside the root; only ".." itself or "../…" leaves it.
    if (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)) {
      return rel.split(sep).join("/");
    }
  }
  return null;
}

function torrentLock(payload: TorrentPayload): LibraryFileLock {
  if (payload.progress < 1) {
    const percent = Math.floor(Math.max(0, payload.progress) * 100);
    return {
      source: "torrent",
      reason: `Downloading in qBittorrent (${String(percent)}%). Wait until it finishes.`,
      tone: "busy",
    };
  }
  return {
    source: "torrent",
    reason: `Owned by the qBittorrent torrent “${payload.name}”. Moving it would break seeding; remove the torrent in Downloads first.`,
    tone: "locked",
  };
}

interface TorrentLocks {
  readonly paths: readonly PathLock[];
  readonly global: LibraryFileLock | null;
}

function torrentLocks(roots: readonly string[], ownership: TorrentOwnership): TorrentLocks {
  if (ownership.state === "unconfigured") {
    return { paths: [], global: null };
  }
  if (ownership.state === "unavailable") {
    return { paths: [], global: TORRENT_UNAVAILABLE };
  }
  const paths: PathLock[] = [];
  let global: LibraryFileLock | null = null;
  for (const payload of ownership.payloads) {
    const path = libraryRelative(roots, payload.contentPath);
    if (path === "") {
      global = torrentLock(payload);
    } else if (path !== null && !path.split("/").some((segment) => isInternalName(segment))) {
      paths.push({ path, lock: torrentLock(payload) });
    }
  }
  return { paths, global };
}

function jobLocks(): PathLock[] {
  const transcodePaths = new Set([...activeTranscodes.all().map((row) => row.source_rel), ...activeTranscodeWorkerPaths()]);
  const transcodes = [...transcodePaths].map((path): PathLock => ({
    path,
    lock: { source: "transcode", reason: "A transcode is reading this video or finishing cleanup. Wait for its worker to finish.", tone: "busy" },
  }));
  const offline = activeOfflinePreparation.all().map((row): PathLock => ({
    path: row.source_rel,
    lock: { source: "offline", reason: "An offline copy is being prepared from this video.", tone: "busy" },
  }));
  return [...transcodes, ...offline];
}

function recoveryLocks(): PathLock[] {
  return durableRecoveryPaths().map((path) => ({ path, lock: RECOVERY_LOCK }));
}

/**
 * Locks Nanime itself holds: jobs, uploads, and unrecovered operations. Read
 * synchronously, so a final check right before a file operation touches the
 * disk can't interleave with another writer claiming a path.
 */
export function localLocks(sources: Pick<LockSources, "uploads">): readonly PathLock[] {
  const uploads = sources.uploads().map((path): PathLock => ({
    path,
    lock: { source: "upload", reason: "An upload into this location is still in progress.", tone: "busy" },
  }));
  return [...jobLocks(), ...uploads, ...recoveryLocks()];
}

export async function currentLocks(sources: LockSources): Promise<LockState> {
  const ownership = await sources.torrents();
  const torrents = torrentLocks(sources.roots, ownership);
  return {
    global: torrents.global,
    paths: [...torrents.paths, ...localLocks(sources)],
    ownership: ownership.state,
  };
}

/** The lock on an entry itself: it is locked, or lies inside a locked payload. */
export function entryLock(state: LockState, path: string): LibraryFileLock | null {
  return state.global ?? state.paths.find((candidate) => (candidate.path === "" || isSameOrInside(path, candidate.path)))?.lock ?? null;
}

/** A lock that changing `path` would violate, including locks on anything inside it. */
export function lockAffecting(state: LockState, path: string): PathLock | null {
  if (state.global !== null) {
    return { path, lock: state.global };
  }
  return state.paths.find((candidate) => candidate.path === "" || path === "" || isSameOrInside(path, candidate.path) || isSameOrInside(candidate.path, path)) ?? null;
}
