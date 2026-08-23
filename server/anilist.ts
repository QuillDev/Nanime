import { resolve } from "node:path";
import { database } from "./database.ts";
import { aniListGraphQl } from "./anilistClient.ts";
import { matchTvmaze, plainText, type TvmazeMatch } from "./tvmaze.ts";

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
const TVMAZE_CACHE_MS = 7 * 24 * 60 * 60 * 1000;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function loadMetadata(): Promise<MetadataStore> {
  const rows = listMetadata.all();
  if (rows.length > 0) {
    return Object.fromEntries(rows.flatMap((row) => {
      const value: unknown = JSON.parse(row.payload);
      return isRecord(value) ? [[row.key, value as unknown as AniListMedia]] : [];
    }));
  }
  const file = Bun.file(METADATA_FILE);
  if (!(await file.exists())) {
    return {};
  }
  const value: unknown = await file.json().catch((): null => null);
  const store = isRecord(value) ? (value as MetadataStore) : {};
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

async function tvmazeEnrichment(media: AniListMedia): Promise<AniListMedia> {
  try {
    return {
      ...media,
      tvmaze: await matchTvmaze(media),
      tvmazeCheckedAt: Date.now(),
    };
  } catch {
    return media;
  }
}

async function refreshTvmazeMetadata(store: MetadataStore): Promise<void> {
  const stale = Object.entries(store).filter(([key, media]) => (
    key.startsWith("show:") &&
    (media.tvmazeCheckedAt === undefined || Date.now() - media.tvmazeCheckedAt > TVMAZE_CACHE_MS)
  ));
  let changed = false;
  for (let index = 0; index < stale.length; index += 4) {
    const batch = stale.slice(index, index + 4);
    const enriched = await Promise.all(batch.map(async ([key, media]) => ({
      key,
      media: await tvmazeEnrichment(media),
    })));
    for (const item of enriched) {
      if (item.media !== store[item.key]) {
        store[item.key] = item.media;
        changed = true;
      }
    }
  }
  if (changed) {
    writeMetadata(store);
  }
}

function cleanDescription(description: string | null): string | null {
  return plainText(description);
}

function cleanMedia(media: AniListMedia): AniListMedia {
  return { ...media, description: cleanDescription(media.description) };
}

export async function metadataResponse(): Promise<Response> {
  const store = await metadata();
  await refreshTvmazeMetadata(store);
  return Response.json(store);
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
  if (!isRecord(value)) {
    return null;
  }
  const { key, id } = value;
  return typeof key === "string" && key !== "" && Number.isInteger(id)
    ? { key, id: id as number }
    : null;
}

export async function linkAniListResponse(req: Request): Promise<Response> {
  const body = linkBody(await req.json().catch((): null => null));
  if (body === null) {
    return new Response("Invalid link request", { status: 400 });
  }
  const query = `query ($id: Int!) {
    Media(id: $id, type: ANIME) { ${MEDIA_FIELDS} }
  }`;
  const data = await aniListGraphQl<MediaData>({ query, variables: { id: body.id } });
  const clean = cleanMedia(data.Media);
  const media = body.key.startsWith("show:") ? await tvmazeEnrichment(clean) : clean;
  const store = await metadata();
  store[body.key] = media;
  writeMetadata(store);
  return Response.json(media);
}
