import { resolve } from "node:path";
import type { MetadataRefreshStatus, TvmazeMatch } from "../shared/types.ts";
import { database } from "./database.ts";
import { aniListGraphQl } from "./anilistClient.ts";
import { jsonObject } from "./json.ts";
import { matchTvmaze, plainText } from "./tvmaze.ts";

export { aniListErrorResponse } from "./anilistClient.ts";

const METADATA_FILE = resolve(
  process.env["MEDIA_METADATA_FILE"] ?? resolve(import.meta.dir, "..", ".media-metadata.json"),
);

export interface AniListMedia {
  readonly id: number;
  readonly idMal: number | null;
  readonly title: {
    readonly english: string | null;
    readonly romaji: string;
    readonly native: string | null;
  };
  readonly description: string | null;
  readonly coverImage: {
    readonly extraLarge: string | null;
    readonly large: string | null;
    readonly color: string | null;
  };
  readonly bannerImage: string | null;
  readonly episodes: number | null;
  readonly duration: number | null;
  readonly season: string | null;
  readonly seasonYear: number | null;
  readonly format: string | null;
  readonly status: string | null;
  readonly genres: readonly string[];
  readonly averageScore: number | null;
  readonly siteUrl: string;
  readonly streamingEpisodes: readonly {
    readonly title: string;
    readonly thumbnail: string | null;
    readonly site: string;
  }[];
  readonly tvmaze?: TvmazeMatch | null;
  readonly tvmazeCheckedAt?: number;
}

type MetadataStore = Record<string, AniListMedia>;

interface MetadataRow {
  readonly key: string;
  readonly payload: string;
}

interface SearchData {
  readonly Page: { readonly media: readonly AniListMedia[] };
}

interface MediaData {
  readonly Media: AniListMedia;
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

function mediaFromUnknown(value: unknown): AniListMedia | null {
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
  return value as AniListMedia;
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
  media: AniListMedia,
  previous?: AniListMedia,
): Promise<AniListMedia> {
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

function cleanMedia(media: AniListMedia): AniListMedia {
  return { ...media, description: cleanDescription(media.description) };
}

export async function metadataResponse(): Promise<Response> {
  return Response.json(await metadata());
}

async function fetchMedia(id: number): Promise<AniListMedia> {
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
  const refreshed = new Map<number, AniListMedia>();
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
      let media = refreshed.get(previous.id);
      if (media === undefined) {
        media = await fetchMedia(previous.id);
        refreshed.set(previous.id, media);
        await Bun.sleep(METADATA_REFRESH_INTERVAL_MS);
      }
      const updated = key.startsWith("show:")
        ? await tvmazeEnrichment(media, previous)
        : media;
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

function linkBody(value: unknown): { readonly key: string; readonly id: number } | null {
  const object = jsonObject(value);
  if (object === null) {
    return null;
  }
  const { key, id } = object;
  return typeof key === "string" && key !== "" && Number.isInteger(id)
    ? { key, id: id as number }
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
