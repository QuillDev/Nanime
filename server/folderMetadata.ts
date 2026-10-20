import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { folderIdentity, pathParts, seasonMetadataKey, showMetadataKey } from "../shared/folderIdentity.ts";
import { jsonObject } from "./json.ts";
import type { MetadataProvider } from "./metadataTypes.ts";

/**
 * Each library folder records what it is in its own `nanime.json`, so a match
 * travels with the folder through renames, moves, trash and Undo, and survives
 * a database reset:
 *
 *   {
 *     "version": 1,
 *     "show": { "provider": "anilist", "id": 108465 },
 *     "season": { "provider": "jikan", "id": 55888, "anilistId": 178789 }
 *   }
 *
 * `show` is the series of every video under a top-level folder and is only
 * read there. `season` is the season of the videos directly inside the folder
 * holding the file. An AniList match may carry `title`, a manual match whose
 * entry isn't fetched; a Jikan match may carry the `anilistId` used for list
 * sync.
 */
export const FOLDER_METADATA_FILE = "nanime.json";
const FORMAT_VERSION = 1;
// The reserved `.nanime-` prefix keeps the half-written file out of scans and the file manager.
const STAGING_FILE = ".nanime-metadata.tmp";

export type MetadataRole = "show" | "season";

type Draft<T> = { -readonly [K in keyof T]: T[K] };

export interface FolderMatch {
  readonly provider: MetadataProvider;
  readonly id: number;
  /** Jikan only: the AniList entry list sync uses, if any. */
  readonly anilistId?: number | null;
  /** AniList only: a manual match's title, used over the provider's. */
  readonly title?: string;
}

export interface FolderMetadata {
  readonly show?: FolderMatch;
  readonly season?: FolderMatch;
}

/** Where one metadata key's match is read from and written to. */
export interface MetadataSlot {
  readonly key: string;
  readonly folder: string;
  readonly role: MetadataRole;
}

function positiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0;
}

function aniListIdField(value: unknown): { readonly anilistId?: number | null } | null {
  if (value === undefined) {
    return {};
  }
  return value === null || positiveInteger(value) ? { anilistId: value } : null;
}

function titleField(value: unknown): { readonly title?: string } | null {
  if (value === undefined) {
    return {};
  }
  return typeof value === "string" && value.trim() !== "" ? { title: value.trim() } : null;
}

function parseMatch(value: unknown): FolderMatch | null {
  const object = jsonObject(value);
  const provider = object?.["provider"];
  const id = object?.["id"];
  if ((provider !== "anilist" && provider !== "jikan") || !positiveInteger(id)) {
    return null;
  }
  const anilistId = provider === "jikan" ? aniListIdField(object?.["anilistId"]) : {};
  // Manual titles stand in for an AniList entry, so only AniList matches take one.
  const title = provider === "anilist" || object?.["title"] === undefined ? titleField(object?.["title"]) : null;
  return anilistId === null || title === null ? null : { provider, id, ...anilistId, ...title };
}

/** A file's matches, or null when it isn't a version 1 metadata file. A malformed match is dropped, not guessed at. */
export function parseFolderMetadata(value: unknown): FolderMetadata | null {
  const object = jsonObject(value);
  if (object?.["version"] !== FORMAT_VERSION) {
    return null;
  }
  const metadata: Draft<FolderMetadata> = {};
  const show = parseMatch(object["show"]);
  const season = parseMatch(object["season"]);
  if (show !== null) {
    metadata.show = show;
  }
  if (season !== null) {
    metadata.season = season;
  }
  return metadata;
}

/** A match as written to disk. */
interface MatchJson {
  provider: MetadataProvider;
  id: number;
  anilistId?: number | null;
  title?: string;
}

/** The match's own fields, in a fixed order, so files stay readable and diffable. */
function matchJson(match: FolderMatch): MatchJson {
  const json: MatchJson = { provider: match.provider, id: match.id };
  if (match.provider === "jikan" && match.anilistId !== undefined) {
    json.anilistId = match.anilistId;
  }
  if (match.title !== undefined) {
    json.title = match.title;
  }
  return json;
}

export function serializeFolderMetadata(metadata: FolderMetadata): string {
  const body: Draft<FolderMetadata> & { readonly version: number } = { version: FORMAT_VERSION };
  if (metadata.show !== undefined) {
    body.show = matchJson(metadata.show);
  }
  if (metadata.season !== undefined) {
    body.season = matchJson(metadata.season);
  }
  return `${JSON.stringify(body, null, 2)}\n`;
}

function folderPath(root: string, folder: string): string {
  return join(root, ...pathParts(folder));
}

const warned = new Set<string>();

function readText(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function parseText(text: string): FolderMetadata | null {
  try {
    return parseFolderMetadata(JSON.parse(text));
  } catch {
    return null;
  }
}

/** The folder's matches; none when the file is missing or unreadable (logged once per folder). */
export function readFolderMetadata(root: string, folder: string): FolderMetadata {
  const text = readText(join(folderPath(root, folder), FOLDER_METADATA_FILE));
  if (text === null) {
    return {};
  }
  const parsed = parseText(text);
  if (parsed === null && !warned.has(folder)) {
    warned.add(folder);
    console.warn(`Ignoring ${FOLDER_METADATA_FILE} in “${folder}”: not a version ${String(FORMAT_VERSION)} metadata file`);
  }
  return parsed ?? {};
}

export interface MatchUpdate {
  readonly folder: string;
  readonly role: MetadataRole;
  readonly match: FolderMatch;
}

/**
 * Writes every update, or (barring a failed rename) none: each folder's new
 * file is staged before any is swapped in. Synchronous so it can run inside
 * the SQLite transaction that records the change.
 */
export function writeFolderMatches(root: string, updates: readonly MatchUpdate[]): void {
  const byFolder = new Map<string, FolderMetadata>();
  for (const update of updates) {
    const current = byFolder.get(update.folder) ?? readFolderMetadata(root, update.folder);
    byFolder.set(update.folder, { ...current, [update.role]: update.match });
  }
  const staged = [...byFolder].map(([folder, metadata]) => {
    const directory = folderPath(root, folder);
    const staging = join(directory, STAGING_FILE);
    writeFileSync(staging, serializeFolderMetadata(metadata));
    return { staging, target: join(directory, FOLDER_METADATA_FILE) };
  });
  try {
    for (const file of staged) {
      renameSync(file.staging, file.target);
    }
  } finally {
    for (const file of staged) {
      rmSync(file.staging, { force: true });
    }
  }
}

/**
 * Every place a match can live for the library's video folders, in a stable
 * order: a show key per top-level folder and a season key per video folder.
 * Folders that parse to the same show share its key, as they share a card.
 */
export function metadataSlots(videoFolders: readonly string[]): readonly MetadataSlot[] {
  const slots = new Map<string, MetadataSlot>();
  for (const folder of [...new Set(videoFolders)].toSorted()) {
    const [top] = pathParts(folder);
    if (top !== undefined) {
      const identity = folderIdentity(folder);
      const show = { key: showMetadataKey(identity.show), folder: top, role: "show" } as const;
      const season = { key: seasonMetadataKey(identity.show, identity.season), folder, role: "season" } as const;
      slots.set(`${show.key}\0${show.folder}`, show);
      slots.set(`${season.key}\0${season.folder}`, season);
    }
  }
  return [...slots.values()];
}

/**
 * The cache key for a match's fetched payload. Show matches carry TVmaze
 * episode data and season matches don't, so the role is part of the ref.
 */
export function matchRef(role: MetadataRole, match: FolderMatch): string {
  const parts = [role, `${match.provider}:${String(match.id)}`];
  if (match.provider === "jikan") {
    parts.push(`anilist:${String(match.anilistId ?? "none")}`);
  }
  if (match.title !== undefined) {
    parts.push(`title:${JSON.stringify(match.title)}`);
  }
  return parts.join("|");
}

/** Accepts the legacy unprefixed `<show> / <season>` season key. */
export function canonicalMetadataKey(key: string): string {
  return key.startsWith("show:") || key.startsWith("season:") ? key : `season:${key}`;
}

export function slotsForKey(slots: readonly MetadataSlot[], key: string): readonly MetadataSlot[] {
  const canonical = canonicalMetadataKey(key);
  return slots.filter((slot) => slot.key === canonical);
}
