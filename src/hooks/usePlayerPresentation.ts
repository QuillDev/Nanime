import { useCallback, useEffect, useRef, useState } from "react";
import type { SubtitleAppearance } from "../components/PlayerControls.tsx";
import type { SubtitleTrack } from "../types.ts";

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
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const interactionHeldRef = useRef(false);
  const handleActivity = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
    }
    setVisible(true);
    timerRef.current = interactionHeldRef.current
      ? null
      : setTimeout(() => setVisible(false), 2500);
  }, []);
  const handleInteractionStart = useCallback(() => {
    interactionHeldRef.current = true;
    handleActivity();
  }, [handleActivity]);
  const handleInteractionEnd = useCallback(() => {
    interactionHeldRef.current = false;
    handleActivity();
  }, [handleActivity]);
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const selectedTrack = trackSelection === undefined
    ? preferredSubtitleIndex(tracks)
    : trackSelection;
  const handleAppearance = useCallback((nextAppearance: SubtitleAppearance) => {
    setAppearance(nextAppearance);
    try {
      localStorage.setItem(APPEARANCE_KEY, JSON.stringify(nextAppearance));
    } catch {
      // Browser privacy settings may disable storage; the in-memory setting still works.
    }
  }, []);
  const handleToggleSettings = useCallback(() => setSettingsOpen((open) => !open), []);
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
