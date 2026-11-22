import { z } from "zod";
import type { EpisodeMetadata } from "./episodeMetadataCache.ts";
import {
  EpisodeProviderError,
  normalizeEpisodeThumbnail,
  normalizeEpisodeTitle,
  parseRetryAfterSeconds,
  type EpisodeMetadataLookup,
  type EpisodeMetadataProvider,
} from "./episodeMetadataProvider.ts";

const ANI_ZIP_MAPPINGS_URL = "https://api.ani.zip/mappings";
const REQUEST_TIMEOUT_MS = 8000;
const POSITIVE_INTEGER_KEY = /^[1-9]\d*$/u;

const aniZipTitleSchema = z.object({
  en: z.string().nullish(),
});

const aniZipEpisodeSchema = z.object({
  title: aniZipTitleSchema.nullish(),
  image: z.string().nullish(),
});

const aniZipResponseSchema = z.object({
  episodes: z.record(z.string(), z.unknown()).nullish(),
});

function parseAniZipEpisodes(payload: unknown): readonly EpisodeMetadata[] {
  const parsed = aniZipResponseSchema.safeParse(payload);
  if (!parsed.success || parsed.data.episodes === null || parsed.data.episodes === undefined) {
    return [];
  }
  const episodes: EpisodeMetadata[] = [];
  for (const [key, value] of Object.entries(parsed.data.episodes)) {
    if (!POSITIVE_INTEGER_KEY.test(key)) {
      continue;
    }
    const entry = aniZipEpisodeSchema.safeParse(value);
    if (!entry.success) {
      continue;
    }
    const title = normalizeEpisodeTitle(entry.data.title?.en);
    const thumbnail = normalizeEpisodeThumbnail(entry.data.image);
    if (title === null && thumbnail === null) {
      continue;
    }
    episodes.push({ number: Number(key), title, thumbnail, source: "ani.zip" });
  }
  return episodes.toSorted((left, right) => left.number - right.number);
}

async function fetchAniZipEpisodes(lookup: EpisodeMetadataLookup): Promise<readonly EpisodeMetadata[]> {
  const url = `${ANI_ZIP_MAPPINGS_URL}?anilist_id=${String(lookup.anilistId)}`;
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (response.status === 404) {
    return [];
  }
  if (!response.ok) {
    throw new EpisodeProviderError(
      `ani.zip request failed (${String(response.status)})`,
      response.status,
      parseRetryAfterSeconds(response.headers.get("retry-after")),
    );
  }
  const payload: unknown = await response.json().catch((): null => null);
  if (payload === null) {
    throw new EpisodeProviderError("ani.zip returned invalid JSON", 502);
  }
  return parseAniZipEpisodes(payload);
}

export const aniZipEpisodeProvider: EpisodeMetadataProvider = {
  name: "ani.zip",
  fetchEpisodes: fetchAniZipEpisodes,
};
