import { z } from "zod";
import { db, EpisodeMetadataCacheRowSchema, execute, queryOne } from "./database.ts";

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

const EpisodeCacheSchema = EpisodeMetadataCacheRowSchema.omit({ anilist_id: true });

const MAX_EPISODE_CACHE = 2000;
const parsedEpisodeCache = new Map<number, {
  readonly providers: string;
  readonly payload: string;
  readonly updatedAt: number;
  readonly value: CachedEpisodeMetadata;
}>();

/** Cached canonical episode metadata for an AniList ID, if stored and valid. */
export function cachedEpisodeMetadata(anilistId: number): CachedEpisodeMetadata | undefined {
  const row = queryOne(db.selectFrom("episode_metadata_cache").select(["providers", "payload", "updated_at"])
    .where("anilist_id", "=", anilistId), EpisodeCacheSchema);
  if (row === null) {
    parsedEpisodeCache.delete(anilistId);
    return undefined;
  }
  const existing = parsedEpisodeCache.get(anilistId);
  if (
    existing !== undefined &&
    existing.providers === row.providers &&
    existing.payload === row.payload &&
    existing.updatedAt === row.updated_at
  ) {
    return existing.value;
  }
  const episodes = parseJsonWithSchema(row.payload, episodeListSchema);
  const providers = parseJsonWithSchema(row.providers, providerListSchema);
  if (episodes === undefined || providers === undefined) {
    return undefined;
  }
  const value: CachedEpisodeMetadata = {
    episodes,
    providers,
    updatedAt: row.updated_at,
  };
  parsedEpisodeCache.delete(anilistId);
  parsedEpisodeCache.set(anilistId, {
    providers: row.providers,
    payload: row.payload,
    updatedAt: row.updated_at,
    value,
  });
  while (parsedEpisodeCache.size > MAX_EPISODE_CACHE) {
    const oldest = parsedEpisodeCache.keys().next().value as number | undefined;
    if (oldest === undefined) {
      break;
    }
    parsedEpisodeCache.delete(oldest);
  }
  return value;
}

export function storeCachedEpisodeMetadata(
  anilistId: number,
  episodes: readonly EpisodeMetadata[],
  providers: readonly string[],
): void {
  const update = { providers: JSON.stringify(providers), payload: JSON.stringify(episodes), updated_at: Date.now() };
  execute(db.insertInto("episode_metadata_cache").values({ anilist_id: anilistId, ...update })
    .onConflict((conflict) => conflict.column("anilist_id").doUpdateSet(update)));
}
