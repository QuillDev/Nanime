import { api, unwrap } from "./api.ts";
import type { AniListMedia, ShowMetadata } from "./types.ts";
import {
  canUseOfflineFallback,
  offlineMetadataFallback,
  rememberOfflineMetadata,
} from "./offline/runtime.ts";

export async function fetchShowMetadata(signal: AbortSignal): Promise<ShowMetadata> {
  try {
    const metadata = unwrap(
      await api.api.metadata.get({ fetch: { signal } }),
      "Metadata request",
    );
    await rememberOfflineMetadata(metadata);
    return metadata;
  } catch (error: unknown) {
    if (canUseOfflineFallback(error)) {
      return offlineMetadataFallback();
    }
    throw error;
  }
}

export async function searchMetadata(search: string, signal: AbortSignal): Promise<readonly AniListMedia[]> {
  return unwrap(
    await api.api.anilist.search.get({ query: { q: search }, fetch: { signal } }),
    "AniList search",
  );
}

export interface MetadataLink {
  readonly key: string;
  readonly id: number;
  readonly manualTitle?: string;
}

export async function linkMetadata(link: MetadataLink): Promise<AniListMedia> {
  const { key, id, manualTitle } = link;
  if (manualTitle === undefined) { return unwrap(await api.api.anilist.link.post({ key, id }), "AniList link"); }
  return unwrap(await api.api.anilist.link.post({ key, id, manualTitle }), "Manual AniList link");
}
