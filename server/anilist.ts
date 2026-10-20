import type { MetadataRefreshStatus } from "../shared/types.ts";
import { aniListGraphQl } from "./anilistClient.ts";
import { jsonObject } from "./json.ts";
import type { AnimeMetadata, MetadataStore } from "./metadataTypes.ts";
import { fetchJikanMedia, searchJikan } from "./jikan.ts";
import { matchTvmaze, plainText } from "./tvmaze.ts";
import { recordMappingActivity, type ActivityActor } from "./libraryActivity.ts";
import { manualAniListMetadata } from "./manualMetadata.ts";
import { canonicalMetadataKey, matchRef, metadataSlots, readFolderMetadata, slotsForKey, writeFolderMatches, type FolderMatch, type FolderMetadata, type MetadataRole, type MetadataSlot } from "./folderMetadata.ts";
import { cachedMetadata, migrateLegacyMetadata, storeCachedMetadata } from "./metadataCache.ts";

export { aniListErrorResponse } from "./anilistClient.ts";
export { jikanErrorResponse } from "./jikan.ts";

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

/** The provider's own payload for a match. Manual matches are always AniList. */
function fetchProvider(match: FolderMatch): Promise<AnimeMetadata> {
  return match.provider === "jikan" ? fetchJikanMedia(match.id) : fetchMedia(match.id);
}

type BaseFetcher = (match: FolderMatch) => Promise<AnimeMetadata | undefined>;

/** Fetches non-manual matches. A manual match keeps `previous`: its AniList entry may not exist. */
function linkBase(previous: AnimeMetadata | undefined): BaseFetcher {
  return (match) => (match.title === undefined ? fetchProvider(match) : Promise.resolve(previous));
}

/** A match's payload: the provider's, with the match's AniList ID, manual title, and (for shows) TVmaze episodes. */
async function resolveMatch(role: MetadataRole, match: FolderMatch, options: { readonly previous?: AnimeMetadata | undefined; readonly base: BaseFetcher }): Promise<AnimeMetadata> {
  const base = await options.base(match);
  if (match.title !== undefined) {
    return manualAniListMetadata(match.id, match.title, base);
  }
  if (base === undefined) {
    throw new Error(`No ${match.provider} payload for ${String(match.id)}`);
  }
  const media = match.provider === "jikan" ? { ...base, anilistId: match.anilistId ?? null } : base;
  return role === "show" ? await tvmazeEnrichment(media, options.previous) : media;
}

async function resolveUncached(role: MetadataRole, match: FolderMatch, ref: string): Promise<AnimeMetadata | undefined> {
  try {
    const media = await resolveMatch(role, match, { base: linkBase(undefined) });
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
  const pending = resolving.get(ref) ?? resolveUncached(role, match, ref);
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

async function tvmazeEnrichment(
  media: AnimeMetadata,
  previous?: AnimeMetadata,
): Promise<AnimeMetadata> {
  try {
    return {
      ...media,
      tvmaze: await matchTvmaze(media),
      tvmazeCheckedAt: Date.now(),
    };
  } catch {
    if (previous?.tvmaze === undefined) {
      return media;
    }
    return previous.tvmazeCheckedAt === undefined
      ? { ...media, tvmaze: previous.tvmaze }
      : { ...media, tvmaze: previous.tvmaze, tvmazeCheckedAt: previous.tvmazeCheckedAt };
  }
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
  const media = await fetchProvider(match);
  await Bun.sleep(METADATA_REFRESH_INTERVAL_MS);
  return media;
}

/** Fetches each provider entry once per refresh, pacing requests to stay under rate limits. */
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
      // One match at a time: the providers rate-limit, and refreshBase paces each fetch.
      // eslint-disable-next-line no-await-in-loop, react-doctor/async-await-in-loop
      const media = await resolveMatch(entry.role, entry.match, { previous: cachedMetadata(entry.ref), base });
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

export async function searchJikanResponse(url: URL): Promise<Response> {
  const search = url.searchParams.get("q")?.trim() ?? "";
  if (search.length < 2) {
    return new Response("Search must be at least 2 characters", { status: 400 });
  }
  return Response.json(await searchJikan(search));
}

interface LinkBody {
  readonly key: string;
  readonly id: number;
  readonly anilistId: number | null;
  readonly manualTitle: string | undefined;
}

function optionalAniListId(value: unknown): number | null | undefined {
  if (value === undefined || value === null) {
    return null;
  }
  return Number.isInteger(value) && (value as number) > 0 ? value as number : undefined;
}

function linkBody(value: unknown): LinkBody | null {
  const object = jsonObject(value);
  if (object === null) {
    return null;
  }
  const { key, id, anilistId: rawAniListId } = object;
  const { manualTitle } = object;
  if (manualTitle !== undefined && (typeof manualTitle !== "string" || manualTitle.trim() === "" || manualTitle.length > 300)) { return null; }
  const anilistId = optionalAniListId(rawAniListId);
  return typeof key === "string" && key !== "" && Number.isInteger(id) && Number(id) > 0 &&
    anilistId !== undefined
    ? { key, id: id as number, anilistId, manualTitle: manualTitle?.trim() }
    : null;
}

interface SaveMatch {
  readonly key: string;
  readonly match: FolderMatch;
  readonly actor: ActivityActor;
  /** Already resolved; fetched from the provider otherwise. */
  readonly media?: AnimeMetadata;
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
  const media = save.media ?? await resolveMatch(first.role, save.match, { previous, base: linkBase(previous) });
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

export async function linkJikanResponse(req: Request, actor: ActivityActor): Promise<Response> {
  const body = linkBody(await req.json().catch((): null => null));
  if (body === null) {
    return new Response("Invalid link request", { status: 400 });
  }
  return await saveMatch({ key: body.key, match: { provider: "jikan", id: body.id, anilistId: body.anilistId }, actor });
}

interface AniListIdBody {
  readonly key: string;
  readonly anilistId: number | null;
}

function aniListIdBody(value: unknown): AniListIdBody | null {
  const object = jsonObject(value);
  const key = object?.["key"];
  const anilistId = optionalAniListId(object?.["anilistId"]);
  return typeof key === "string" && key !== "" && anilistId !== undefined
    ? { key, anilistId }
    : null;
}

export async function updateMetadataAniListIdResponse(
  req: Request,
  actor: ActivityActor,
): Promise<Response> {
  const body = aniListIdBody(await req.json().catch((): null => null));
  if (body === null) {
    return new Response("Invalid AniList ID request", { status: 400 });
  }
  const store = await metadata();
  const current = store[canonicalMetadataKey(body.key)];
  if (current === undefined) {
    return new Response("Metadata mapping not found", { status: 404 });
  }
  if (current.provider !== "jikan") {
    return new Response("AniList mappings already use their matched media ID", { status: 409 });
  }
  const match: FolderMatch = { provider: "jikan", id: current.id, anilistId: body.anilistId };
  return await saveMatch({ key: body.key, match, actor, media: { ...current, anilistId: body.anilistId } });
}
