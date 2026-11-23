import { useCallback, useState } from "react";
import type { AniListMedia, MediaEntry } from "../types.ts";
import { episodeMetadata, episodeNumber, mediaTitle } from "../lib/anilist.ts";
import { watchView } from "../lib/episodeWatch.ts";
import { isMovieMedia, primaryShowMetadata, seasonMetadata, type SeasonGroup } from "../lib/library.ts";
import { playingShow, type PlayerLibrary } from "../lib/playerLibrary.ts";
import { seasonKey, seasonRailLabel } from "../lib/seasonRail.ts";
import { cn } from "../lib/utils.ts";
import { MediaThumbnail } from "./MediaThumbnail.tsx";
import { PlayerPanel } from "./PlayerPanel.tsx";

function episodeTitle(entry: MediaEntry, media: AniListMedia | undefined): string {
  if (isMovieMedia(media)) {
    return mediaTitle(media);
  }
  const title = episodeMetadata(entry, media)?.title ?? entry.name;
  const number = episodeNumber(entry);
  return number === null ? title : `${String(number)}. ${title}`;
}

function scrollToPlaying(row: HTMLElement | null): void {
  row?.scrollIntoView({ block: "center" });
}

interface EpisodeOptionProps {
  readonly entry: MediaEntry;
  readonly media: AniListMedia | undefined;
  readonly playing: boolean;
  readonly library: PlayerLibrary;
}

function EpisodeOption({ entry, media, playing, library }: EpisodeOptionProps): React.JSX.Element {
  const { onSelect } = library;
  const handleClick = useCallback(() => {
    onSelect(entry);
  }, [entry, onSelect]);
  const watch = watchView(entry, library.progress);
  const thumbnail = isMovieMedia(media) ? undefined : episodeMetadata(entry, media)?.thumbnail;
  return (
    <button
      ref={playing ? scrollToPlaying : undefined}
      type="button"
      aria-current={playing}
      data-player-panel-start={playing ? "" : undefined}
      onClick={handleClick}
      className={cn("flex w-full items-center gap-3 rounded-[10px] p-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", playing ? "bg-white/15" : "hover:bg-white/10")}
    >
      <MediaThumbnail rel={entry.rel} source={thumbnail} sizes="124px" className="w-[92px] shrink-0 rounded-md lg:w-[124px]" />
      <span className="min-w-0 flex-1">
        <span className={cn("line-clamp-2 leading-snug", watch.watched && !playing && "text-foreground/60")} title={entry.name}>{episodeTitle(entry, media)}</span>
        {media?.duration !== null && media?.duration !== undefined && <span className="mt-0.5 block text-[13px] text-muted-foreground">{media.duration} min</span>}
        {watch.percent > 0 && <progress aria-label="Episode progress" max={100} value={watch.percent} className="playback-progress mt-1.5 block h-[3px] w-[90px] overflow-hidden rounded-full" />}
      </span>
    </button>
  );
}

interface SeasonTabProps {
  readonly season: SeasonGroup;
  readonly label: string;
  readonly active: boolean;
  readonly onSelect: (key: string) => void;
}

function SeasonTab({ season, label, active, onSelect }: SeasonTabProps): React.JSX.Element {
  const handleClick = useCallback(() => {
    onSelect(seasonKey(season));
  }, [onSelect, season]);
  return (
    <button type="button" aria-pressed={active} onClick={handleClick} className={cn("shrink-0 rounded-sm py-1 text-[15px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", active ? "font-semibold text-foreground" : "text-muted-foreground hover:text-foreground")}>
      {label}
    </button>
  );
}

interface PlayerEpisodesProps {
  readonly rel: string;
  readonly library: PlayerLibrary;
  readonly onClose: () => void;
}

/** The show's episodes, a season at a time, opening on the one that is playing. */
export function PlayerEpisodes({ rel, library, onClose }: PlayerEpisodesProps): React.JSX.Element | null {
  const playing = playingShow(library.shows, rel);
  const [picked, setPicked] = useState<string | null>(null);
  if (playing === null) {
    return null;
  }
  const { show } = playing;
  const season = show.seasons.find((candidate) => seasonKey(candidate) === picked) ?? playing.season;
  const showMedia = primaryShowMetadata(show, library.metadata);
  // An unmatched season borrows the show's match, as playback does for its titles.
  const media = seasonMetadata(library.metadata, season.sourceShow, season.name) ?? showMedia;
  return (
    <PlayerPanel title="Episodes" onClose={onClose}>
      {show.seasons.length > 1 && (
        <div className="-mx-1 mt-2 flex shrink-0 gap-[18px] overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
          {show.seasons.map((candidate) => (
            <SeasonTab key={seasonKey(candidate)} season={candidate} label={seasonRailLabel(candidate, seasonMetadata(library.metadata, candidate.sourceShow, candidate.name), showMedia).title} active={candidate === season} onSelect={setPicked} />
          ))}
        </div>
      )}
      <div className="-mx-2 mt-2 min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {season.entries.map((entry) => (
          <EpisodeOption key={entry.rel} entry={entry} media={media} playing={entry.rel === rel} library={library} />
        ))}
      </div>
    </PlayerPanel>
  );
}
