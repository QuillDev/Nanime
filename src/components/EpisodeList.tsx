import { useCallback } from "react";
import type {
  AniListMedia,
  AniListPlaybackTarget,
  MediaEntry,
  PlaybackProgressMap,
} from "../types.ts";
import type { EpisodeTranscodeState, SeasonTranscodeSummary } from "../lib/seasonTranscode.ts";
import { useSetPlaybackWatched } from "../hooks/usePlaybackProgress.ts";
import { useSeriesCompletionPrompt } from "./SeriesCompletionPrompt.tsx";
import { EpisodeRow } from "./EpisodeRow.tsx";

const READY: EpisodeTranscodeState = { kind: "ready" };

interface EpisodeListProps {
  readonly entries: readonly MediaEntry[];
  readonly media: AniListMedia | undefined;
  readonly progress: PlaybackProgressMap;
  readonly onSelect: (entry: MediaEntry) => void;
  readonly transcode: SeasonTranscodeSummary;
  readonly canRename: boolean;
}

export function EpisodeList({
  entries,
  media,
  progress,
  onSelect,
  transcode,
  canRename,
}: EpisodeListProps): React.JSX.Element {
  const watchedState = useSetPlaybackWatched();
  const promptForScore = useSeriesCompletionPrompt();
  const handleSetWatched = useCallback((
    rel: string,
    watched: boolean,
    target: AniListPlaybackTarget | null,
  ) => {
    const update = target === null
      ? { rel, watched }
      : {
        rel,
        watched,
        anilistMediaId: target.mediaId,
        episode: target.episode,
        totalEpisodes: target.totalEpisodes,
      };
    const entry = entries.find((item) => item.rel === rel);
    const identified = entry?.mediaIdentity === undefined ? update : { ...update, mediaIdentity: entry.mediaIdentity };
    watchedState.mutate(identified, {
      onSuccess: () => {
        if (watched && target !== null) {
          promptForScore(target);
        }
      },
    });
  }, [entries, promptForScore, watchedState]);
  return (
    <div>
      {watchedState.error !== null && (
        <p className="mb-3 text-sm text-destructive">
          Could not update episode: {watchedState.error.message}
        </p>
      )}
      <ul>
        {entries.map((entry) => (
          <EpisodeRow
            key={entry.rel}
            entry={entry}
            media={media}
            progress={progress}
            onSelect={onSelect}
            onSetWatched={handleSetWatched}
            pending={watchedState.isPending && watchedState.variables?.rel === entry.rel}
            transcode={transcode.episodes.get(entry.rel) ?? READY}
            canRename={canRename}
          />
        ))}
      </ul>
    </div>
  );
}
