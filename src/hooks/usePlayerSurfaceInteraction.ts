import {
  useCallback,
  useEffect,
  useRef,
  type MouseEvent,
  type PointerEvent,
  type RefObject,
} from "react";
import { usePlayerRemote } from "./usePlayerRemote.ts";

const DOUBLE_TAP_DELAY_MS = 300;
type TapZone = "left" | "center" | "right";

interface PendingTap {
  readonly zone: TapZone;
  readonly timer: ReturnType<typeof setTimeout>;
}

interface PlayerSurfaceInteractionOptions {
  readonly playerRef: RefObject<HTMLDivElement | null>;
  readonly controlsVisible: boolean;
  readonly onTogglePlayback: () => void;
  readonly onShowControls: () => void;
  readonly onHideControls: () => void;
  readonly onSeekBy: (seconds: number) => void;
}

function tapZone(event: PointerEvent<HTMLButtonElement>): TapZone {
  const bounds = event.currentTarget.getBoundingClientRect();
  const position = (event.clientX - bounds.left) / bounds.width;
  if (position < 0.35) {
    return "left";
  }
  return position > 0.65 ? "right" : "center";
}

function handleCenterTap(
  zone: TapZone,
  clearPending: () => void,
  handleSingleTap: () => void,
): boolean {
  if (zone !== "center") {
    return false;
  }
  clearPending();
  handleSingleTap();
  return true;
}

function handleRepeatedTap({
  zone,
  pending,
  clearPending,
  onSeekBy,
}: {
  readonly zone: TapZone;
  readonly pending: PendingTap | null;
  readonly clearPending: () => void;
  readonly onSeekBy: (seconds: number) => void;
}): boolean {
  if (pending?.zone !== zone) {
    return false;
  }
  clearPending();
  onSeekBy(zone === "left" ? -10 : 10);
  return true;
}

function scheduleTap(
  zone: TapZone,
  pendingRef: RefObject<PendingTap | null>,
  handleSingleTap: () => void,
): void {
  const timer = setTimeout(() => {
    pendingRef.current = null;
    handleSingleTap();
  }, DOUBLE_TAP_DELAY_MS);
  pendingRef.current = { zone, timer };
}

function useTouchTaps({
  controlsVisible,
  onShowControls,
  onHideControls,
  onSeekBy,
}: Pick<PlayerSurfaceInteractionOptions,
  "controlsVisible" | "onShowControls" | "onHideControls" | "onSeekBy"
>): (event: PointerEvent<HTMLButtonElement>) => void {
  const pendingRef = useRef<PendingTap | null>(null);
  const handleSingleTap = useCallback(() => {
    if (controlsVisible) {
      onHideControls();
    } else {
      onShowControls();
    }
  }, [controlsVisible, onHideControls, onShowControls]);
  const clearPending = useCallback(() => {
    if (pendingRef.current !== null) {
      clearTimeout(pendingRef.current.timer);
      pendingRef.current = null;
    }
  }, []);
  const handleTouchTap = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    const zone = tapZone(event);
    const pending = pendingRef.current;
    if (handleCenterTap(zone, clearPending, handleSingleTap)) {
      return;
    }
    if (handleRepeatedTap({ zone, pending, clearPending, onSeekBy })) {
      return;
    }
    if (pending !== null) {
      clearPending();
      handleSingleTap();
    }
    scheduleTap(zone, pendingRef, handleSingleTap);
  }, [clearPending, handleSingleTap, onSeekBy]);
  useEffect(() => clearPending, [clearPending]);
  return handleTouchTap;
}

export function usePlayerSurfaceInteraction({
  playerRef,
  controlsVisible,
  onTogglePlayback,
  onShowControls,
  onHideControls,
  onSeekBy,
}: PlayerSurfaceInteractionOptions) {
  const handleTouchTap = useTouchTaps({
    controlsVisible,
    onShowControls,
    onHideControls,
    onSeekBy,
  });
  usePlayerRemote({ playerRef, controlsVisible, onActivity: onShowControls, onTogglePlayback, onSeekBy });
  const handleDesktopSurface = useCallback(() => {
    if (controlsVisible) {
      onHideControls();
    } else {
      onShowControls();
    }
  }, [controlsVisible, onHideControls, onShowControls]);
  const handleSurfacePointerUp = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === "touch" || event.pointerType === "pen") {
      handleTouchTap(event);
      return;
    }
    handleDesktopSurface();
  }, [handleDesktopSurface, handleTouchTap]);
  const handleSurfaceClick = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    if (event.detail === 0) {
      handleDesktopSurface();
    }
  }, [handleDesktopSurface]);
  const handlePointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse") {
      onShowControls();
    }
  }, [onShowControls]);
  const handleCenterPlayback = useCallback(() => {
    onTogglePlayback();
    onShowControls();
  }, [onShowControls, onTogglePlayback]);
  return {
    handleSurfacePointerUp,
    handleSurfaceClick,
    handlePointerMove,
    handleCenterPlayback,
  };
}
