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
  readonly onInteractionEnd: () => void;
  readonly onInteractionStart: () => void;
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

interface PreviewInteractionOptions {
  readonly duration: number;
  readonly onInteractionEnd: () => void;
  readonly onInteractionStart: () => void;
  readonly onSeek: (time: number) => void;
}

function useDragPreviewState() {
  const draggingRef = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<PreviewPosition | null>(null);
  return { draggingRef, dragging, setDragging, preview, setPreview };
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

function usePreviewInteractions(options: PreviewInteractionOptions) {
  const { duration, onInteractionEnd, onInteractionStart, onSeek } = options;
  const { draggingRef, dragging, setDragging, preview, setPreview } = useDragPreviewState();
  const handlePointerMove = useCallback((event: PointerEvent<HTMLSpanElement>) => {
    if (event.pointerType === "mouse" || draggingRef.current) {
      setPreview(previewPosition(event, duration));
    }
  }, [draggingRef, duration, setPreview]);
  const handlePointerDown = useCallback((event: PointerEvent<HTMLSpanElement>) => {
    draggingRef.current = true;
    setDragging(true);
    onInteractionStart();
    event.currentTarget.setPointerCapture(event.pointerId);
    setPreview(previewPosition(event, duration));
  }, [draggingRef, duration, onInteractionStart, setDragging, setPreview]);
  const handlePointerUp = useCallback((event: PointerEvent<HTMLSpanElement>) => {
    const target = previewPosition(event, duration);
    draggingRef.current = false;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (event.pointerType === "mouse") {
      setPreview(target);
    } else {
      setPreview(null);
    }
    onSeek(target.time);
    onInteractionEnd();
  }, [draggingRef, duration, onInteractionEnd, onSeek, setDragging, setPreview]);
  const handlePointerCancel = useCallback((event: PointerEvent<HTMLSpanElement>) => {
    draggingRef.current = false;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setPreview(null);
    onInteractionEnd();
  }, [draggingRef, onInteractionEnd, setDragging, setPreview]);
  const handlePointerLeave = useCallback(() => {
    if (!draggingRef.current) {
      setPreview(null);
    }
  }, [draggingRef, setPreview]);
  const handleChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const time = event.currentTarget.valueAsNumber;
    if (draggingRef.current) {
      setPreview({ percent: duration > 0 ? time / duration * 100 : 0, time });
    } else {
      onSeek(time);
    }
  }, [draggingRef, duration, onSeek, setPreview]);
  return {
    preview,
    dragging,
    handleChange,
    handlePointerMove,
    handlePointerDown,
    handlePointerUp,
    handlePointerCancel,
    handlePointerLeave,
  };
}

export function PlaybackTimeline({
  bufferedUntil,
  currentTime,
  duration,
  mediaPath,
  onInteractionEnd,
  onInteractionStart,
  onSeek,
}: PlaybackTimelineProps): React.JSX.Element {
  const values = timelineValues(duration, currentTime, bufferedUntil);
  const preview = usePreviewInteractions({
    duration: values.duration,
    onSeek,
    onInteractionStart,
    onInteractionEnd,
  });
  const displayedTime = preview.dragging && preview.preview !== null
    ? preview.preview.time
    : values.time;
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
        onPointerCancel={preview.handlePointerCancel}
        onPointerLeave={preview.handlePointerLeave}
      >
        {preview.preview !== null && values.duration > 0 && (
          <TimelinePreview mediaPath={mediaPath} percent={preview.preview.percent} time={preview.preview.time} />
        )}
        <progress aria-hidden="true" max={values.maximum} value={values.bufferedUntil} className="player-buffered-range absolute inset-x-0 top-1/2 h-1 w-full -translate-y-1/2" />
        <progress aria-hidden="true" max={values.maximum} value={displayedTime} className="player-played-range absolute inset-x-0 top-1/2 h-1 w-full -translate-y-1/2" />
        <input id="player-playback-position" type="range" min={0} max={values.duration} step={0.1} value={displayedTime} onChange={preview.handleChange} className="player-seek-range absolute inset-0 z-10 h-3 w-full cursor-pointer" />
      </span>
    </div>
  );
}
