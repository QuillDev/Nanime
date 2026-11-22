import { isAllowedArtUrl } from "../shared/artHosts.ts";
import type { EpisodeMetadata } from "./episodeMetadataCache.ts";

const EPISODE_PREFIX = /^Episode\s+\d+(?:\s*[-:–—]\s*|\s*$)/iu;

export interface EpisodeMetadataLookup {
  readonly anilistId: number;
  readonly idMal: number | null;
  readonly expectedEpisodes: number | null;
}

/** Generic contract for external episode metadata providers mapped to EpisodeMetadata. */
export interface EpisodeMetadataProvider {
  readonly name: string;
  readonly fetchEpisodes: (lookup: EpisodeMetadataLookup) => Promise<readonly EpisodeMetadata[]>;
}

export class EpisodeProviderError extends Error {
  public readonly status: number;
  public readonly retryAfterSeconds: number;

  public constructor(message: string, status: number, retryAfterSeconds = 0) {
    super(message);
    this.name = "EpisodeProviderError";
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export function parseRetryAfterSeconds(header: string | null): number {
  const parsed = Math.trunc(Number(header ?? ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/** Normalizes a provider episode title: fixes AniDB backticks and strips placeholder prefixes. */
export function normalizeEpisodeTitle(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  const cleaned = raw
    .replaceAll("`", "'")
    .replaceAll(/\s+/gu, " ")
    .trim()
    .replace(EPISODE_PREFIX, "")
    .trim();
  return cleaned === "" ? null : cleaned;
}

export function normalizeEpisodeThumbnail(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  const trimmed = raw.trim();
  return isAllowedArtUrl(trimmed) ? trimmed : null;
}
