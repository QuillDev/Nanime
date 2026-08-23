import { api, unwrap } from "./api.ts";
import type { AniListMedia, MetadataProvider, ShowMetadata } from "./types.ts";

export async function fetchShowMetadata(signal: AbortSignal): Promise<ShowMetadata> {
  return unwrap(await api.api.metadata.get({ fetch: { signal } }), "Metadata request");
}

export async function searchMetadata(
  provider: MetadataProvider,
  search: string,
  signal: AbortSignal,
): Promise<readonly AniListMedia[]> {
  return provider === "anilist"
    ? unwrap(
        await api.api.anilist.search.get({ query: { q: search }, fetch: { signal } }),
        "AniList search",
      )
    : unwrap(
        await api.api.jikan.search.get({ query: { q: search }, fetch: { signal } }),
        "Jikan search",
      );
}

interface MetadataLink {
  readonly provider: MetadataProvider;
  readonly key: string;
  readonly id: number;
  readonly anilistId: number | null;
}

export async function linkMetadata(link: MetadataLink): Promise<AniListMedia> {
  const { provider, key, id, anilistId } = link;
  return provider === "anilist"
    ? unwrap(await api.api.anilist.link.post({ key, id }), "AniList link")
    : unwrap(await api.api.jikan.link.post({ key, id, anilistId }), "Jikan link");
}

export async function updateMetadataAniListId(
  key: string,
  anilistId: number | null,
): Promise<AniListMedia> {
  return unwrap(
    await api.api.metadata["anilist-id"].put({ key, anilistId }),
    "Updating AniList sync ID",
  );
}
