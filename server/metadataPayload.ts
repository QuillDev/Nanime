import { jsonObject, type JsonObject } from "./json.ts";
import type { AnimeMetadata } from "./metadataTypes.ts";

function nullableString(value: unknown): boolean {
  return typeof value === "string" || value === null;
}

function nullableNumber(value: unknown): boolean {
  return typeof value === "number" || value === null;
}

function mediaDate(value: unknown): AnimeMetadata["startDate"] {
  const date = jsonObject(value);
  if (
    date === null ||
    !nullableNumber(date["year"]) ||
    !nullableNumber(date["month"]) ||
    !nullableNumber(date["day"])
  ) {
    return null;
  }
  return {
    year: date["year"] as number | null,
    month: date["month"] as number | null,
    day: date["day"] as number | null,
  };
}

function validMediaIdentity(
  media: JsonObject,
  title: JsonObject | null,
  coverImage: JsonObject | null,
): boolean {
  return typeof media["id"] === "number" &&
    nullableNumber(media["idMal"]) &&
    nullableString(title?.["english"]) && typeof title?.["romaji"] === "string" &&
    nullableString(title["native"]) &&
    nullableString(coverImage?.["extraLarge"]) && nullableString(coverImage?.["large"]) &&
    nullableString(coverImage?.["color"]);
}

function validMediaDetails(media: JsonObject): boolean {
  return nullableString(media["description"]) && nullableString(media["bannerImage"]) &&
    typeof media["siteUrl"] === "string" && nullableNumber(media["episodes"]) &&
    nullableNumber(media["duration"]) && nullableString(media["season"]) &&
    nullableNumber(media["seasonYear"]) && nullableString(media["format"]) &&
    nullableString(media["status"]) && nullableNumber(media["averageScore"]);
}

function validMediaCollections(media: JsonObject): boolean {
  return Array.isArray(media["genres"]) &&
    media["genres"].every((genre) => typeof genre === "string") &&
    Array.isArray(media["streamingEpisodes"]);
}

/** Validates a stored provider payload, including ones older versions wrote. */
export function mediaFromUnknown(value: unknown): AnimeMetadata | null {
  const media = jsonObject(value);
  const title = jsonObject(media?.["title"]);
  const coverImage = jsonObject(media?.["coverImage"]);
  if (media === null || !validMediaIdentity(media, title, coverImage) ||
    !validMediaDetails(media) || !validMediaCollections(media)) {
    return null;
  }
  const provider = media["provider"] === "jikan" ? "jikan" : "anilist";
  const storedAniListId = media["anilistId"];
  let anilistId: number | null = null;
  if (typeof storedAniListId === "number") {
    anilistId = storedAniListId;
  } else if (provider === "anilist") {
    anilistId = media["id"] as number;
  }
  return {
    ...(value as AnimeMetadata),
    provider,
    anilistId,
    startDate: mediaDate(media["startDate"]),
  };
}
