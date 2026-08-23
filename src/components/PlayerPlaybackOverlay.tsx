import { Pause, Play } from "lucide-react";
import { cn } from "../lib/utils.ts";

interface PlayerPlaybackOverlayProps {
  readonly paused: boolean;
  readonly controlsVisible: boolean;
  readonly onSurfacePointerUp: React.PointerEventHandler<HTMLButtonElement>;
  readonly onSurfaceClick: React.MouseEventHandler<HTMLButtonElement>;
  readonly onCenterPlayback: () => void;
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
        aria-label={paused ? "Show or hide player controls" : "Pause video or show player controls"}
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
