import { useCallback, useEffect, useRef, useState, type SyntheticEvent } from "react";
import type { PlaybackHandlers } from "../hooks/usePlayerProgress.ts";
import { usePlayerSurfaceInteraction } from "../hooks/usePlayerSurfaceInteraction.ts";
import { useAudioSelection, useSubtitleTracks } from "../hooks/useSubtitleTracks.ts";
import { useVideoControls, type VideoControls } from "../hooks/useVideoControls.ts";
import { cn } from "../lib/utils.ts";
import type { MediaEntry, SubtitleTrack } from "../types.ts";
import {
  PlayerControls,
  type SubtitleAppearance,
} from "./PlayerControls.tsx";
import { PlayerErrors, PlayerPlaybackOverlay } from "./PlayerPlaybackOverlay.tsx";
import { SubtitleTracks } from "./SubtitleTracks.tsx";

const EMPTY_SUBTITLES: readonly SubtitleTrack[] = [];
const DEFAULT_SUBTITLE_APPEARANCE: SubtitleAppearance = { size: "medium" };
const SUBTITLE_APPEARANCE_KEY = "nanime-subtitle-appearance-v1";
function parseSubtitleAppearance(value: unknown): SubtitleAppearance {
  if (typeof value === "object" && value !== null) {
    const size = Reflect.get(value, "size");
    if (size === "small" || size === "medium" || size === "large") {
      return { size };
    }
  }
  return DEFAULT_SUBTITLE_APPEARANCE;
}
function loadSubtitleAppearance(): SubtitleAppearance {
  try {
    const stored = localStorage.getItem(SUBTITLE_APPEARANCE_KEY);
    if (stored === null) {
      return DEFAULT_SUBTITLE_APPEARANCE;
    }
    return parseSubtitleAppearance(JSON.parse(stored));
  } catch {
    return DEFAULT_SUBTITLE_APPEARANCE;
  }
}
function subtitleClass(appearance: SubtitleAppearance): string {
  return cn(
    "player-subtitle max-w-[90%] whitespace-pre-line text-center font-semibold leading-snug text-white",
    appearance.size === "small" && "player-subtitle-small",
    appearance.size === "medium" && "player-subtitle-medium",
    appearance.size === "large" && "player-subtitle-large",
  );
}
function subtitlePreference(track: SubtitleTrack): number {
  const english = /^(?:en|eng)$/iu.test(track.language) ? 100 : 0;
  const signsOnly = /signs?|songs?/iu.test(track.label) ? -50 : 0;
  const closedCaptions = /\bcc\b|\[cc\]/iu.test(track.label) ? -10 : 0;
  const plainEnglish = /^english$/iu.test(track.label.trim()) ? 20 : 0;
  return english + signsOnly + closedCaptions + plainEnglish;
}
function preferredSubtitleIndex(
  tracks: readonly SubtitleTrack[] | undefined,
): number | null {
  return (tracks ?? EMPTY_SUBTITLES).reduce<SubtitleTrack | null>((preferred, track) => (
    preferred === null || subtitlePreference(track) > subtitlePreference(preferred)
      ? track
      : preferred
  ), null)?.index ?? null;
}

function usePlaybackEvents(
  progress: PlaybackHandlers,
  controls: VideoControls,
  onPlay: () => void,
): {
  readonly handlePlay: () => void;
  readonly handleLoadedMetadata: (event: SyntheticEvent<HTMLVideoElement>) => void;
  readonly handleTimeUpdate: (event: SyntheticEvent<HTMLVideoElement>) => void;
  readonly handlePause: (event: SyntheticEvent<HTMLVideoElement>) => void;
  readonly handleEnded: (event: SyntheticEvent<HTMLVideoElement>) => void;
} {
  const handlePlay = useCallback(() => {
    controls.handlePlay();
    onPlay();
  }, [controls, onPlay]);
  const handleLoadedMetadata = useCallback((event: SyntheticEvent<HTMLVideoElement>) => {
    progress.handleLoadedMetadata(event);
    controls.handleDurationChange(event);
  }, [controls, progress]);
  const handleTimeUpdate = useCallback((event: SyntheticEvent<HTMLVideoElement>) => {
    progress.handleTimeUpdate(event);
    controls.handleTimeUpdate(event);
  }, [controls, progress]);
  const handlePause = useCallback((event: SyntheticEvent<HTMLVideoElement>) => {
    progress.handlePause(event);
    controls.handlePause();
  }, [controls, progress]);
  const handleEnded = useCallback((event: SyntheticEvent<HTMLVideoElement>) => {
    progress.handleEnded(event);
    controls.handlePause();
  }, [controls, progress]);
  return { handlePlay, handleLoadedMetadata, handleTimeUpdate, handlePause, handleEnded };
}

function useControlVisibility(): {
  readonly visible: boolean;
  readonly handleActivity: () => void;
  readonly handleHide: () => void;
} {
  const [visible, setVisible] = useState(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleActivity = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
    }
    setVisible(true);
    timerRef.current = setTimeout(() => {
      setVisible(false);
    }, 2500);
  }, []);
  const handleHide = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setVisible(false);
  }, []);
  useEffect(() => () => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
    }
  }, []);
  return { visible, handleActivity, handleHide };
}

function useSubtitleDisplay(tracks: readonly SubtitleTrack[] | undefined): {
  readonly appearance: SubtitleAppearance;
  readonly cueText: string;
  readonly selectedTrack: number | null;
  readonly settingsOpen: boolean;
  readonly handleAppearance: (appearance: SubtitleAppearance) => void;
  readonly handleCueText: React.Dispatch<React.SetStateAction<string>>;
  readonly handleTrack: React.Dispatch<React.SetStateAction<number | null | undefined>>;
  readonly handleToggleSettings: () => void;
} {
  const [trackSelection, setTrackSelection] = useState<number | null | undefined>(undefined);
  const [cueText, setCueText] = useState("");
  const [appearance, setAppearance] = useState<SubtitleAppearance>(loadSubtitleAppearance);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const selectedTrack = trackSelection === undefined
    ? preferredSubtitleIndex(tracks)
    : trackSelection;
  const handleAppearance = useCallback((nextAppearance: SubtitleAppearance) => {
    setAppearance(nextAppearance);
    try {
      localStorage.setItem(SUBTITLE_APPEARANCE_KEY, JSON.stringify(nextAppearance));
    } catch {
      // Browser privacy settings may disable storage; the in-memory setting still works.
    }
  }, []);
  const handleToggleSettings = useCallback(() => {
    setSettingsOpen((open) => !open);
  }, []);
  return {
    appearance,
    cueText,
    selectedTrack,
    settingsOpen,
    handleAppearance,
    handleCueText: setCueText,
    handleTrack: setTrackSelection,
    handleToggleSettings,
  };
}

interface PlayerSurfaceProps {
  readonly entry: MediaEntry;
  readonly videoRef: React.RefObject<HTMLVideoElement | null>;
  readonly setVideo: (video: HTMLVideoElement | null) => (() => void) | undefined;
  readonly handleVideoError: () => void;
  readonly handlePlaying: () => void;
  readonly progress: PlaybackHandlers;
  readonly previousAvailable: boolean; readonly nextAvailable: boolean;
  readonly onPrevious: () => void; readonly onNext: () => void;
  readonly onAudioTrack: (index: number) => void;
}

export function PlayerSurface({
  entry,
  videoRef,
  setVideo,
  handleVideoError,
  handlePlaying,
  progress,
  previousAvailable,
  nextAvailable,
  onPrevious,
  onNext,
  onAudioTrack,
}: PlayerSurfaceProps): React.JSX.Element {
  const subtitles = useSubtitleTracks(entry.rel);
  const audio = useAudioSelection(entry.rel, onAudioTrack);
  const playerRef = useRef<HTMLDivElement | null>(null);
  const controls = useVideoControls(videoRef, playerRef);
  const visibility = useControlVisibility();
  const playbackEvents = usePlaybackEvents(progress, controls, visibility.handleActivity);
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
            playsInline
            onError={handleVideoError}
            onPlaying={handlePlaying}
            onPlay={playbackEvents.handlePlay}
            onLoadedMetadata={playbackEvents.handleLoadedMetadata}
            onDurationChange={controls.handleDurationChange}
            onTimeUpdate={playbackEvents.handleTimeUpdate}
            onPause={playbackEvents.handlePause}
            onSeeked={progress.handleSeeked}
            onEnded={playbackEvents.handleEnded}
            className="h-full w-full bg-black object-contain"
          >
            <track kind="captions" />
            <SubtitleTracks rel={entry.rel} tracks={subtitles.data} selectedTrack={display.selectedTrack} onCueText={display.handleCueText} />
          </video>
          <PlayerPlaybackOverlay
            paused={controls.paused}
            controlsVisible={controlsVisible}
            onSurfacePointerUp={interaction.handleSurfacePointerUp}
            onSurfaceClick={interaction.handleSurfaceClick}
            onCenterPlayback={interaction.handleCenterPlayback}
          />
          {display.cueText !== "" && (
            <div
              className={cn(
                "pointer-events-none absolute inset-x-0 z-10 flex justify-center px-3",
                controlsVisible ? "bottom-24" : "player-subtitle-bottom",
              )}
              aria-live="off"
            >
              <span className={subtitleClass(display.appearance)}>{display.cueText}</span>
            </div>
          )}
        </div>
        <div className={controlsVisible ? "absolute inset-x-0 bottom-0 z-30 visible" : "invisible absolute inset-x-0 bottom-0 z-30"}>
          <PlayerControls
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
