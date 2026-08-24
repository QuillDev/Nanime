import { useCallback, useState, type RefObject } from "react";
import { ClipboardCopy, LoaderCircle, Pause, Play } from "lucide-react";
import { cn } from "../lib/utils.ts";
import { copyText } from "../lib/clipboard.ts";
import { usePlaybackDiagnostics } from "../hooks/usePlaybackDiagnostics.ts";
import type { EpisodeDisplay } from "../types.ts";

interface PlayerPlaybackOverlayProps {
  readonly paused: boolean;
  readonly buffering: boolean;
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

interface PlayerDiagnosticsProps {
  readonly buffering: boolean;
  readonly controlsVisible: boolean;
  readonly frameVisible: boolean;
  readonly playbackMode: "direct" | "hls";
  readonly videoRef: RefObject<HTMLVideoElement | null>;
}

interface PlayerNowPlayingProps {
  readonly display: EpisodeDisplay | null;
  readonly fallbackTitle: string;
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
  const [status, setStatus] = useState<"failed" | "idle" | "success">("idle");
  const createReport = usePlaybackDiagnostics(videoRef, playbackMode);
  const handleCopy = useCallback(() => {
    void (async (): Promise<void> => {
      setStatus(await copyText(createReport(buffering, frameVisible)) ? "success" : "failed");
    })();
  }, [buffering, createReport, frameVisible]);
  if (!buffering && !controlsVisible) {
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

export function PlayerNowPlaying({
  display,
  fallbackTitle,
}: PlayerNowPlayingProps): React.JSX.Element {
  return (
    <div className="player-now-playing pointer-events-none absolute inset-x-0 top-0 z-20 pr-16 text-white">
      {display?.number !== null && display?.number !== undefined && (
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/70">
          Episode {String(display.number)}
        </p>
      )}
      <p className="mt-1 line-clamp-2 text-base font-semibold sm:text-lg">
        {display?.title ?? fallbackTitle}
      </p>
    </div>
  );
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
  buffering,
  controlsVisible,
  onSurfacePointerUp,
  onSurfaceClick,
  onCenterPlayback,
}: PlayerPlaybackOverlayProps): React.JSX.Element {
  return (
    <>
      <button
        type="button"
        className="player-surface-interaction absolute inset-0 z-10 touch-manipulation"
        onPointerUp={onSurfacePointerUp}
        onClick={onSurfaceClick}
        aria-label="Show or hide player controls"
      />
      {buffering
        ? (
          <output
            className="pointer-events-none absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2 text-primary"
            aria-label="Loading video"
          >
            <LoaderCircle className="size-14 animate-spin" aria-hidden="true" />
          </output>
        )
        : (
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
        )}
    </>
  );
}
