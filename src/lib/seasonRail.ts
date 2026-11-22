import type { AniListMedia, PlaybackProgressMap } from "../types.ts";
import { mediaTitle } from "./anilist.ts";
import { isMovieMedia, seasonDisplayName, statedSeasonNumber, type SeasonGroup } from "./library.ts";

export function seasonKey(season: SeasonGroup): string {
  return `${season.sourceShow}/${season.name}`;
}

function hasUnwatched(season: SeasonGroup, progress: PlaybackProgressMap): boolean {
  return season.entries.some((entry) => progress[entry.rel]?.completed !== true);
}

/** The season being watched: the one played last, or the next unfinished one after it; the first before anything is played. */
export function currentSeason(seasons: readonly SeasonGroup[], progress: PlaybackProgressMap): SeasonGroup | undefined {
  const [latest] = seasons.flatMap((season, index) => season.entries.flatMap((entry) => {
    const saved = progress[entry.rel];
    return saved === undefined ? [] : [{ index, updatedAt: saved.updatedAt }];
  })).toSorted((a, b) => b.updatedAt - a.updatedAt);
  if (latest === undefined) {
    return seasons[0];
  }
  return seasons.slice(latest.index).find((season) => hasUnwatched(season, progress)) ?? seasons[latest.index];
}

/** How much of a season is watched, from 0 to 1. */
export function seasonWatchedRatio(season: SeasonGroup, progress: PlaybackProgressMap): number {
  const watched = season.entries.filter((entry) => progress[entry.rel]?.completed === true).length;
  return season.entries.length === 0 ? 0 : watched / season.entries.length;
}

export interface SeasonRailLabel {
  readonly title: string;
  readonly detail: string | null;
}

/** "R2" rather than "Show: R2" under a season of that show. */
function withoutShowTitle(title: string, showTitle: string | undefined): string | null {
  if (showTitle === undefined || !title.startsWith(showTitle)) {
    return title;
  }
  const rest = title.slice(showTitle.length).replace(/^[\s:–—-]+/u, "");
  return rest === "" ? null : rest;
}

/** A numbered season reads "Season 2" with its own title under it; anything else goes by its title alone. Either drops the show's name. */
export function seasonRailLabel(season: SeasonGroup, media: AniListMedia | undefined, showMedia: AniListMedia | undefined): SeasonRailLabel {
  const name = media === undefined ? seasonDisplayName(season) : mediaTitle(media);
  const number = isMovieMedia(media) ? undefined : statedSeasonNumber(season, media);
  const own = withoutShowTitle(name, showMedia === undefined ? undefined : mediaTitle(showMedia));
  return number === undefined ? { title: own ?? name, detail: null } : { title: `Season ${String(number)}`, detail: own };
}
