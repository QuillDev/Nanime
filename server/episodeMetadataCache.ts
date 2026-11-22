import { z } from "zod";
import { database } from "./database.ts";

/** Canonical episode metadata shape every episode provider maps into. */
const episodeMetadataSchema = z.object({
  number: z.number().int().positive(),
  title: z.string().nullable(),
  thumbnail: z.string().nullable(),
  source: z.string().min(1),
});

export type EpisodeMetadata = z.infer<typeof episodeMetadataSchema>;

export interface CachedEpisodeMetadata {
  readonly episodes: readonly EpisodeMetadata[];
  readonly providers: readonly string[];
  readonly updatedAt: number;
}

const episodeListSchema = z.array(episodeMetadataSchema);
const providerListSchema = z.array(z.string());

function parseJsonWithSchema<T>(raw: string, schema: z.ZodType<T>): T | undefined {
  try {
    const parsed = schema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

const selectEpisodeCache = database.query<
  { readonly providers: string; readonly payload: string; readonly updated_at: number },
  [number]
>(
  "SELECT providers, payload, updated_at FROM episode_metadata_cache WHERE anilist_id = ?",
);

const upsertEpisodeCache = database.query<void, [number, string, string, number]>(`
  INSERT INTO episode_metadata_cache (anilist_id, providers, payload, updated_at)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(anilist_id) DO UPDATE SET
    providers = excluded.providers,
    payload = excluded.payload,
    updated_at = excluded.updated_at
`);

/** Cached canonical episode metadata for an AniList ID, if stored and valid. */
export function cachedEpisodeMetadata(anilistId: number): CachedEpisodeMetadata | undefined {
  const row = selectEpisodeCache.get(anilistId);
  if (row === null) {
    return undefined;
  }
  const episodes = parseJsonWithSchema(row.payload, episodeListSchema);
  const providers = parseJsonWithSchema(row.providers, providerListSchema);
  if (episodes === undefined || providers === undefined) {
    return undefined;
  }
  return {
    episodes,
    providers,
    updatedAt: row.updated_at,
  };
}

export function storeCachedEpisodeMetadata(
  anilistId: number,
  episodes: readonly EpisodeMetadata[],
  providers: readonly string[],
): void {
  upsertEpisodeCache.run(
    anilistId,
    JSON.stringify(providers),
    JSON.stringify(episodes),
    Date.now(),
  );
}
