import { useCallback } from "react";
import type {
  AniListPlaybackTarget,
  EpisodeDisplay,
  MediaEntry,
  PlaybackProgress,
} from "../types.ts";
import { usePlayerProgress } from "../hooks/usePlayerProgress.ts";
import { useVideoSource } from "../hooks/useVideoSource.ts";
import { hasMeaningfulPlaybackProgress } from "../lib/playback.ts";
import { PlayerDescription } from "./EpisodeNavigation.tsx";
import { CopyableErrorBoundary } from "./CopyableErrorBoundary.tsx";
import { CopyablePlaybackError } from "./CopyablePlaybackError.tsx";
import { PlayerSurface } from "./PlayerSurface.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog.tsx";

interface PlayerProps {
  readonly entry: MediaEntry;
  readonly episodeDisplay: EpisodeDisplay | null;
  readonly nextAvailable: boolean;
  readonly previousAvailable: boolean;
  readonly initialProgress: PlaybackProgress | undefined;
  readonly onClose: () => void;
  readonly onNext: () => void;
  readonly onPrevious: () => void;
  readonly anilistTarget: AniListPlaybackTarget | null;
  readonly knownDuration: number;
}

export function Player({
  entry,
  episodeDisplay,
  nextAvailable,
  previousAvailable,
  initialProgress,
  onClose,
  onNext,
  onPrevious,
  anilistTarget,
  knownDuration,
}: PlayerProps): React.JSX.Element {
  const resumeAt = initialProgress?.completed === false &&
    hasMeaningfulPlaybackProgress(initialProgress.position)
    ? initialProgress.position
    : 0;
  const {
    playbackError,
    videoRef,
    setVideo,
    handleVideoError,
    handlePlaying,
    handleSourceMetadata,
    handleAudioTrack,
    handleTimelineSeek,
    timelineOffset,
    playbackPosition,
  } = useVideoSource(entry, resumeAt);
  const progress = usePlayerProgress({
    anilistTarget,
    entry,
    knownDuration,
    resumeAt,
    timelineOffset,
    playbackPosition,
  });

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        if (videoRef.current !== null && !videoRef.current.ended && !videoRef.current.paused) {
          progress.saveCurrentProgress(videoRef.current, false, "stopped");
        }
        onClose();
      }
    },
    [onClose, progress, videoRef],
  );

  return (
    <Dialog open onOpenChange={handleOpenChange}>
      <DialogContent className="left-0 top-0 block h-[100dvh] max-h-none w-screen max-w-none translate-x-0 translate-y-0 gap-0 border-0 p-0 sm:rounded-none">
        <DialogHeader className="sr-only">
          <DialogTitle className="truncate pr-8">{entry.name}</DialogTitle>
          <DialogDescription>
            <PlayerDescription entry={entry} resumeAt={resumeAt} />
          </DialogDescription>
        </DialogHeader>
        <CopyableErrorBoundary title="The player encountered an error" onRecover={onClose}>
          <PlayerSurface
            entry={entry}
            episodeDisplay={episodeDisplay}
            timelineOffset={timelineOffset}
            knownDuration={knownDuration}
            videoRef={videoRef}
            setVideo={setVideo}
            handleVideoError={handleVideoError}
            handlePlaying={handlePlaying}
            handleSourceMetadata={handleSourceMetadata}
            onAudioTrack={handleAudioTrack}
            onTimelineSeek={handleTimelineSeek}
            playbackPosition={playbackPosition}
            progress={progress}
            previousAvailable={previousAvailable}
            nextAvailable={nextAvailable}
            onPrevious={onPrevious}
            onNext={onNext}
          />
        </CopyableErrorBoundary>
        {playbackError !== null && (
          <CopyablePlaybackError detail={playbackError} />
        )}
      </DialogContent>
    </Dialog>
  );
}
