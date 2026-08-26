import {
  useCallback,
  useRef,
  useState,
  type ChangeEvent,
  type PointerEvent,
} from "react";
import { formatDuration } from "../format.ts";
import { TimelinePreview } from "./TimelinePreview.tsx";

interface PlaybackTimelineProps {
  readonly bufferedUntil: number;
  readonly currentTime: number;
  readonly duration: number;
  readonly mediaPath: string;
  readonly onSeek: (time: number) => void;
}

interface PreviewPosition {
  readonly percent: number;
  readonly time: number;
}

interface TimelineValues {
  readonly duration: number;
  readonly time: number;
  readonly bufferedUntil: number;
  readonly maximum: number;
  readonly timeRemaining: number;
}

function timelineValues(duration: number, currentTime: number, bufferedUntil: number): TimelineValues {
  const safeDuration = Math.max(duration, 0);
  const safeTime = Math.min(Math.max(currentTime, 0), safeDuration);
  return {
    duration: safeDuration,
    time: safeTime,
    bufferedUntil: Math.min(Math.max(bufferedUntil, safeTime), safeDuration),
    maximum: safeDuration > 0 ? safeDuration : 1,
    timeRemaining: Math.max(0, safeDuration - safeTime),
  };
}

function previewPosition(event: PointerEvent<HTMLSpanElement>, duration: number): PreviewPosition {
  const bounds = event.currentTarget.getBoundingClientRect();
  const fraction = Math.min(Math.max((event.clientX - bounds.left) / bounds.width, 0), 1);
  return { percent: fraction * 100, time: fraction * duration };
}

function usePreviewInteractions(duration: number) {
  const draggingRef = useRef(false);
  const [preview, setPreview] = useState<PreviewPosition | null>(null);
  const handlePointerMove = useCallback((event: PointerEvent<HTMLSpanElement>) => {
    if (event.pointerType === "mouse" || draggingRef.current) {
      setPreview(previewPosition(event, duration));
    }
  }, [duration]);
  const handlePointerDown = useCallback((event: PointerEvent<HTMLSpanElement>) => {
    draggingRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    setPreview(previewPosition(event, duration));
  }, [duration]);
  const handlePointerUp = useCallback((event: PointerEvent<HTMLSpanElement>) => {
    draggingRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (event.pointerType !== "mouse") {
      setPreview(null);
    }
  }, []);
  const handlePointerLeave = useCallback(() => {
    if (!draggingRef.current) {
      setPreview(null);
    }
  }, []);
  return { preview, handlePointerMove, handlePointerDown, handlePointerUp, handlePointerLeave };
}

export function PlaybackTimeline({
  bufferedUntil,
  currentTime,
  duration,
  mediaPath,
  onSeek,
}: PlaybackTimelineProps): React.JSX.Element {
  const values = timelineValues(duration, currentTime, bufferedUntil);
  const preview = usePreviewInteractions(values.duration);
  const handleSeek = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    onSeek(event.currentTarget.valueAsNumber);
  }, [onSeek]);
  return (
    <div className="relative pt-5 pb-1">
      {values.duration > 0 && (
        <output className="absolute right-0 top-0 text-[11px] tabular-nums text-muted-foreground">
          -{formatDuration(values.timeRemaining)}
        </output>
      )}
      <label className="sr-only" htmlFor="player-playback-position">Playback position</label>
      <span
        className="relative block h-3"
        onPointerDown={preview.handlePointerDown}
        onPointerMove={preview.handlePointerMove}
        onPointerUp={preview.handlePointerUp}
        onPointerCancel={preview.handlePointerUp}
        onPointerLeave={preview.handlePointerLeave}
      >
        {preview.preview !== null && values.duration > 0 && (
          <TimelinePreview mediaPath={mediaPath} percent={preview.preview.percent} time={preview.preview.time} />
        )}
        <progress aria-hidden="true" max={values.maximum} value={values.bufferedUntil} className="player-buffered-range absolute inset-x-0 top-1/2 h-1 w-full -translate-y-1/2" />
        <progress aria-hidden="true" max={values.maximum} value={values.time} className="player-played-range absolute inset-x-0 top-1/2 h-1 w-full -translate-y-1/2" />
        <input id="player-playback-position" type="range" min={0} max={values.duration} step={0.1} value={values.time} onChange={handleSeek} className="player-seek-range absolute inset-0 z-10 h-3 w-full cursor-pointer" />
      </span>
    </div>
  );
}
