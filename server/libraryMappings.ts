import { extname } from "node:path";
import type { LibraryMappingMovement } from "../shared/libraryFiles.ts";
import { database } from "./database.ts";
import { baseName, hasInternalSegment, LibraryFileError, parentPath } from "./libraryPaths.ts";
import type { PathMove } from "./libraryRemap.ts";

/**
 * Show and season mappings are keyed by folder names: `show:<show>` for a
 * top-level folder, and `season:<show> / <season>` (or the legacy
 * `<show> / <season>`) for a folder directly inside it. A video uses its
 * season folder's mapping, falling back to its show folder's.
 */

interface PayloadRow {
  readonly payload: string;
}

const metadataPayload = database.query<PayloadRow, [string]>("SELECT payload FROM media_metadata WHERE key = ?");
const metadataKeysLike = database.query<{ readonly key: string }, [string]>(
  "SELECT key FROM media_metadata WHERE substr(key, 1, length(?1)) = ?1",
);
const renameMetadataKey = database.query<void, [string, number, string]>(
  "UPDATE media_metadata SET key = ?, updated_at = ? WHERE key = ?",
);

type KeyKind = "legacy" | "season" | "show";

interface ParsedKey {
  readonly kind: KeyKind;
  /** The library folder the key belongs to. */
  readonly folder: string;
}

/** The AniList (or Jikan) entry a key points at, so equal mappings compare equal. */
function storedIdentity(key: string): string | null {
  const row = metadataPayload.get(key);
  if (row === null) {
    return null;
  }
  try {
    const parsed = JSON.parse(row.payload) as { readonly provider?: unknown; readonly id?: unknown };
    return `${String(parsed.provider ?? "anilist")}:${String(parsed.id)}`;
  } catch {
    return row.payload;
  }
}

function parseKey(key: string): ParsedKey {
  if (key.startsWith("show:")) {
    return { kind: "show", folder: key.slice("show:".length) };
  }
  const season = key.startsWith("season:");
  const [show = "", folder = ""] = (season ? key.slice("season:".length) : key).split(" / ", 2);
  return { kind: season ? "season" : "legacy", folder: `${show}/${folder}` };
}

/** The key a folder at `folder` would use for a mapping of this kind, or null at depths without mappings. */
function keyFor(kind: KeyKind, folder: string): string | null {
  const parts = folder.split("/");
  if (parts.length === 1) {
    return `show:${folder}`;
  }
  if (parts.length !== 2) {
    return null;
  }
  const pair = `${parts[0] ?? ""} / ${parts[1] ?? ""}`;
  return kind === "legacy" ? pair : `season:${pair}`;
}

function existingKeys(keys: readonly string[]): readonly string[] {
  return keys.filter((key) => metadataPayload.get(key) !== null);
}

/** Every mapping key that belongs to `folder` or a folder inside it. */
function keysUnder(folder: string): readonly string[] {
  const parts = folder.split("/");
  if (parts.length === 1) {
    return [
      ...existingKeys([`show:${folder}`]),
      ...metadataKeysLike.all(`season:${folder} / `).map((row) => row.key),
      ...metadataKeysLike.all(`${folder} / `).map((row) => row.key),
    ];
  }
  return parts.length === 2 ? existingKeys([`season:${parts[0] ?? ""} / ${parts[1] ?? ""}`, `${parts[0] ?? ""} / ${parts[1] ?? ""}`]) : [];
}

function label(key: string): string {
  return key.replace(/^(?:show|season):/u, "");
}

function unsupportedMove(move: PathMove, key: string): LibraryFileError {
  return new LibraryFileError(
    409,
    `“${baseName(move.from)}” has an AniList mapping (“${label(key)}”) that can't follow it to “${move.to}”: mappings only exist for show folders and the folders directly inside them. Choose a different destination or remove that mapping first.`,
  );
}

function mappingConflict(key: string): LibraryFileError {
  return new LibraryFileError(409, `A metadata mapping already exists for “${label(key)}”. Rename the folder or remove that mapping first.`);
}

/** Moves never touch Nanime's own folders' keys: trashed folders keep theirs for Undo. */
function visibleMoves(moves: readonly PathMove[]): readonly PathMove[] {
  return moves.filter((move) => !hasInternalSegment(move.from) && !hasInternalSegment(move.to));
}

function carriedKeys(move: PathMove): readonly LibraryMappingMovement[] {
  return keysUnder(move.from).map((key) => {
    const parsed = parseKey(key);
    const target = keyFor(parsed.kind, `${move.to}${parsed.folder.slice(move.from.length)}`);
    if (target === null) {
      throw unsupportedMove(move, key);
    }
    return { from: key, to: target };
  });
}

function rejectCollidingTargets(mappings: readonly LibraryMappingMovement[], arriving: readonly string[]): void {
  const leaving = new Set(mappings.map((mapping) => mapping.from));
  const targets = new Set<string>();
  for (const mapping of mappings) {
    if (targets.has(mapping.to) || (!leaving.has(mapping.to) && metadataPayload.get(mapping.to) !== null)) {
      throw mappingConflict(mapping.to);
    }
    targets.add(mapping.to);
  }
  // A folder arriving where an old mapping is still stored would silently inherit it.
  for (const folder of arriving) {
    const inherited = keysUnder(folder).find((key) => !leaving.has(key) && !targets.has(key));
    if (inherited !== undefined) {
      throw mappingConflict(inherited);
    }
  }
}

type Lookup = (key: string) => string | null;

/** The mapping a video at `path` resolves to: its season folder's, else its show folder's. */
function effectiveMapping(path: string, lookup: Lookup): string | null {
  const [show, season] = (parentPath(path) ?? "").split("/");
  if (show === undefined || show === "") {
    return null;
  }
  const seasonMapping = season === undefined ? null : lookup(`season:${show} / ${season}`) ?? lookup(`${show} / ${season}`);
  return seasonMapping ?? lookup(`show:${show}`);
}

/** The mapping `key` will point at once `mappings` are applied. */
function identityAfter(mappings: readonly LibraryMappingMovement[], key: string): string | null {
  const arriving = mappings.find((mapping) => mapping.to === key);
  if (arriving !== undefined) {
    return storedIdentity(arriving.from);
  }
  return mappings.some((mapping) => mapping.from === key) ? null : storedIdentity(key);
}

function rejectRemappedVideos(input: MappingInput, mappings: readonly LibraryMappingMovement[]): void {
  const after: Lookup = (key) => identityAfter(mappings, key);
  for (const file of input.files) {
    if (!input.videoExtensions.has(extname(file.from).toLowerCase()) || hasInternalSegment(file.from) || hasInternalSegment(file.to)) {
      continue;
    }
    const before = effectiveMapping(file.from, storedIdentity);
    if (before !== null && effectiveMapping(file.to, after) !== before) {
      throw new LibraryFileError(
        409,
        `Moving “${baseName(file.from)}” to “${parentPath(file.to) ?? "the library root"}” would change or drop its AniList mapping. Move it between folders mapped to the same series, or update the mappings first.`,
      );
    }
  }
}

export interface MappingInput {
  readonly moves: readonly PathMove[];
  /** Folders the operation creates. */
  readonly created: readonly string[];
  /** Every file whose path changes, including files inside moved folders. */
  readonly files: readonly { readonly from: string; readonly to: string }[];
  readonly videoExtensions: ReadonlySet<string>;
}

/**
 * The mapping keys an operation carries along. Throws a 409 rather than
 * dropping, orphaning, merging, or silently reassigning any mapping: a folder
 * whose mappings have no key at its destination depth, a destination that
 * already has a mapping, or a video that would resolve to a different series.
 */
export function planMappings(input: MappingInput): readonly LibraryMappingMovement[] {
  const moves = visibleMoves(input.moves);
  const mappings: LibraryMappingMovement[] = [];
  const destinations = [...input.created];
  for (const move of moves) {
    if (move.folder) {
      mappings.push(...carriedKeys(move));
      destinations.push(move.to);
    }
  }
  rejectCollidingTargets(mappings, destinations);
  rejectRemappedVideos(input, mappings);
  return mappings;
}

/** Re-keys mappings; runs inside the commit transaction after `planMappings` re-validated them. */
export function applyMappingMoves(mappings: readonly LibraryMappingMovement[], now: number): void {
  // Two passes through unique temporary keys, so swaps and chains can't collide midway.
  const staged = mappings.map((mapping, index) => ({ ...mapping, temporary: `.nanime-mapping-move/${String(index)}` }));
  for (const mapping of staged) {
    renameMetadataKey.run(mapping.temporary, now, mapping.from);
  }
  for (const mapping of staged) {
    renameMetadataKey.run(mapping.to, now, mapping.temporary);
  }
}
