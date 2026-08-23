import { useCallback } from "react";
import type { AniListPlaybackTarget, MediaEntry, PlaybackProgress } from "../types.ts";
import { usePlayerProgress } from "../hooks/usePlayerProgress.ts";
import { useVideoSource } from "../hooks/useVideoSource.ts";
import { hasMeaningfulPlaybackProgress } from "../lib/playback.ts";
import { PlayerDescription } from "./EpisodeNavigation.tsx";
import { CopyableErrorBoundary } from "./CopyableErrorBoundary.tsx";
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
  readonly nextAvailable: boolean;
  readonly previousAvailable: boolean;
  readonly initialProgress: PlaybackProgress | undefined;
  readonly onClose: () => void;
  readonly onNext: () => void;
  readonly onPrevious: () => void;
  readonly anilistTarget: AniListPlaybackTarget | null;
}

export function Player({
  entry,
  nextAvailable,
  previousAvailable,
  initialProgress,
  onClose,
  onNext,
  onPrevious,
  anilistTarget,
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
    handleAudioTrack,
  } = useVideoSource(entry);
  const progress = usePlayerProgress(entry, resumeAt, anilistTarget);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        if (videoRef.current !== null && !videoRef.current.ended) {
          progress.saveCurrentProgress(videoRef.current, false);
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
            videoRef={videoRef}
            setVideo={setVideo}
            handleVideoError={handleVideoError}
            handlePlaying={handlePlaying}
            onAudioTrack={handleAudioTrack}
            progress={progress}
            previousAvailable={previousAvailable}
            nextAvailable={nextAvailable}
            onPrevious={onPrevious}
            onNext={onNext}
          />
        </CopyableErrorBoundary>
        {playbackError !== null && (
          <p className="absolute left-4 top-4 z-30 rounded-md bg-black px-3 py-2 text-sm text-destructive">
            {playbackError}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
