import { resolve } from "node:path";
import { database } from "./database.ts";
import {
  matchRef,
  readFolderMetadata,
  slotsForKey,
  writeFolderMatches,
  type FolderMatch,
  type MatchUpdate,
  type MetadataSlot,
} from "./folderMetadata.ts";
import { jsonObject } from "./json.ts";
import { mediaFromUnknown } from "./metadataPayload.ts";
import type { AnimeMetadata } from "./metadataTypes.ts";

const selectCached = database.query<{ readonly payload: string }, [string]>("SELECT payload FROM metadata_cache WHERE ref = ?");
const upsertCached = database.query<void, [string, string, number]>(`
  INSERT INTO metadata_cache (ref, payload, updated_at) VALUES (?, ?, ?)
  ON CONFLICT(ref) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at
`);
const MAX_PARSED_CACHE = 2000;
const BATCH_CHUNK_SIZE = 500;
const parsedCache = new Map<string, { readonly raw: string; readonly media: AnimeMetadata | undefined }>();

function decodeCachedRow(ref: string, raw: string): AnimeMetadata | undefined {
  const existing = parsedCache.get(ref);
  if (existing?.raw === raw) {
    return existing.media;
  }
  const media = mediaFromUnknown(JSON.parse(raw)) ?? undefined;
  parsedCache.delete(ref);
  parsedCache.set(ref, { raw, media });
  while (parsedCache.size > MAX_PARSED_CACHE) {
    const oldest = parsedCache.keys().next().value as string | undefined;
    if (oldest === undefined) {
      return media;
    }
    parsedCache.delete(oldest);
  }
  return media;
}

export function cachedMetadata(ref: string): AnimeMetadata | undefined {
  const row = selectCached.get(ref);
  return row === null ? undefined : decodeCachedRow(ref, row.payload);
}

/** Loads many cached metadata entries in batched SQLite queries, reusing parsed payloads when raw JSON matches. */
export function cachedMetadataBatch(refs: readonly string[]): ReadonlyMap<string, AnimeMetadata> {
  const unique = [...new Set(refs)];
  const result = new Map<string, AnimeMetadata>();
  for (let offset = 0; offset < unique.length; offset += BATCH_CHUNK_SIZE) {
    const chunk = unique.slice(offset, offset + BATCH_CHUNK_SIZE);
    const placeholders = chunk.map(() => "?").join(", ");
    const rows = database
      .query<{ readonly ref: string; readonly payload: string }, string[]>(
        `SELECT ref, payload FROM metadata_cache WHERE ref IN (${placeholders})`,
      )
      .all(...chunk);
    for (const row of rows) {
      const media = decodeCachedRow(row.ref, row.payload);
      if (media !== undefined) {
        result.set(row.ref, media);
      }
    }
  }
  return result;
}

export function storeCachedMetadata(ref: string, media: AnimeMetadata): void {
  upsertCached.run(ref, JSON.stringify(media), Date.now());
  parsedCache.delete(ref);
}

/** The match a payload stored under the old key-addressed scheme stands for. */
export function matchFromMedia(media: AnimeMetadata): FolderMatch {
  return { provider: "anilist", id: media.id };
}

const LEGACY_METADATA_FILE = resolve(
  process.env["MEDIA_METADATA_FILE"] ?? resolve(import.meta.dir, "..", ".media-metadata.json"),
);
const legacyRows = database.query<{ readonly key: string; readonly payload: string }, []>("SELECT key, payload FROM media_metadata");
const migrationDone = database.query<{ readonly id: number }, []>("SELECT id FROM metadata_files_migration");
const markMigrated = database.query<void, [number]>("INSERT OR IGNORE INTO metadata_files_migration (id, migrated_at) VALUES (1, ?)");

function parsedEntries(entries: readonly (readonly [string, unknown])[]): readonly (readonly [string, AnimeMetadata])[] {
  return entries.flatMap(([key, value]) => {
    const media = mediaFromUnknown(value);
    return media === null ? [] : [[key, media] as const];
  });
}

/** The pre-file mappings: SQLite rows, or the JSON file that predates them. */
async function legacyMappings(): Promise<readonly (readonly [string, AnimeMetadata])[]> {
  const rows = legacyRows.all();
  if (rows.length > 0) {
    return parsedEntries(rows.map((row) => [row.key, JSON.parse(row.payload)] as const));
  }
  const file = Bun.file(LEGACY_METADATA_FILE);
  const value: unknown = await file.exists() ? await file.json().catch((): null => null) : null;
  return parsedEntries(Object.entries(jsonObject(value) ?? {}));
}

interface PlannedMigration {
  readonly updates: readonly MatchUpdate[];
  readonly cached: readonly (readonly [string, AnimeMetadata])[];
  readonly unplaced: readonly string[];
}

function planMigration(root: string, slots: readonly MetadataSlot[], mappings: readonly (readonly [string, AnimeMetadata])[]): PlannedMigration {
  const placed = mappings.map(([key, media]) => ({ key, media, match: matchFromMedia(media), targets: slotsForKey(slots, key) }));
  // A folder that already has a file keeps what it says.
  const open = (slot: MetadataSlot): boolean => readFolderMetadata(root, slot.folder)[slot.role] === undefined;
  return {
    updates: placed.flatMap(({ match, targets }) => targets.filter((slot) => open(slot)).map((slot) => ({ folder: slot.folder, role: slot.role, match }))),
    cached: placed.flatMap(({ media, match, targets }) => targets.map((slot) => [matchRef(slot.role, match), media] as const)),
    unplaced: placed.filter(({ targets }) => targets.length === 0).map(({ key }) => key),
  };
}

const commitMigration = database.transaction((root: string, plan: PlannedMigration) => {
  for (const [ref, media] of plan.cached) {
    storeCachedMetadata(ref, media);
  }
  markMigrated.run(Date.now());
  writeFolderMatches(root, plan.updates);
});

/**
 * Writes each stored mapping into the nanime.json of the folders its key
 * resolves to, once. It waits for a library with videos in it, so an
 * unmounted media directory can't mark the migration done with nothing
 * placed. The old rows stay in media_metadata untouched.
 */
export async function migrateLegacyMetadata(root: string, slots: readonly MetadataSlot[]): Promise<void> {
  if (slots.length === 0 || migrationDone.get() !== null) {
    return;
  }
  const plan = planMigration(root, slots, await legacyMappings());
  commitMigration(root, plan);
  const folders = new Set(plan.updates.map((update) => update.folder));
  console.log(`Moved ${String(plan.cached.length)} metadata mappings into ${String(folders.size)} nanime.json files`);
  if (plan.unplaced.length > 0) {
    console.warn(`No library folder for metadata mappings: ${plan.unplaced.join(", ")}`);
  }
}
