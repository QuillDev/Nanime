import { Pause, Play } from "lucide-react";
import { cn } from "../lib/utils.ts";

interface PlayerPlaybackOverlayProps {
  readonly paused: boolean;
  readonly controlsVisible: boolean;
  readonly onSurfacePointerUp: React.PointerEventHandler<HTMLButtonElement>;
  readonly onSurfaceClick: React.MouseEventHandler<HTMLButtonElement>;
  readonly onCenterPlayback: () => void;
}

interface PlayerErrorsProps {
  readonly noSubtitles: boolean;
  readonly controlsVisible: boolean;
  readonly subtitleError: Error | null;
  readonly audioError: Error | null;
  readonly fullscreenError: string | null;
}

export function PlayerErrors({
  noSubtitles,
  controlsVisible,
  subtitleError,
  audioError,
  fullscreenError,
}: PlayerErrorsProps): React.JSX.Element {
  return (
    <>
      {noSubtitles && controlsVisible && (
        <p className="absolute left-4 top-4 z-20 rounded-md bg-black px-3 py-2 text-sm text-muted-foreground">
          No compatible subtitles found.
        </p>
      )}
      {subtitleError !== null && (
        <p className="absolute left-4 top-4 z-20 rounded-md bg-black px-3 py-2 text-sm text-destructive">
          Failed to load subtitles: {subtitleError.message}
        </p>
      )}
      {audioError !== null && (
        <p className="absolute left-4 top-16 z-20 rounded-md bg-black px-3 py-2 text-sm text-destructive">
          Failed to load audio tracks: {audioError.message}
        </p>
      )}
      {fullscreenError !== null && (
        <pre className="absolute left-4 top-16 z-30 max-w-[calc(100%-2rem)] select-text overflow-auto rounded-md border border-destructive bg-black p-3 text-xs text-destructive">
          {fullscreenError}
        </pre>
      )}
    </>
  );
}

export function PlayerPlaybackOverlay({
  paused,
  controlsVisible,
  onSurfacePointerUp,
  onSurfaceClick,
  onCenterPlayback,
}: PlayerPlaybackOverlayProps): React.JSX.Element {
  return (
    <>
      <button
        type="button"
        className="absolute inset-0 z-10 touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        onPointerUp={onSurfacePointerUp}
        onClick={onSurfaceClick}
        aria-label="Show or hide player controls"
      />
      <button
        type="button"
        className={cn(
          "absolute left-1/2 top-1/2 z-20 flex size-20 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-primary text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          !paused && !controlsVisible && "invisible",
        )}
        onClick={onCenterPlayback}
        aria-label={paused ? "Play video" : "Pause video"}
      >
        {paused
          ? <Play className="ml-1 size-9 fill-current" />
          : <Pause className="size-9 fill-current" />}
      </button>
    </>
  );
}
