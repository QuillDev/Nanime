import type { EpisodeDisplay, MediaEntry, PlaybackProgressMap, ShowMetadata } from "../types.ts";
import { mediaTitle } from "./anilist.ts";
import { isMovieMedia, primaryShowMetadata, seasonMetadata, seasonNumber, type SeasonGroup, type ShowGroup } from "./library.ts";

/** What the player needs from the library to name what is playing and list the show's other episodes. */
export interface PlayerLibrary {
  readonly shows: readonly ShowGroup[];
  readonly metadata: ShowMetadata;
  readonly progress: PlaybackProgressMap;
  readonly onSelect: (entry: MediaEntry) => void;
}

export interface PlayingShow {
  readonly show: ShowGroup;
  readonly season: SeasonGroup;
}

/** The show and season an episode belongs to. */
export function playingShow(shows: readonly ShowGroup[], rel: string): PlayingShow | null {
  for (const show of shows) {
    const season = show.seasons.find((candidate) => candidate.entries.some((entry) => entry.rel === rel));
    if (season !== undefined) {
      return { show, season };
    }
  }
  return null;
}

export interface PlayerHeading {
  readonly title: string;
  /** "S1E3 · The episode's title"; nothing for a movie. */
  readonly detail: string | null;
}

function episodeCode(playing: PlayingShow, library: PlayerLibrary, display: EpisodeDisplay | null): string | null {
  const media = seasonMetadata(library.metadata, playing.season.sourceShow, playing.season.name);
  if (isMovieMedia(media)) {
    return null;
  }
  const number = display?.number ?? null;
  return number === null ? null : `S${String(seasonNumber(playing.season, media))}E${String(number)}`;
}

/** The show's name over the episode's code and title. */
export function playerHeading(library: PlayerLibrary, entry: MediaEntry, display: EpisodeDisplay | null): PlayerHeading {
  const playing = playingShow(library.shows, entry.rel);
  const episodeTitle = display?.title ?? entry.name;
  if (playing === null) {
    return { title: episodeTitle, detail: null };
  }
  const showMedia = primaryShowMetadata(playing.show, library.metadata);
  const title = showMedia === undefined ? playing.show.name : mediaTitle(showMedia);
  const code = episodeCode(playing, library, display);
  if (code === null) {
    return { title, detail: episodeTitle === title ? null : episodeTitle };
  }
  return { title, detail: `${code} · ${episodeTitle}` };
}
