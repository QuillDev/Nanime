import { jsonObject } from "./json.ts";
import type { AnimeMetadata } from "./metadataTypes.ts";
import { plainText } from "./tvmaze.ts";

const JIKAN_API_URL = "https://api.jikan.moe/v4";
const REQUEST_TIMEOUT_MS = 15_000;
const PAGE_DELAY_MS = 350;
const MAX_EPISODE_PAGES = 25;
const MAX_REQUEST_ATTEMPTS = 2;
const RETRY_DELAY_MS = 500;

export class JikanUpstreamError extends Error {
  public readonly responseStatus: number;
  public readonly retryAfterSeconds: number | null;

  public constructor(message: string, responseStatus: number, retryAfterSeconds: number | null) {
    super(message);
    this.name = "JikanUpstreamError";
    this.responseStatus = responseStatus;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function retryAfter(response: Response): number | null {
  const value = Number(response.headers.get("retry-after"));
  return Number.isFinite(value) && value > 0 ? value : null;
}

interface JikanEnvelope {
  readonly data: unknown;
  readonly pagination: unknown;
}

async function fetchJikan(path: string): Promise<Response> {
  try {
    return await fetch(`${JIKAN_API_URL}${path}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const message = error instanceof DOMException && error.name === "TimeoutError"
      ? "Jikan request timed out"
      : "Could not reach Jikan";
    throw new JikanUpstreamError(message, 503, null);
  }
}

function shouldRetry(response: Response): boolean {
  return response.status === 429 || response.status >= 500;
}

function retryDelay(response: Response): number {
  const requestedDelay = retryAfter(response);
  return requestedDelay === null
    ? RETRY_DELAY_MS
    : Math.min(requestedDelay * 1000, 3000);
}

async function fetchJikanWithRetry(path: string): Promise<Response> {
  for (let attempt = 1; attempt <= MAX_REQUEST_ATTEMPTS; attempt += 1) {
    const response = await fetchJikan(path);
    if (!shouldRetry(response) || attempt === MAX_REQUEST_ATTEMPTS) {
      return response;
    }
    await Bun.sleep(retryDelay(response));
  }
  throw new JikanUpstreamError("Jikan request failed", 503, null);
}

async function jikanRequest(path: string): Promise<JikanEnvelope> {
  const response = await fetchJikanWithRetry(path);
  if (!response.ok) {
    const retry = retryAfter(response);
    const status = response.status === 429 || response.status >= 500 ? 503 : 502;
    throw new JikanUpstreamError(
      `Jikan returned HTTP ${String(response.status)}`,
      status,
      retry,
    );
  }
  const value: unknown = await response.json().catch(() => {
    throw new JikanUpstreamError("Jikan returned invalid JSON", 502, null);
  });
  const payload = jsonObject(value);
  if (payload === null) {
    throw new JikanUpstreamError("Jikan returned an invalid response", 502, null);
  }
  return { data: payload["data"], pagination: payload["pagination"] };
}

function nullableText(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function durationMinutes(value: unknown): number | null {
  if (typeof value !== "string") {
    return null;
  }
  const matched = /(?<minutes>\d+)\s*min/iu.exec(value)?.groups?.["minutes"];
  return matched === undefined ? null : Number(matched);
}

function nestedText(value: unknown, ...keys: readonly string[]): string | null {
  let current: unknown = value;
  for (const key of keys) {
    current = jsonObject(current)?.[key];
  }
  return nullableText(current);
}

function names(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        const name = nullableText(jsonObject(item)?.["name"]);
        return name === null ? [] : [name];
      })
    : [];
}

interface JikanAnimeFields {
  readonly malId: unknown;
  readonly url: unknown;
  readonly title: unknown;
  readonly titleEnglish: unknown;
  readonly titleJapanese: unknown;
  readonly synopsis: unknown;
  readonly images: unknown;
  readonly trailer: unknown;
  readonly episodes: unknown;
  readonly duration: unknown;
  readonly season: unknown;
  readonly year: unknown;
  readonly type: unknown;
  readonly status: unknown;
  readonly genres: unknown;
  readonly score: unknown;
}

function animeFields(value: unknown): JikanAnimeFields | null {
  const media = jsonObject(value);
  return media === null ? null : {
    malId: media["mal_id"],
    url: media["url"],
    title: media["title"],
    titleEnglish: media["title_english"],
    titleJapanese: media["title_japanese"],
    synopsis: media["synopsis"],
    images: media["images"],
    trailer: media["trailer"],
    episodes: media["episodes"],
    duration: media["duration"],
    season: media["season"],
    year: media["year"],
    type: media["type"],
    status: media["status"],
    genres: media["genres"],
    score: media["score"],
  };
}

function mediaTitle(media: JikanAnimeFields): AnimeMetadata["title"] | null {
  const romaji = nullableText(media.title);
  if (romaji === null) {
    return null;
  }
  return {
    english: nullableText(media.titleEnglish),
    romaji,
    native: nullableText(media.titleJapanese),
  };
}

function mediaImages(media: JikanAnimeFields): AnimeMetadata["coverImage"] {
  const extraLarge = nestedText(media.images, "webp", "large_image_url") ??
    nestedText(media.images, "jpg", "large_image_url");
  const large = nestedText(media.images, "webp", "image_url") ??
    nestedText(media.images, "jpg", "image_url");
  return { extraLarge, large, color: null };
}

function animeFromUnknown(value: unknown): AnimeMetadata | null {
  const media = animeFields(value);
  const id = nullableNumber(media?.malId);
  const title = media === null ? null : mediaTitle(media);
  const siteUrl = nullableText(media?.url);
  if (media === null || id === null || title === null || siteUrl === null) {
    return null;
  }
  const score = nullableNumber(media.score);
  return {
    provider: "jikan",
    id,
    anilistId: null,
    idMal: id,
    title,
    description: plainText(nullableText(media.synopsis)),
    coverImage: mediaImages(media),
    bannerImage: nestedText(media.trailer, "images", "maximum_image_url"),
    episodes: nullableNumber(media.episodes),
    duration: durationMinutes(media.duration),
    season: nullableText(media.season)?.toUpperCase() ?? null,
    seasonYear: nullableNumber(media.year),
    format: nullableText(media.type),
    status: nullableText(media.status),
    genres: names(media.genres),
    averageScore: score === null ? null : Math.round(score * 10),
    siteUrl,
    streamingEpisodes: [],
  };
}

function episodeFromUnknown(value: unknown): AnimeMetadata["streamingEpisodes"][number] | null {
  const episode = jsonObject(value);
  const number = nullableNumber(episode?.["mal_id"]);
  const title = nullableText(episode?.["title"]);
  if (number === null || title === null) {
    return null;
  }
  return {
    title: `Episode ${String(number)} - ${title}`,
    thumbnail: null,
    site: nullableText(episode?.["url"]) ?? "MyAnimeList",
  };
}

interface EpisodePage {
  readonly episodes: readonly AnimeMetadata["streamingEpisodes"][number][];
  readonly hasNext: boolean;
}

function episodePage(payload: JikanEnvelope): EpisodePage {
  const pagination = jsonObject(payload.pagination);
  const { data } = payload;
  return {
    episodes: Array.isArray(data)
      ? data.map((item) => episodeFromUnknown(item)).filter((item) => item !== null)
      : [],
    hasNext: pagination?.["has_next_page"] === true,
  };
}

async function fetchEpisodes(id: number): Promise<AnimeMetadata["streamingEpisodes"]> {
  const episodes: AnimeMetadata["streamingEpisodes"][number][] = [];
  let page = 1;
  let hasNext = true;
  while (hasNext && page <= MAX_EPISODE_PAGES) {
    const result = episodePage(await jikanRequest(`/anime/${String(id)}/episodes?page=${String(page)}`));
    const { episodes: pageEpisodes, hasNext: morePages } = result;
    episodes.push(...pageEpisodes);
    hasNext = morePages;
    page += 1;
    if (hasNext) {
      await Bun.sleep(PAGE_DELAY_MS);
    }
  }
  return episodes;
}

export async function searchJikan(search: string): Promise<readonly AnimeMetadata[]> {
  const { data } = await jikanRequest(
    `/anime?q=${encodeURIComponent(search)}&limit=8&sfw=true`,
  );
  return Array.isArray(data)
    ? data.map((item) => animeFromUnknown(item)).filter((item) => item !== null)
    : [];
}

export async function fetchJikanMedia(id: number): Promise<AnimeMetadata> {
  const { data } = await jikanRequest(`/anime/${String(id)}/full`);
  const media = animeFromUnknown(data);
  if (media === null) {
    throw new JikanUpstreamError("Jikan returned invalid anime metadata", 502, null);
  }
  const episodes = await fetchEpisodes(id);
  return { ...media, streamingEpisodes: episodes };
}

export function jikanErrorResponse(error: unknown): Response | null {
  if (!(error instanceof JikanUpstreamError)) {
    return null;
  }
  const headers = new Headers({ "cache-control": "no-store" });
  if (error.retryAfterSeconds !== null) {
    headers.set("retry-after", String(error.retryAfterSeconds));
  }
  return Response.json({
    source: "jikan",
    message: error.message,
    retryAfterSeconds: error.retryAfterSeconds,
  }, { status: error.responseStatus, headers });
}
