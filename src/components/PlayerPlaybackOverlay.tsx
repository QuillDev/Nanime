import { useCallback, useState, type RefObject } from "react";
import { ClipboardCopy } from "lucide-react";
import { cn } from "../lib/utils.ts";
import { copyText } from "../lib/clipboard.ts";
import { usePlaybackDiagnostics } from "../hooks/usePlaybackDiagnostics.ts";
import { usePlaybackDiagnosticsEnabled } from "../lib/playbackDiagnosticsPreference.ts";

interface PlayerPlaybackOverlayProps {
  readonly onSurfacePointerUp: React.PointerEventHandler<HTMLButtonElement>;
  readonly onSurfaceClick: React.MouseEventHandler<HTMLButtonElement>;
}

interface PlayerErrorsProps {
  readonly subtitleError: Error | null;
  readonly audioError: Error | null;
  readonly fullscreenError: string | null;
}

interface PlayerDiagnosticsProps {
  readonly buffering: boolean;
  readonly controlsVisible: boolean;
  readonly frameVisible: boolean;
  readonly playbackMode: "direct" | "hls";
  readonly videoRef: RefObject<HTMLVideoElement | null>;
}

function diagnosticLabel(status: "failed" | "idle" | "success"): string {
  if (status === "success") {
    return "Diagnostics copied";
  }
  return status === "failed" ? "Copy failed" : "Copy diagnostics";
}

export function PlayerDiagnostics({
  buffering,
  controlsVisible,
  frameVisible,
  playbackMode,
  videoRef,
}: PlayerDiagnosticsProps): React.JSX.Element | null {
  const enabled = usePlaybackDiagnosticsEnabled();
  const [status, setStatus] = useState<"failed" | "idle" | "success">("idle");
  const createReport = usePlaybackDiagnostics(videoRef, playbackMode, enabled);
  const handleCopy = useCallback(() => {
    void (async (): Promise<void> => {
      setStatus(await copyText(createReport(buffering, frameVisible)) ? "success" : "failed");
    })();
  }, [buffering, createReport, frameVisible]);
  if (!enabled || !buffering && !controlsVisible) {
    return null;
  }
  return (
    <button
      type="button"
      onClick={handleCopy}
      className={cn(
        "absolute z-30 flex items-center gap-2 rounded-md bg-secondary px-3 py-2 text-xs font-semibold text-secondary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        buffering
          ? "player-diagnostics-reveal left-1/2 top-[calc(50%+3.5rem)] -translate-x-1/2"
          : "right-4 top-[max(4.5rem,calc(env(safe-area-inset-top)+3.5rem))]",
      )}
    >
      <ClipboardCopy className="size-3.5" />
      {status === "idle" ? "Copy 2 min diagnostics" : diagnosticLabel(status)}
    </button>
  );
}

/** Problems loading tracks or going fullscreen, under the title. */
export function PlayerErrors({ subtitleError, audioError, fullscreenError }: PlayerErrorsProps): React.JSX.Element {
  return (
    <div className="pointer-events-none absolute left-4 top-20 z-30 grid max-w-[calc(100%-2rem)] justify-items-start gap-2">
      {subtitleError !== null && (
        <p className="rounded-md bg-black px-3 py-2 text-sm text-destructive">
          Failed to load subtitles: {subtitleError.message}
        </p>
      )}
      {audioError !== null && (
        <p className="rounded-md bg-black px-3 py-2 text-sm text-destructive">
          Failed to load audio tracks: {audioError.message}
        </p>
      )}
      {fullscreenError !== null && (
        <pre className="pointer-events-auto max-w-full select-text overflow-auto rounded-md border border-destructive bg-black p-3 text-xs text-destructive">
          {fullscreenError}
        </pre>
      )}
    </div>
  );
}

/** The picture itself: a tap or click shows or hides the controls. */
export function PlayerPlaybackOverlay({ onSurfacePointerUp, onSurfaceClick }: PlayerPlaybackOverlayProps): React.JSX.Element {
  return (
    <button
      type="button"
      tabIndex={-1}
      className="player-surface-interaction absolute inset-0 z-10 touch-manipulation"
      onPointerUp={onSurfacePointerUp}
      onClick={onSurfaceClick}
      aria-label="Show or hide player controls"
    />
  );
}
