import { resolve } from "node:path";
import type { MetadataRefreshStatus } from "../shared/types.ts";
import { database } from "./database.ts";
import { aniListGraphQl } from "./anilistClient.ts";
import { jsonObject } from "./json.ts";
import type { AnimeMetadata, MetadataStore } from "./metadataTypes.ts";
import { fetchJikanMedia, searchJikan } from "./jikan.ts";
import { matchTvmaze, plainText } from "./tvmaze.ts";

export { aniListErrorResponse } from "./anilistClient.ts";
export { jikanErrorResponse } from "./jikan.ts";

const METADATA_FILE = resolve(
  process.env["MEDIA_METADATA_FILE"] ?? resolve(import.meta.dir, "..", ".media-metadata.json"),
);

interface MetadataRow {
  readonly key: string;
  readonly payload: string;
}

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
  bannerImage episodes duration season seasonYear format status
  genres averageScore siteUrl
  streamingEpisodes { title thumbnail site }
`;

let metadataPromise: Promise<MetadataStore> | undefined = undefined;
const METADATA_REFRESH_INTERVAL_MS = 2500;
let refreshStatus: MetadataRefreshStatus = {
  state: "idle",
  total: 0,
  completed: 0,
  failed: 0,
  startedAt: null,
  completedAt: null,
  error: null,
};
const listMetadata = database.query<MetadataRow, []>(
  "SELECT key, payload FROM media_metadata",
);
const upsertMetadata = database.query<void, [string, string, number]>(`
  INSERT INTO media_metadata (key, payload, updated_at)
  VALUES (?, ?, ?)
  ON CONFLICT(key) DO UPDATE SET
    payload = excluded.payload,
    updated_at = excluded.updated_at
`);
const writeMetadataTransaction = database.transaction((store: MetadataStore) => {
  const updatedAt = Date.now();
  for (const [key, media] of Object.entries(store)) {
    upsertMetadata.run(key, JSON.stringify(media), updatedAt);
  }
});

function nullableString(value: unknown): boolean {
  return typeof value === "string" || value === null;
}

function nullableNumber(value: unknown): boolean {
  return typeof value === "number" || value === null;
}

function mediaFromUnknown(value: unknown): AnimeMetadata | null {
  const media = jsonObject(value);
  const title = jsonObject(media?.["title"]);
  const coverImage = jsonObject(media?.["coverImage"]);
  if (
    typeof media?.["id"] !== "number" ||
    !nullableNumber(media["idMal"]) ||
    !nullableString(title?.["english"]) || typeof title?.["romaji"] !== "string" ||
    !nullableString(title["native"]) ||
    !nullableString(coverImage?.["extraLarge"]) || !nullableString(coverImage?.["large"]) ||
    !nullableString(coverImage?.["color"]) || !nullableString(media["description"]) ||
    !nullableString(media["bannerImage"]) || typeof media["siteUrl"] !== "string" ||
    !nullableNumber(media["episodes"]) || !nullableNumber(media["duration"]) ||
    !nullableString(media["season"]) || !nullableNumber(media["seasonYear"]) ||
    !nullableString(media["format"]) || !nullableString(media["status"]) ||
    !nullableNumber(media["averageScore"]) ||
    !Array.isArray(media["genres"]) || !media["genres"].every((genre) => typeof genre === "string") ||
    !Array.isArray(media["streamingEpisodes"])
  ) {
    return null;
  }
  const provider = media["provider"] === "jikan" ? "jikan" : "anilist";
  const storedAniListId = media["anilistId"];
  let anilistId: number | null = null;
  if (typeof storedAniListId === "number") {
    anilistId = storedAniListId;
  } else if (provider === "anilist") {
    anilistId = media["id"] as number;
  }
  return { ...(value as AnimeMetadata), provider, anilistId };
}

function metadataStore(value: unknown): MetadataStore {
  const object = jsonObject(value);
  if (object === null) {
    return {};
  }
  return Object.fromEntries(Object.entries(object).flatMap(([key, media]) => {
    const parsed = mediaFromUnknown(media);
    return parsed === null ? [] : [[key, parsed]];
  }));
}

async function loadMetadata(): Promise<MetadataStore> {
  const rows = listMetadata.all();
  if (rows.length > 0) {
    return Object.fromEntries(rows.flatMap((row) => {
      const media = mediaFromUnknown(JSON.parse(row.payload));
      return media === null ? [] : [[row.key, media]];
    }));
  }
  const file = Bun.file(METADATA_FILE);
  if (!(await file.exists())) {
    return {};
  }
  const value: unknown = await file.json().catch((): null => null);
  const store = metadataStore(value);
  writeMetadata(store);
  return store;
}

function metadata(): Promise<MetadataStore> {
  metadataPromise ??= loadMetadata();
  return metadataPromise;
}

function writeMetadata(store: MetadataStore): void {
  writeMetadataTransaction(store);
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

async function refreshMetadata(): Promise<void> {
  const store = await metadata();
  const entries = Object.entries(store);
  const refreshed = new Map<string, AnimeMetadata>();
  updateRefreshStatus({
    state: "running",
    total: entries.length,
    completed: 0,
    failed: 0,
    startedAt: Date.now(),
    completedAt: null,
    error: null,
  });
  for (const [key, previous] of entries) {
    try {
      const refreshKey = `${previous.provider}:${String(previous.id)}`;
      let media = refreshed.get(refreshKey);
      if (media === undefined) {
        media = previous.provider === "jikan"
          ? await fetchJikanMedia(previous.id)
          : await fetchMedia(previous.id);
        refreshed.set(refreshKey, media);
        await Bun.sleep(METADATA_REFRESH_INTERVAL_MS);
      }
      const mappedMedia = previous.provider === "jikan"
        ? { ...media, anilistId: previous.anilistId }
        : media;
      const updated = key.startsWith("show:")
        ? await tvmazeEnrichment(mappedMedia, previous)
        : mappedMedia;
      store[key] = updated;
      upsertMetadata.run(key, JSON.stringify(updated), Date.now());
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
  const anilistId = optionalAniListId(rawAniListId);
  return typeof key === "string" && key !== "" && Number.isInteger(id) &&
    anilistId !== undefined
    ? { key, id: id as number, anilistId }
    : null;
}

export async function linkAniListResponse(req: Request): Promise<Response> {
  const body = linkBody(await req.json().catch((): null => null));
  if (body === null) {
    return new Response("Invalid link request", { status: 400 });
  }
  const clean = await fetchMedia(body.id);
  const media = body.key.startsWith("show:") ? await tvmazeEnrichment(clean) : clean;
  const store = await metadata();
  store[body.key] = media;
  upsertMetadata.run(body.key, JSON.stringify(media), Date.now());
  return Response.json(media);
}

export async function linkJikanResponse(req: Request): Promise<Response> {
  const body = linkBody(await req.json().catch((): null => null));
  if (body === null) {
    return new Response("Invalid link request", { status: 400 });
  }
  const clean = { ...await fetchJikanMedia(body.id), anilistId: body.anilistId };
  const media = body.key.startsWith("show:") ? await tvmazeEnrichment(clean) : clean;
  const store = await metadata();
  store[body.key] = media;
  upsertMetadata.run(body.key, JSON.stringify(media), Date.now());
  return Response.json(media);
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

export async function updateMetadataAniListIdResponse(req: Request): Promise<Response> {
  const body = aniListIdBody(await req.json().catch((): null => null));
  if (body === null) {
    return new Response("Invalid AniList ID request", { status: 400 });
  }
  const store = await metadata();
  const current = store[body.key];
  if (current === undefined) {
    return new Response("Metadata mapping not found", { status: 404 });
  }
  if (current.provider !== "jikan") {
    return new Response("AniList mappings already use their matched media ID", { status: 409 });
  }
  const updated = { ...current, anilistId: body.anilistId };
  store[body.key] = updated;
  upsertMetadata.run(body.key, JSON.stringify(updated), Date.now());
  return Response.json(updated);
}
