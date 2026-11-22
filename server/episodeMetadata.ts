import { aniZipEpisodeProvider } from "./aniZipEpisodeProvider.ts";
import {
  cachedEpisodeMetadata,
  storeCachedEpisodeMetadata,
  type EpisodeMetadata,
} from "./episodeMetadataCache.ts";
import {
  EpisodeProviderError,
  normalizeEpisodeThumbnail,
  normalizeEpisodeTitle,
  type EpisodeMetadataLookup,
  type EpisodeMetadataProvider,
} from "./episodeMetadataProvider.ts";
import type { AnimeMetadata } from "./metadataTypes.ts";

export type { EpisodeMetadata } from "./episodeMetadataCache.ts";
export { EpisodeProviderError, type EpisodeMetadataLookup, type EpisodeMetadataProvider } from "./episodeMetadataProvider.ts";

type StreamingEpisode = AnimeMetadata["streamingEpisodes"][number];

const EPISODE_TITLE_PREFIX = /^Episode\s+(?<number>\d+)\s*(?:[-:–—]\s*)?(?<title>.*)$/iu;
const MAX_CONCURRENT_REQUESTS = 2;
const RATE_LIMIT_COOLDOWN_MS = 60_000;
const OUTAGE_COOLDOWN_MS = 5 * 60_000;
const FAILED_LOOKUP_RETRY_MS = 10 * 60_000;

/**
 * Registered fallback providers in priority order. Add new providers here so
 * every source maps into canonical EpisodeMetadata and fails over cleanly.
 */
const REGISTERED_PROVIDERS: readonly EpisodeMetadataProvider[] = [
  aniZipEpisodeProvider,
];

function defaultProviders(): readonly EpisodeMetadataProvider[] {
  const configured = process.env["NANIME_EPISODE_METADATA_PROVIDERS"];
  if (configured === undefined) {
    return REGISTERED_PROVIDERS;
  }
  const names = configured.split(",").map((name) => name.trim()).filter((name) => name !== "" && name !== "none");
  const byName = new Map(REGISTERED_PROVIDERS.map((provider) => [provider.name, provider] as const));
  return names.flatMap((name) => {
    const provider = byName.get(name);
    return provider === undefined ? [] : [provider];
  });
}

export interface EpisodeEnrichmentOptions {
  readonly providers?: readonly EpisodeMetadataProvider[];
  readonly bypassCache?: boolean;
}

interface ParsedStreamingEpisodes {
  readonly episodes: readonly EpisodeMetadata[];
  readonly unnumbered: readonly StreamingEpisode[];
}

const inFlight = new Map<number, Promise<readonly EpisodeMetadata[] | undefined>>();
const failedUntil = new Map<number, number>();
const providerBlockedUntil = new Map<string, number>();
const waitQueue: (() => void)[] = [];
let activeRequests = 0;

async function acquireSlot(): Promise<void> {
  if (activeRequests < MAX_CONCURRENT_REQUESTS) {
    activeRequests += 1;
    return;
  }
  const slot = Promise.withResolvers<void>();
  waitQueue.push(slot.resolve);
  await slot.promise;
}

function releaseSlot(): void {
  const next = waitQueue.shift();
  if (next === undefined) {
    activeRequests -= 1;
    return;
  }
  next();
}

function parseStreamingEpisodes(entries: readonly StreamingEpisode[]): ParsedStreamingEpisodes {
  const seen = new Set<number>();
  const episodes: EpisodeMetadata[] = [];
  const unnumbered: StreamingEpisode[] = [];
  for (const entry of entries) {
    const match = EPISODE_TITLE_PREFIX.exec(entry.title);
    const number = Number(match?.groups?.["number"]);
    if (!Number.isInteger(number) || number <= 0 || seen.has(number)) {
      unnumbered.push(entry);
      continue;
    }
    seen.add(number);
    episodes.push({
      number,
      title: normalizeEpisodeTitle(match?.groups?.["title"]),
      thumbnail: entry.thumbnail,
      source: entry.site,
    });
  }
  return { episodes, unnumbered };
}

function isEpisodeComplete(episode: EpisodeMetadata | undefined): boolean {
  return episode !== undefined && episode.title !== null && episode.thumbnail !== null;
}

function hasCompleteEpisodes(
  episodes: readonly EpisodeMetadata[],
  expectedEpisodes: number | null,
): boolean {
  if (expectedEpisodes === null || expectedEpisodes <= 0) {
    return false;
  }
  const byNumber = new Map(episodes.map((episode) => [episode.number, episode] as const));
  for (let number = 1; number <= expectedEpisodes; number += 1) {
    if (!isEpisodeComplete(byNumber.get(number))) {
      return false;
    }
  }
  return true;
}

function sanitizeEpisode(episode: EpisodeMetadata, fallbackSource: string): EpisodeMetadata | null {
  if (!Number.isInteger(episode.number) || episode.number <= 0) {
    return null;
  }
  const title = normalizeEpisodeTitle(episode.title);
  const thumbnail = normalizeEpisodeThumbnail(episode.thumbnail);
  if (title === null && thumbnail === null) {
    return null;
  }
  return {
    number: episode.number,
    title,
    thumbnail,
    source: episode.source.trim() || fallbackSource,
  };
}

function mergeEpisode(primary: EpisodeMetadata, fallback: EpisodeMetadata): EpisodeMetadata {
  return {
    number: primary.number,
    title: primary.title ?? fallback.title,
    thumbnail: primary.thumbnail ?? fallback.thumbnail,
    source: primary.source,
  };
}

function mergeEpisodeLists(
  primary: readonly EpisodeMetadata[],
  fallback: readonly EpisodeMetadata[],
): readonly EpisodeMetadata[] {
  const byNumber = new Map<number, EpisodeMetadata>();
  for (const episode of primary) {
    if (!byNumber.has(episode.number)) {
      byNumber.set(episode.number, episode);
    }
  }
  for (const episode of fallback) {
    const existing = byNumber.get(episode.number);
    byNumber.set(episode.number, existing === undefined ? episode : mergeEpisode(existing, episode));
  }
  return [...byNumber.values()].toSorted((left, right) => left.number - right.number);
}

function formatStreamingEpisode(episode: EpisodeMetadata): StreamingEpisode {
  const title = episode.title === null
    ? `Episode ${String(episode.number)}`
    : `Episode ${String(episode.number)} - ${episode.title}`;
  return {
    title,
    thumbnail: episode.thumbnail,
    site: episode.source,
  };
}

function mergeStreamingEpisodes(
  existing: readonly StreamingEpisode[],
  fallback: readonly EpisodeMetadata[],
): readonly StreamingEpisode[] {
  if (fallback.length === 0) {
    return existing;
  }
  const parsed = parseStreamingEpisodes(existing);
  const merged = mergeEpisodeLists(parsed.episodes, fallback);
  return [...merged.map((episode) => formatStreamingEpisode(episode)), ...parsed.unnumbered];
}

function streamingEpisodesEqual(
  left: readonly StreamingEpisode[],
  right: readonly StreamingEpisode[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((entry, index) => {
    const other = right[index];
    return other !== undefined &&
      entry.title === other.title &&
      entry.thumbnail === other.thumbnail &&
      entry.site === other.site;
  });
}

function cooldownForError(error: unknown): number {
  if (error instanceof EpisodeProviderError) {
    if (error.status === 429) {
      return error.retryAfterSeconds > 0 ? error.retryAfterSeconds * 1000 : RATE_LIMIT_COOLDOWN_MS;
    }
    if (error.status === 403 || error.status >= 500) {
      return error.retryAfterSeconds > 0 ? error.retryAfterSeconds * 1000 : OUTAGE_COOLDOWN_MS;
    }
    return 0;
  }
  return OUTAGE_COOLDOWN_MS;
}

async function callProvider(
  provider: EpisodeMetadataProvider,
  lookup: EpisodeMetadataLookup,
): Promise<readonly EpisodeMetadata[]> {
  await acquireSlot();
  try {
    const raw = await provider.fetchEpisodes(lookup);
    return raw.flatMap((episode) => {
      const sanitized = sanitizeEpisode(episode, provider.name);
      return sanitized === null ? [] : [sanitized];
    });
  } finally {
    releaseSlot();
  }
}

interface ProviderFetchResult {
  readonly episodes: readonly EpisodeMetadata[];
  readonly providers: readonly string[];
  readonly succeeded: boolean;
}

interface ProviderFetchContext {
  readonly lookup: EpisodeMetadataLookup;
  readonly existing: readonly EpisodeMetadata[];
}

const EMPTY_FETCH_RESULT: ProviderFetchResult = {
  episodes: [],
  providers: [],
  succeeded: false,
};

async function fetchFromProviders(
  context: ProviderFetchContext,
  providers: readonly EpisodeMetadataProvider[],
  state: ProviderFetchResult,
): Promise<ProviderFetchResult> {
  const [provider, ...rest] = providers;
  if (provider === undefined) {
    return state;
  }
  if ((providerBlockedUntil.get(provider.name) ?? 0) > Date.now()) {
    return await fetchFromProviders(context, rest, state);
  }
  try {
    const fetched = await callProvider(provider, context.lookup);
    const next: ProviderFetchResult = fetched.length > 0
      ? {
        episodes: mergeEpisodeLists(state.episodes, fetched),
        providers: [...state.providers, provider.name],
        succeeded: true,
      }
      : { ...state, succeeded: true };
    if (hasCompleteEpisodes(mergeEpisodeLists(context.existing, next.episodes), context.lookup.expectedEpisodes)) {
      return next;
    }
    return await fetchFromProviders(context, rest, next);
  } catch (error) {
    const cooldownMs = cooldownForError(error);
    if (cooldownMs > 0) {
      providerBlockedUntil.set(provider.name, Date.now() + cooldownMs);
    }
    console.warn(
      `Episode metadata provider ${provider.name} failed for AniList ${String(context.lookup.anilistId)}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return await fetchFromProviders(context, rest, state);
  }
}

async function resolveAndCacheEpisodes(
  lookup: EpisodeMetadataLookup,
  existing: readonly EpisodeMetadata[],
  providers: readonly EpisodeMetadataProvider[],
): Promise<readonly EpisodeMetadata[] | undefined> {
  const result = await fetchFromProviders({ lookup, existing }, providers, EMPTY_FETCH_RESULT);
  if (result.succeeded) {
    storeCachedEpisodeMetadata(lookup.anilistId, result.episodes, result.providers);
    failedUntil.delete(lookup.anilistId);
    return result.episodes;
  }
  failedUntil.set(lookup.anilistId, Date.now() + FAILED_LOOKUP_RETRY_MS);
  return cachedEpisodeMetadata(lookup.anilistId)?.episodes;
}

async function loadFallbackEpisodes(
  lookup: EpisodeMetadataLookup,
  existing: readonly EpisodeMetadata[],
  options: EpisodeEnrichmentOptions,
): Promise<readonly EpisodeMetadata[] | undefined> {
  const providers = options.providers ?? defaultProviders();
  if (providers.length === 0) {
    return cachedEpisodeMetadata(lookup.anilistId)?.episodes;
  }
  const bypassCache = options.bypassCache ?? false;
  if (!bypassCache) {
    const cached = cachedEpisodeMetadata(lookup.anilistId);
    if (cached !== undefined) {
      return cached.episodes;
    }
    if ((failedUntil.get(lookup.anilistId) ?? 0) > Date.now()) {
      return undefined;
    }
    const pending = inFlight.get(lookup.anilistId);
    if (pending !== undefined) {
      return await pending;
    }
  }
  if (bypassCache) {
    return await resolveAndCacheEpisodes(lookup, existing, providers);
  }
  const tracked = (async (): Promise<readonly EpisodeMetadata[] | undefined> => {
    try {
      return await resolveAndCacheEpisodes(lookup, existing, providers);
    } finally {
      inFlight.delete(lookup.anilistId);
    }
  })();
  inFlight.set(lookup.anilistId, tracked);
  return await tracked;
}

/**
 * Fills missing episode titles and thumbnails from the configured fallback
 * providers, caching the canonical episode list in SQLite per AniList ID.
 * Returns `media` unchanged (same reference) when no episodes were added.
 */
export async function enrichMediaEpisodes(
  media: AnimeMetadata,
  options: EpisodeEnrichmentOptions = {},
): Promise<AnimeMetadata> {
  const parsed = parseStreamingEpisodes(media.streamingEpisodes);
  if (hasCompleteEpisodes(parsed.episodes, media.episodes)) {
    return media;
  }
  const anilistId = media.anilistId ?? media.id;
  const fallback = await loadFallbackEpisodes(
    { anilistId, idMal: media.idMal, expectedEpisodes: media.episodes },
    parsed.episodes,
    options,
  );
  if (fallback === undefined || fallback.length === 0) {
    return media;
  }
  const merged = mergeStreamingEpisodes(media.streamingEpisodes, fallback);
  if (streamingEpisodesEqual(media.streamingEpisodes, merged)) {
    return media;
  }
  return { ...media, streamingEpisodes: merged };
}
