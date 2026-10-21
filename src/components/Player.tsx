import { WatchTogether, useWatchTogether, useWatchTogetherPosition } from "./WatchTogether.tsx";
import { useCallback } from "react";
import type {
  AniListPlaybackTarget,
  EpisodeDisplay,
  MediaEntry,
  PlaybackProgress,
  PreferredAudioLanguage,
} from "../types.ts";
import { usePlayerProgress, playerResumePosition } from "../hooks/usePlayerProgress.ts";
import { useVideoSource } from "../hooks/useVideoSource.ts";
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

// Focus the player itself rather than its first control, so OK and the arrows start out playing and seeking.
function focusPlayerFrame(event: Event): void {
  event.preventDefault();
  if (event.currentTarget instanceof HTMLElement) {
    event.currentTarget.focus();
  }
}

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
  readonly preferredAudioLanguage: PreferredAudioLanguage | null;
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
  preferredAudioLanguage,
}: PlayerProps): React.JSX.Element {
  const resumeAt = useWatchTogetherPosition(entry.rel, playerResumePosition(initialProgress));
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
    playbackMode,
  } = useVideoSource(entry, resumeAt, preferredAudioLanguage);
  const together = useWatchTogether({ rel: entry.rel, videoRef, playbackPosition, onSeek: handleTimelineSeek });
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
      <DialogContent onOpenAutoFocus={focusPlayerFrame} className="left-0 top-0 block h-[100dvh] max-h-none w-screen max-w-none translate-x-0 translate-y-0 gap-0 border-0 p-0 sm:rounded-none">
        <DialogHeader className="sr-only">
          <DialogTitle className="truncate pr-8">{entry.name}</DialogTitle>
          <DialogDescription>
            <PlayerDescription entry={entry} resumeAt={resumeAt} />
          </DialogDescription>
        </DialogHeader>
        <CopyableErrorBoundary title="The player encountered an error" onRecover={onClose}>
          <PlayerSurface
            playbackLocked={together.guestId !== null}
            entry={entry}
            preferredAudioLanguage={preferredAudioLanguage}
            playbackMode={playbackMode}
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
            previousAvailable={previousAvailable && together.guestId === null}
            nextAvailable={nextAvailable && together.guestId === null}
            onPrevious={onPrevious}
            onNext={onNext}
          >
            {entry.offlineUrl === undefined && <WatchTogether session={together} videoRef={videoRef} />}
          </PlayerSurface>
        </CopyableErrorBoundary>
        {playbackError !== null && (
          <CopyablePlaybackError detail={playbackError} />
        )}
      </DialogContent>
    </Dialog>
  );
}
