import { useCallback, useEffect, useMemo, useRef, useState, type SyntheticEvent } from "react";
import type { PlayerPanelName } from "../components/PlayerChrome.tsx";
import type { SubtitleAppearance } from "../components/PlayerTracks.tsx";
import type { SubtitleTrack } from "../types.ts";
import { ControlVisibilityController } from "../lib/controlVisibility.ts";
import type { PlaybackHandlers } from "./usePlayerProgress.ts";
import type { VideoControls } from "./useVideoControls.ts";

export { usePlayerSurfaceInteraction } from "./usePlayerSurfaceInteraction.ts";
const EMPTY_SUBTITLES: readonly SubtitleTrack[] = [];
const DEFAULT_APPEARANCE: SubtitleAppearance = { size: "medium" };
const APPEARANCE_KEY = "nanime-subtitle-appearance-v1";

function parseAppearance(value: unknown): SubtitleAppearance {
  if (typeof value === "object" && value !== null && "size" in value) {
    const { size } = value;
    if (size === "small" || size === "medium" || size === "large") {
      return { size };
    }
  }
  return DEFAULT_APPEARANCE;
}

function loadAppearance(): SubtitleAppearance {
  try {
    const stored = localStorage.getItem(APPEARANCE_KEY);
    return stored === null ? DEFAULT_APPEARANCE : parseAppearance(JSON.parse(stored));
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

export function subtitleClass(appearance: SubtitleAppearance): string {
  return `player-subtitle player-subtitle-${appearance.size} max-w-[90%] whitespace-pre-line text-center font-semibold leading-snug text-white`;
}

function subtitlePreference(track: SubtitleTrack): number {
  const english = /^(?:en|eng)$/iu.test(track.language) ? 100 : 0;
  const signsOnly = /signs?|songs?/iu.test(track.label) ? -50 : 0;
  const closedCaptions = /\bcc\b|\[cc\]/iu.test(track.label) ? -10 : 0;
  const plainEnglish = /^english$/iu.test(track.label.trim()) ? 20 : 0;
  return english + signsOnly + closedCaptions + plainEnglish;
}

function preferredSubtitleIndex(tracks: readonly SubtitleTrack[] | undefined): number | null {
  return (tracks ?? EMPTY_SUBTITLES).reduce<SubtitleTrack | null>((preferred, track) => (
    preferred === null || subtitlePreference(track) > subtitlePreference(preferred)
      ? track
      : preferred
  ), null)?.index ?? null;
}

export function useControlVisibility() {
  const [visible, setVisible] = useState(true);
  const controllerRef = useRef<ControlVisibilityController | null>(null);
  controllerRef.current ??= new ControlVisibilityController(setVisible);
  const handleActivity = useCallback(() => controllerRef.current?.activity(), []);
  const handleInteractionStart = useCallback(() => (
    controllerRef.current?.interactionStart()
  ), []);
  const handleInteractionEnd = useCallback(() => (
    controllerRef.current?.interactionEnd()
  ), []);
  const handleHide = useCallback(() => controllerRef.current?.hide(), []);
  useEffect(() => () => controllerRef.current?.dispose(), []);
  return {
    visible,
    handleActivity,
    handleHide,
    handleInteractionStart,
    handleInteractionEnd,
  };
}

export function useSubtitleDisplay(tracks: readonly SubtitleTrack[] | undefined) {
  const [trackSelection, setTrackSelection] = useState<number | null | undefined>(undefined);
  const [cueText, setCueText] = useState("");
  const [appearance, setAppearance] = useState<SubtitleAppearance>(loadAppearance);
  const selectedTrack = trackSelection === undefined
    ? preferredSubtitleIndex(tracks)
    : trackSelection;
  const [videoAspect, setVideoAspect] = useState<number | null>(null);
  const handleVideoResize = useCallback((event: SyntheticEvent<HTMLVideoElement>) => {
    const { videoWidth, videoHeight } = event.currentTarget;
    setVideoAspect(videoWidth > 0 && videoHeight > 0 ? videoWidth / videoHeight : null);
  }, []);
  const pictureStyle = useMemo(() => (
    videoAspect === null
      ? undefined
      : { width: `min(100%, ${String(videoAspect * 100)}cqh)`, height: `min(100%, ${String(100 / videoAspect)}cqw)` }
  ), [videoAspect]);
  const handleAppearance = useCallback((nextAppearance: SubtitleAppearance) => {
    setAppearance(nextAppearance);
    try {
      localStorage.setItem(APPEARANCE_KEY, JSON.stringify(nextAppearance));
    } catch {
      // Browser privacy settings may disable storage; the in-memory setting still works.
    }
  }, []);
  return {
    appearance,
    cueText,
    pictureStyle,
    selectedTrack,
    handleAppearance,
    handleCueText: setCueText,
    handleTrack: setTrackSelection,
    handleVideoResize,
  };
}

/** Which side panel is open. A button opens its panel, or closes it when it is the one showing. */
export function usePlayerPanel() {
  const [panel, setPanel] = useState<PlayerPanelName | null>(null);
  const handleToggle = useCallback((name: PlayerPanelName) => {
    setPanel((open) => (open === name ? null : name));
  }, []);
  const handleParty = useCallback(() => {
    handleToggle("party");
  }, [handleToggle]);
  const handleClose = useCallback(() => {
    setPanel(null);
  }, []);
  return { panel, handleToggle, handleParty, handleClose };
}

interface PlaybackEventCallbacks {
  readonly onPlay: () => void;
  readonly onSourceMetadata: (event: SyntheticEvent<HTMLVideoElement>) => void;
}

export function usePlaybackEvents(
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
