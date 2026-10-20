import type { MetadataRefreshStatus } from "../shared/types.ts";
import { aniListGraphQl } from "./anilistClient.ts";
import { jsonObject } from "./json.ts";
import type { AnimeMetadata, MetadataStore } from "./metadataTypes.ts";
import { recordMappingActivity, type ActivityActor } from "./libraryActivity.ts";
import { manualAniListMetadata } from "./manualMetadata.ts";
import { canonicalMetadataKey, matchRef, metadataSlots, readFolderMetadata, slotsForKey, writeFolderMatches, type FolderMatch, type FolderMetadata, type MetadataRole, type MetadataSlot } from "./folderMetadata.ts";
import { cachedMetadata, migrateLegacyMetadata, storeCachedMetadata } from "./metadataCache.ts";

export { aniListErrorResponse } from "./anilistClient.ts";

interface SearchData {
  readonly Page: { readonly media: readonly AnimeMetadata[] };
}

interface MediaData {
  readonly Media: AnimeMetadata;
}

const MEDIA_FIELDS = `
  id idMal
  title { english romaji native }
  description(asHtml: false)
  coverImage { extraLarge large color }
  bannerImage episodes duration season seasonYear startDate { year month day } format status
  genres averageScore siteUrl
  streamingEpisodes { title thumbnail site }
`;

const METADATA_REFRESH_INTERVAL_MS = 2500;
// A match whose payload couldn't be fetched (a hand-written file, a fresh
// database) isn't retried on every library load.
const FAILED_RESOLVE_RETRY_MS = 10 * 60_000;
let refreshStatus: MetadataRefreshStatus = {
  state: "idle",
  total: 0,
  completed: 0,
  failed: 0,
  startedAt: null,
  completedAt: null,
  error: null,
};

/** Where matches live: the library root and the folders that currently hold videos. */
export interface MetadataLibrary {
  readonly root: string;
  readonly videoFolders: () => Promise<readonly string[]>;
}

let library: MetadataLibrary | undefined = undefined;
const resolving = new Map<string, Promise<AnimeMetadata | undefined>>();
const failedUntil = new Map<string, number>();

export function configureMetadataLibrary(configured: MetadataLibrary): void {
  library = configured;
}

function metadataLibrary(): MetadataLibrary {
  if (library === undefined) {
    throw new Error("Metadata library is not configured");
  }
  return library;
}

interface PlacedMatch {
  readonly slot: MetadataSlot;
  readonly match: FolderMatch;
}

async function librarySlots(): Promise<readonly MetadataSlot[]> {
  const { root, videoFolders } = metadataLibrary();
  const slots = metadataSlots(await videoFolders());
  await migrateLegacyMetadata(root, slots);
  return slots;
}

/** Every slot whose folder file holds a match for it, in slot order. */
function placedMatches(slots: readonly MetadataSlot[]): readonly PlacedMatch[] {
  const { root } = metadataLibrary();
  const files = new Map<string, FolderMetadata>();
  return slots.flatMap((slot) => {
    const file = files.get(slot.folder) ?? readFolderMetadata(root, slot.folder);
    files.set(slot.folder, file);
    const match = file[slot.role];
    return match === undefined ? [] : [{ slot, match }];
  });
}

type BaseFetcher = (match: FolderMatch) => Promise<AnimeMetadata | undefined>;

/** Fetches non-manual matches. A manual match keeps `previous`: its AniList entry may not exist. */
function linkBase(previous: AnimeMetadata | undefined): BaseFetcher {
  return (match) => (match.title === undefined ? fetchMedia(match.id) : Promise.resolve(previous));
}

/** A match's payload: AniList's, or a manual title standing in for it. */
async function resolveMatch(match: FolderMatch, options: { readonly base: BaseFetcher }): Promise<AnimeMetadata> {
  const base = await options.base(match);
  if (match.title !== undefined) {
    return manualAniListMetadata(match.id, match.title, base);
  }
  if (base === undefined) {
    throw new Error(`No ${match.provider} payload for ${String(match.id)}`);
  }
  return base;
}

async function resolveUncached(match: FolderMatch, ref: string): Promise<AnimeMetadata | undefined> {
  try {
    const media = await resolveMatch(match, { base: linkBase(undefined) });
    storeCachedMetadata(ref, media);
    return media;
  } catch (error) {
    failedUntil.set(ref, Date.now() + FAILED_RESOLVE_RETRY_MS);
    console.warn(`Could not fetch metadata for ${ref}: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  } finally {
    resolving.delete(ref);
  }
}

async function mediaFor(role: MetadataRole, match: FolderMatch): Promise<AnimeMetadata | undefined> {
  const ref = matchRef(role, match);
  const cached = cachedMetadata(ref);
  if (cached !== undefined) {
    return cached;
  }
  if ((failedUntil.get(ref) ?? 0) > Date.now()) {
    return undefined;
  }
  const pending = resolving.get(ref) ?? resolveUncached(match, ref);
  resolving.set(ref, pending);
  return await pending;
}

/**
 * Built from the folders' nanime.json files on every call, so renames, moves
 * and hand edits show up without any re-keying. Folders that share a key
 * resolve to the first one's match.
 */
async function metadata(): Promise<MetadataStore> {
  const placed = placedMatches(await librarySlots());
  const resolved = await Promise.all(placed.map(async ({ slot, match }) => ({ key: slot.key, media: await mediaFor(slot.role, match) })));
  const store: Record<string, AnimeMetadata> = {};
  for (const { key, media } of resolved) {
    if (store[key] === undefined && media !== undefined) {
      store[key] = media;
    }
  }
  return store;
}

function plainText(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  const result: string[] = [];
  let insideTag = false;
  for (const character of value) {
    if (character === "<") {
      insideTag = true;
      result.push(" ");
    } else if (character === ">") {
      insideTag = false;
    } else if (!insideTag) {
      result.push(character);
    }
  }
  return result.join("").replaceAll(/\s+/gu, " ").trim() || null;
}
function cleanDescription(description: string | null): string | null {
  return plainText(description);
}

function cleanMedia(media: AnimeMetadata): AnimeMetadata {
  return {
    ...media,
    provider: "anilist",
    anilistId: media.id,
    description: cleanDescription(media.description),
  };
}

export async function metadataResponse(): Promise<Response> {
  return Response.json(await metadata());
}

async function fetchMedia(id: number): Promise<AnimeMetadata> {
  const query = `query ($id: Int!) {
    Media(id: $id, type: ANIME) { ${MEDIA_FIELDS} }
  }`;
  const data = await aniListGraphQl<MediaData>({ query, variables: { id } });
  return cleanMedia(data.Media);
}

function updateRefreshStatus(update: Partial<MetadataRefreshStatus>): void {
  refreshStatus = { ...refreshStatus, ...update };
}

/** Each distinct match the library's files point at, once. */
function distinctMatches(placed: readonly PlacedMatch[]): readonly { readonly role: MetadataRole; readonly match: FolderMatch; readonly ref: string }[] {
  const byRef = new Map(placed.map(({ slot, match }) => [matchRef(slot.role, match), { role: slot.role, match }] as const));
  return [...byRef].map(([ref, entry]) => ({ role: entry.role, match: entry.match, ref }));
}

async function pacedFetch(match: FolderMatch): Promise<AnimeMetadata> {
  const media = await fetchMedia(match.id);
  await Bun.sleep(METADATA_REFRESH_INTERVAL_MS);
  return media;
}

/** Fetches each AniList entry once per refresh, pacing requests to stay under its rate limit. */
function refreshBase(): BaseFetcher {
  const fetched = new Map<string, Promise<AnimeMetadata>>();
  return (match) => {
    const key = `${match.provider}:${String(match.id)}`;
    const pending = fetched.get(key) ?? pacedFetch(match);
    fetched.set(key, pending);
    return pending;
  };
}

async function refreshMetadata(): Promise<void> {
  const entries = distinctMatches(placedMatches(await librarySlots()));
  const base = refreshBase();
  updateRefreshStatus({
    state: "running",
    total: entries.length,
    completed: 0,
    failed: 0,
    startedAt: Date.now(),
    completedAt: null,
    error: null,
  });
  for (const entry of entries) {
    try {
      // One match at a time: AniList rate-limits, and refreshBase paces each fetch.
      // eslint-disable-next-line no-await-in-loop, react-doctor/async-await-in-loop
      const media = await resolveMatch(entry.match, { base });
      storeCachedMetadata(entry.ref, media);
      failedUntil.delete(entry.ref);
      updateRefreshStatus({ completed: refreshStatus.completed + 1 });
    } catch (error) {
      updateRefreshStatus({
        completed: refreshStatus.completed + 1,
        failed: refreshStatus.failed + 1,
        error: error instanceof Error ? error.message : "Unknown metadata refresh error",
      });
    }
  }
  updateRefreshStatus({ state: "complete", completedAt: Date.now() });
}

export function metadataRefreshStatusResponse(): Response {
  return Response.json(refreshStatus);
}

export function startMetadataRefreshResponse(): Response {
  if (refreshStatus.state === "running") {
    return Response.json(refreshStatus, { status: 409 });
  }
  updateRefreshStatus({
    state: "running",
    total: 0,
    completed: 0,
    failed: 0,
    startedAt: Date.now(),
    completedAt: null,
    error: null,
  });
  void (async (): Promise<void> => {
    try {
      await refreshMetadata();
    } catch (error) {
      updateRefreshStatus({
        state: "complete",
        failed: refreshStatus.failed + 1,
        completedAt: Date.now(),
        error: error instanceof Error ? error.message : "Metadata refresh could not start",
      });
    }
  })();
  return Response.json(refreshStatus, { status: 202 });
}

export async function searchAniListResponse(url: URL): Promise<Response> {
  const search = url.searchParams.get("q")?.trim() ?? "";
  if (search.length < 2) {
    return new Response("Search must be at least 2 characters", { status: 400 });
  }
  const query = `query ($search: String!) {
    Page(page: 1, perPage: 8) {
      media(search: $search, type: ANIME, sort: SEARCH_MATCH) { ${MEDIA_FIELDS} }
    }
  }`;
  const data = await aniListGraphQl<SearchData>({
    query,
    variables: { search },
    cacheKey: `search:${search.toLocaleLowerCase()}`,
    cacheMs: 5 * 60_000,
  });
  return Response.json(data.Page.media.map((media) => cleanMedia(media)));
}

interface LinkBody {
  readonly key: string;
  readonly id: number;
  readonly manualTitle: string | undefined;
}

function linkBody(value: unknown): LinkBody | null {
  const object = jsonObject(value);
  if (object === null) {
    return null;
  }
  const { key, id, manualTitle } = object;
  if (manualTitle !== undefined && (typeof manualTitle !== "string" || manualTitle.trim() === "" || manualTitle.length > 300)) { return null; }
  return typeof key === "string" && key !== "" && Number.isInteger(id) && Number(id) > 0
    ? { key, id: id as number, manualTitle: manualTitle?.trim() }
    : null;
}

interface SaveMatch {
  readonly key: string;
  readonly match: FolderMatch;
  readonly actor: ActivityActor;
}

/**
 * Points a show or season at a match: writes it into the nanime.json of every
 * folder the key covers and records the change, together.
 */
async function saveMatch(save: SaveMatch): Promise<Response> {
  const slots = slotsForKey(await librarySlots(), save.key);
  const [first] = slots;
  if (first === undefined) {
    return new Response("No library folder holds that show or season", { status: 404 });
  }
  const store = await metadata();
  const previous = store[canonicalMetadataKey(save.key)];
  const media = await resolveMatch(save.match, { base: linkBase(previous) });
  const ref = matchRef(first.role, save.match);
  recordMappingActivity({
    actor: save.actor,
    key: save.key,
    previous,
    next: media,
    write: () => {
      storeCachedMetadata(ref, media);
      writeFolderMatches(metadataLibrary().root, slots.map((slot) => ({ folder: slot.folder, role: slot.role, match: save.match })));
    },
  });
  failedUntil.delete(ref);
  return Response.json(media);
}

export async function linkAniListResponse(req: Request, actor: ActivityActor): Promise<Response> {
  const body = linkBody(await req.json().catch((): null => null));
  if (body === null) {
    return new Response("Invalid link request", { status: 400 });
  }
  const match: FolderMatch = body.manualTitle === undefined
    ? { provider: "anilist", id: body.id }
    : { provider: "anilist", id: body.id, title: body.manualTitle };
  return await saveMatch({ key: body.key, match, actor });
}
