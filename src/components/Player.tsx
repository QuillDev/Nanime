import { useCallback, useRef, useState, type SyntheticEvent } from "react";
import Hls from "hls.js";
import type { MediaEntry, PlaybackProgress } from "../types.ts";
import { hlsUrl, streamUrl } from "../api.ts";
import { useSavePlaybackProgress } from "../hooks/usePlaybackProgress.ts";
import { useSubtitleTracks } from "../hooks/useSubtitleTracks.ts";
import { hasMeaningfulPlaybackProgress } from "../lib/playback.ts";
import { SubtitleTracks } from "./SubtitleTracks.tsx";
import { EpisodeNavigation, PlayerDescription } from "./EpisodeNavigation.tsx";
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
}

function tryPlay(video: HTMLVideoElement): void {
  void (async (): Promise<void> => {
    try {
      await video.play();
    } catch {
      // Autoplay may be blocked by the browser; the user can press play.
    }
  })();
}

function bindHlsEvents(
  hls: Hls,
  video: HTMLVideoElement,
  onError: (message: string) => void,
): void {
  let recoveredMediaError = false;
  hls.on(Hls.Events.MANIFEST_PARSED, () => {
    tryPlay(video);
  });
  hls.on(Hls.Events.ERROR, (_event, data) => {
    if (!data.fatal) {
      return;
    }
    if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !recoveredMediaError) {
      recoveredMediaError = true;
      hls.recoverMediaError();
      return;
    }
    onError(`Playback failed: ${data.details}.`);
  });
}

function attachNativeHls(
  video: HTMLVideoElement,
  url: string,
  onError: (message: string) => void,
): void {
  if (video.canPlayType("application/vnd.apple.mpegurl") === "") {
    onError("This browser does not support HLS video playback.");
    return;
  }
  video.src = url;
  tryPlay(video);
}

// Direct-playable containers use the byte-range /stream endpoint (native
// seeking); everything else uses a VOD HLS playlist whose full duration is
// known up front, so the scrubber can seek freely and segments are transcoded
// on demand from the sought timestamp.
function attachHls(
  video: HTMLVideoElement,
  url: string,
  onError: (message: string) => void,
): (() => void) | undefined {
  // Prefer hls.js whenever MediaSource is available. Some browsers report that
  // they can play the HLS MIME type but cannot actually append MPEG-TS media;
  // trusting canPlayType first leaves the duration visible but fails decoding.
  if (!Hls.isSupported()) {
    attachNativeHls(video, url, onError);
    return undefined;
  }
  const hls = new Hls({ enableWorker: true });
  bindHlsEvents(hls, video, onError);
  hls.loadSource(url);
  hls.attachMedia(video);
  return () => {
    hls.destroy();
  };
}

function attachSource(
  video: HTMLVideoElement,
  entry: MediaEntry,
  onError: (message: string) => void,
): (() => void) | undefined {
  if (entry.direct) {
    video.src = streamUrl(entry.rel);
    tryPlay(video);
    return undefined;
  }
  return attachHls(video, hlsUrl(entry.rel), onError);
}

interface VideoSourceState {
  readonly playbackError: string | null;
  readonly videoRef: React.RefObject<HTMLVideoElement | null>;
  readonly setVideo: (video: HTMLVideoElement | null) => (() => void) | undefined;
  readonly handleVideoError: () => void;
  readonly handlePlaying: () => void;
}

function useVideoSource(entry: MediaEntry): VideoSourceState {
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const setVideo = useCallback(
    (video: HTMLVideoElement | null): (() => void) | undefined => {
      if (video === null) {
        return undefined;
      }
      videoRef.current = video;
      try {
        const detachSource = attachSource(video, entry, setPlaybackError);
        return () => {
          videoRef.current = null;
          detachSource?.();
        };
      } catch (error: unknown) {
        setPlaybackError(
          error instanceof Error ? error.message : "Failed to start playback.",
        );
        return undefined;
      }
    },
    [entry],
  );
  const handleVideoError = useCallback(() => {
    setPlaybackError("This video could not be played.");
  }, []);
  const handlePlaying = useCallback(() => {
    setPlaybackError(null);
  }, []);
  return { playbackError, videoRef, setVideo, handleVideoError, handlePlaying };
}

interface PlaybackHandlers {
  readonly saveCurrentProgress: (video: HTMLVideoElement, completed: boolean) => void;
  readonly handleLoadedMetadata: (event: SyntheticEvent<HTMLVideoElement>) => void;
  readonly handleTimeUpdate: (event: SyntheticEvent<HTMLVideoElement>) => void;
  readonly handlePause: (event: SyntheticEvent<HTMLVideoElement>) => void;
  readonly handleSeeked: (event: SyntheticEvent<HTMLVideoElement>) => void;
  readonly handleEnded: (event: SyntheticEvent<HTMLVideoElement>) => void;
}

function usePlaybackHandlers(entry: MediaEntry, resumeAt: number): PlaybackHandlers {
  const lastSavedAtRef = useRef<number>(0);
  const { mutate: savePlayback } = useSavePlaybackProgress();
  const saveCurrentProgress = useCallback((video: HTMLVideoElement, completed: boolean) => {
    const { currentTime: position, duration } = video;
    if (
      !Number.isFinite(position) ||
      !hasMeaningfulPlaybackProgress(position) ||
      !Number.isFinite(duration)
    ) {
      return;
    }
    lastSavedAtRef.current = Date.now();
    savePlayback({ rel: entry.rel, position, duration, completed });
  }, [entry.rel, savePlayback]);

  const handleLoadedMetadata = useCallback((event: SyntheticEvent<HTMLVideoElement>) => {
    const video = event.currentTarget;
    if (resumeAt > 0 && resumeAt < video.duration) {
      video.currentTime = resumeAt;
    }
  }, [resumeAt]);

  const handleTimeUpdate = useCallback((event: SyntheticEvent<HTMLVideoElement>) => {
    if (Date.now() - lastSavedAtRef.current >= 10_000) {
      saveCurrentProgress(event.currentTarget, false);
    }
  }, [saveCurrentProgress]);

  const handlePause = useCallback((event: SyntheticEvent<HTMLVideoElement>) => {
    if (!event.currentTarget.ended) {
      saveCurrentProgress(event.currentTarget, false);
    }
  }, [saveCurrentProgress]);

  const handleSeeked = useCallback((event: SyntheticEvent<HTMLVideoElement>) => {
    saveCurrentProgress(event.currentTarget, false);
  }, [saveCurrentProgress]);

  const handleEnded = useCallback((event: SyntheticEvent<HTMLVideoElement>) => {
    saveCurrentProgress(event.currentTarget, true);
  }, [saveCurrentProgress]);
  return {
    saveCurrentProgress,
    handleLoadedMetadata,
    handleTimeUpdate,
    handlePause,
    handleSeeked,
    handleEnded,
  };
}

export function Player({
  entry,
  nextAvailable,
  previousAvailable,
  initialProgress,
  onClose,
  onNext,
  onPrevious,
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
  } = useVideoSource(entry);
  const {
    saveCurrentProgress,
    handleLoadedMetadata,
    handleTimeUpdate,
    handlePause,
    handleSeeked,
    handleEnded,
  } = usePlaybackHandlers(entry, resumeAt);
  const subtitles = useSubtitleTracks(entry.rel);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        if (videoRef.current !== null && !videoRef.current.ended) {
          saveCurrentProgress(videoRef.current, false);
        }
        onClose();
      }
    },
    [onClose, saveCurrentProgress, videoRef],
  );

  return (
    <Dialog open onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="truncate pr-8">{entry.name}</DialogTitle>
          <DialogDescription>
            <PlayerDescription entry={entry} resumeAt={resumeAt} />
          </DialogDescription>
        </DialogHeader>
        <video
          ref={setVideo}
          controls
          playsInline
          onError={handleVideoError}
          onPlaying={handlePlaying}
          onLoadedMetadata={handleLoadedMetadata}
          onTimeUpdate={handleTimeUpdate}
          onPause={handlePause}
          onSeeked={handleSeeked}
          onEnded={handleEnded}
          className="max-h-[70vh] w-full rounded-md bg-black"
        >
          <track kind="captions" />
          <SubtitleTracks rel={entry.rel} tracks={subtitles.data} />
        </video>
        {subtitles.status === "success" && subtitles.data.length === 0 && (
          <p className="text-sm text-muted-foreground">No compatible embedded subtitles found.</p>
        )}
        {subtitles.status === "error" && (
          <p className="text-sm text-destructive">
            Failed to load subtitles: {subtitles.error.message}
          </p>
        )}
        {playbackError !== null && (
          <p className="text-sm text-destructive">{playbackError}</p>
        )}
        <EpisodeNavigation
          previousAvailable={previousAvailable}
          nextAvailable={nextAvailable}
          onPrevious={onPrevious}
          onNext={onNext}
        />
      </DialogContent>
    </Dialog>
  );
}
