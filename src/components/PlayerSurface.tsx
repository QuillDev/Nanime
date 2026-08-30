import { useCallback, useRef, type SyntheticEvent } from "react";
import type { PlaybackHandlers } from "../hooks/usePlayerProgress.ts";
import { usePlayerVideo } from "../hooks/usePlayerVideo.ts";
import {
  subtitleClass,
  useControlVisibility,
  usePlayerSurfaceInteraction,
  useSubtitleDisplay,
} from "../hooks/usePlayerPresentation.ts";
import { useAudioSelection, useSubtitleTracks } from "../hooks/useSubtitleTracks.ts";
import type { VideoControls } from "../hooks/useVideoControls.ts";
import type { EpisodeDisplay, MediaEntry, SubtitleTrack } from "../types.ts";
import { PlayerControls } from "./PlayerControls.tsx";
import {
  PlayerDiagnostics,
  PlayerErrors,
  PlayerNowPlaying,
  PlayerPlaybackOverlay,
} from "./PlayerPlaybackOverlay.tsx";
import { SubtitleTracks } from "./SubtitleTracks.tsx";

const EMPTY_SUBTITLES: readonly SubtitleTrack[] = [];

interface PlaybackEventCallbacks {
  readonly onPlay: () => void;
  readonly onSourceMetadata: (event: SyntheticEvent<HTMLVideoElement>) => void;
}

function usePlaybackEvents(
  progress: PlaybackHandlers,
  controls: VideoControls,
  callbacks: PlaybackEventCallbacks,
) {
  const { onPlay, onSourceMetadata } = callbacks;
  const handlePlay = useCallback((event: SyntheticEvent<HTMLVideoElement>) => {
    controls.handlePlay();
    progress.handlePlay(event);
    onPlay();
  }, [controls, onPlay, progress]);
  const handleLoadedMetadata = useCallback((event: SyntheticEvent<HTMLVideoElement>) => {
    onSourceMetadata(event);
    progress.handleLoadedMetadata(event);
    controls.handleDurationChange(event);
  }, [controls, onSourceMetadata, progress]);
  const handlePause = useCallback((event: SyntheticEvent<HTMLVideoElement>) => {
    progress.handlePause(event);
    controls.handlePause();
  }, [controls, progress]);
  const handleEnded = useCallback((event: SyntheticEvent<HTMLVideoElement>) => {
    progress.handleEnded(event);
    controls.handlePause();
  }, [controls, progress]);
  return { handlePlay, handleLoadedMetadata, handlePause, handleEnded };
}

interface PlayerSurfaceProps {
  readonly entry: MediaEntry;
  readonly episodeDisplay: EpisodeDisplay | null;
  readonly timelineOffset: number;
  readonly knownDuration: number;
  readonly videoRef: React.RefObject<HTMLVideoElement | null>;
  readonly setVideo: (video: HTMLVideoElement | null) => (() => void) | undefined;
  readonly handleVideoError: (event: SyntheticEvent<HTMLVideoElement>) => void;
  readonly handlePlaying: () => void;
  readonly handleSourceMetadata: (event: SyntheticEvent<HTMLVideoElement>) => void;
  readonly progress: PlaybackHandlers;
  readonly previousAvailable: boolean; readonly nextAvailable: boolean;
  readonly onPrevious: () => void; readonly onNext: () => void;
  readonly onAudioTrack: (index: number) => void;
  readonly onTimelineSeek: (position: number) => void;
  readonly playbackPosition: (video: HTMLVideoElement) => number;
}

export function PlayerSurface({
  entry, episodeDisplay, timelineOffset, knownDuration, videoRef,
  setVideo, handleVideoError, handlePlaying, handleSourceMetadata, progress,
  previousAvailable, nextAvailable, onPrevious, onNext,
  onAudioTrack, onTimelineSeek, playbackPosition,
}: PlayerSurfaceProps): React.JSX.Element {
  const subtitles = useSubtitleTracks(entry.rel);
  const audio = useAudioSelection(entry.rel, onAudioTrack, entry.offlineUrl === undefined);
  const playerRef = useRef<HTMLDivElement | null>(null);
  const {
    buffering,
    controls,
    frameRef,
    frameVisible,
    handleBuffering,
    handleLoadStart,
    handleReady,
    handlePlayerPlaying,
    handlePlayerSeeked,
    handlePlayerTimeUpdate,
  } = usePlayerVideo({
    videoRef,
    playerRef,
    progress,
    onPlaying: handlePlaying,
    knownDuration,
    onTimelineSeek,
    playbackPosition,
  });
  const visibility = useControlVisibility();
  const playbackEvents = usePlaybackEvents(
    progress,
    controls,
    { onPlay: visibility.handleActivity, onSourceMetadata: handleSourceMetadata },
  );
  const display = useSubtitleDisplay(subtitles.data);
  const controlsVisible = visibility.visible || display.settingsOpen;
  const interaction = usePlayerSurfaceInteraction({
    controlsVisible,
    onTogglePlayback: controls.handleTogglePlayback,
    onShowControls: visibility.handleActivity,
    onHideControls: visibility.handleHide,
    onSeekBy: controls.handleSeekBy,
  });
  return (
    <div
      ref={playerRef}
      data-player-controls-visible={controlsVisible}
      className="relative h-full w-full overflow-hidden bg-black"
      onPointerMove={interaction.handlePointerMove}
    >
        <div className="relative flex h-full w-full items-center justify-center bg-black">
          <video
            ref={setVideo}
            crossOrigin="anonymous"
            playsInline
            onError={handleVideoError}
            onLoadStart={handleLoadStart}
            onLoadedData={handleReady}
            onCanPlay={handleReady}
            onWaiting={handleBuffering}
            onSeeking={handleBuffering}
            onPlaying={handlePlayerPlaying}
            onPlay={playbackEvents.handlePlay}
            onLoadedMetadata={playbackEvents.handleLoadedMetadata}
            onProgress={controls.handleProgress}
            onDurationChange={controls.handleDurationChange}
            onTimeUpdate={handlePlayerTimeUpdate}
            onPause={playbackEvents.handlePause}
            onSeeked={handlePlayerSeeked}
            onEnded={playbackEvents.handleEnded}
            className="h-full w-full bg-black object-contain"
          >
            <track kind="captions" />
            <SubtitleTracks rel={entry.rel} tracks={subtitles.data} selectedTrack={display.selectedTrack} timelineOffset={timelineOffset} onCueText={display.handleCueText} />
          </video>
          <canvas
            ref={frameRef}
            className={`pointer-events-none absolute inset-0 z-[1] h-full w-full bg-black object-contain${frameVisible ? "" : " hidden"}`}
            aria-hidden="true"
          />
          <PlayerPlaybackOverlay
            paused={controls.paused}
            buffering={buffering}
            controlsVisible={controlsVisible}
            onSurfacePointerUp={interaction.handleSurfacePointerUp}
            onSurfaceClick={interaction.handleSurfaceClick}
            onCenterPlayback={interaction.handleCenterPlayback}
          />
          <PlayerDiagnostics
            buffering={buffering}
            controlsVisible={controlsVisible}
            frameVisible={frameVisible}
            playbackMode={entry.direct ? "direct" : "hls"}
            videoRef={videoRef}
          />
          {controlsVisible && (
            <PlayerNowPlaying display={episodeDisplay} fallbackTitle={entry.name} />
          )}
          {display.cueText !== "" && (
            <div
              className="player-subtitle-position pointer-events-none absolute inset-x-0 z-10 flex justify-center px-3"
              aria-live="off"
            >
              <span className={subtitleClass(display.appearance)}>{display.cueText}</span>
            </div>
          )}
        </div>
        <div className={controlsVisible ? "absolute inset-x-0 bottom-0 z-30 visible" : "invisible absolute inset-x-0 bottom-0 z-30"}>
          <PlayerControls
            mediaPath={entry.rel}
            bufferedUntil={controls.bufferedUntil}
            currentTime={controls.currentTime}
            duration={controls.duration}
            muted={controls.muted}
            volume={controls.volume}
            fullscreen={controls.fullscreen}
            previousAvailable={previousAvailable}
            nextAvailable={nextAvailable}
            tracks={subtitles.data ?? EMPTY_SUBTITLES}
            audioTracks={audio.tracks}
            selectedAudioTrack={audio.selectedTrack}
            selectedTrack={display.selectedTrack}
            appearance={display.appearance}
            settingsOpen={display.settingsOpen}
            onTimelineInteractionEnd={visibility.handleInteractionEnd}
            onTimelineInteractionStart={visibility.handleInteractionStart}
            onSeek={controls.handleSeek}
            onSeekBy={controls.handleSeekBy}
            onVolume={controls.handleVolume}
            onToggleMuted={controls.handleToggleMuted}
            onToggleFullscreen={controls.handleToggleFullscreen}
            onPrevious={onPrevious}
            onNext={onNext}
            onToggleSettings={display.handleToggleSettings}
            onTrack={display.handleTrack}
            onAudioTrack={audio.handleTrack}
            onAppearance={display.handleAppearance}
          />
        </div>
        <PlayerErrors
          noSubtitles={subtitles.status === "success" && subtitles.data.length === 0}
          controlsVisible={controlsVisible}
          subtitleError={subtitles.error}
          audioError={audio.error}
          fullscreenError={controls.fullscreenError}
        />
    </div>
  );
}
