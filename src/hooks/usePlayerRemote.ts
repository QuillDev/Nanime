import { useEffect, type RefObject } from "react";

interface PlayerRemoteOptions {
  readonly playerRef: RefObject<HTMLDivElement | null>;
  readonly controlsVisible: boolean;
  readonly onActivity: () => void;
  readonly onTogglePlayback: () => void;
  readonly onSeekBy: (seconds: number) => void;
}

const SEEK_SECONDS = 10;

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "SELECT" ||
    target.tagName === "TEXTAREA"
  );
}

/** A control the user moved to with the keyboard or remote; a mouse-clicked button doesn't count. */
function controlFocused(player: HTMLDivElement): boolean {
  const active = document.activeElement;
  return active instanceof HTMLElement && player.contains(active) && active.matches(":focus-visible");
}

type KeyAction = (options: PlayerRemoteOptions, player: HTMLDivElement) => void;

const toggle: KeyAction = (options) => options.onTogglePlayback();
const back: KeyAction = (options) => options.onSeekBy(-SEEK_SECONDS);
const forward: KeyAction = (options) => options.onSeekBy(SEEK_SECONDS);
// The play button, or the first control while it is replaced by the loading spinner. Hidden
// controls can't take focus, so this waits a frame for them to show.
const focusControls: KeyAction = (_options, player) => {
  requestAnimationFrame(() => {
    player.querySelector<HTMLElement>("[data-player-primary], [data-player-controls] button:not(:disabled)")?.focus();
  });
};

/**
 * Sliders keep all four arrows for their value, which would trap a remote on
 * the timeline; Down leaves it for the buttons below. True when handled.
 */
function handleSliderKey(event: KeyboardEvent, player: HTMLDivElement): boolean {
  const slider = event.target;
  if (!(slider instanceof HTMLInputElement) || slider.type !== "range" || !player.contains(slider)) {
    return false;
  }
  if (event.key === "ArrowDown") {
    event.preventDefault();
    player.querySelector<HTMLElement>("[data-player-controls] button:not(:disabled)")?.focus();
  }
  return true;
}

/** Media keys work wherever focus is. */
const MEDIA_KEYS = new Map<string, KeyAction>([
  ["MediaPlayPause", toggle],
  ["MediaPlay", toggle],
  ["MediaPause", toggle],
  ["MediaFastForward", forward],
  ["MediaRewind", back],
]);

/** Keys while no control has focus: arrows seek, OK/Space plays or pauses, Up/Down bring up the controls. */
const FREE_KEYS = new Map<string, KeyAction>([
  ["ArrowLeft", back],
  ["ArrowRight", forward],
  ["Enter", toggle],
  [" ", toggle],
  ["ArrowUp", focusControls],
  ["ArrowDown", focusControls],
]);

/**
 * Keyboard and TV remote control of the player. While a control has focus the
 * arrows move between controls (spatial navigation on TV) and only keep the
 * controls on screen; otherwise they seek. Media keys always work.
 */
export function usePlayerRemote(options: PlayerRemoteOptions): void {
  const { playerRef, controlsVisible, onActivity, onTogglePlayback, onSeekBy } = options;
  useEffect(() => {
    const actions = { playerRef, controlsVisible, onActivity, onTogglePlayback, onSeekBy };
    const handleKeyDown = (event: KeyboardEvent): void => {
      const player = playerRef.current;
      if (player === null) {
        return;
      }
      onActivity();
      if (handleSliderKey(event, player) || isEditableTarget(event.target)) {
        return;
      }
      const action = MEDIA_KEYS.get(event.key) ?? (controlFocused(player) ? undefined : FREE_KEYS.get(event.key));
      if (action !== undefined) {
        event.preventDefault();
        action(actions, player);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [controlsVisible, onActivity, onSeekBy, onTogglePlayback, playerRef]);
  // Hidden controls give focus back, so the next arrow seeks instead of moving inside an invisible bar.
  useEffect(() => {
    const active = document.activeElement;
    if (!controlsVisible && active instanceof HTMLElement && playerRef.current?.contains(active) === true) {
      active.blur();
    }
  }, [controlsVisible, playerRef]);
}
