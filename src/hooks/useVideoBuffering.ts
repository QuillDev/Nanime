import { useCallback, useRef, useState, type RefObject, type SyntheticEvent } from "react";

interface VideoBuffering {
  readonly buffering: boolean;
  readonly frameVisible: boolean;
  readonly frameRef: RefObject<HTMLCanvasElement | null>;
  readonly handleBuffering: () => void;
  readonly handleLoadStart: () => void;
  readonly handleProgressing: (event: SyntheticEvent<HTMLVideoElement>) => void;
  readonly handleReady: () => void;
  readonly handleSeeked: (event: SyntheticEvent<HTMLVideoElement>) => void;
}

interface FrameLayout {
  readonly height: number;
  readonly width: number;
  readonly frameHeight: number;
  readonly frameWidth: number;
}

function frameLayout(video: HTMLVideoElement): FrameLayout | null {
  const width = video.clientWidth;
  const height = video.clientHeight;
  if (width === 0 || height === 0 || video.videoWidth === 0) {
    return null;
  }
  const scale = Math.min(width / video.videoWidth, height / video.videoHeight);
  return {
    width,
    height,
    frameWidth: video.videoWidth * scale,
    frameHeight: video.videoHeight * scale,
  };
}

function canvasContext(
  canvas: HTMLCanvasElement,
  layout: FrameLayout,
): CanvasRenderingContext2D | null {
  const pixelRatio = window.devicePixelRatio;
  canvas.width = Math.round(layout.width * pixelRatio);
  canvas.height = Math.round(layout.height * pixelRatio);
  const context = canvas.getContext("2d");
  if (context === null) {
    return null;
  }
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.fillStyle = "#000000";
  context.fillRect(0, 0, layout.width, layout.height);
  return context;
}

function drawCurrentFrame(video: HTMLVideoElement, canvas: HTMLCanvasElement): boolean {
  if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    return false;
  }
  const layout = frameLayout(video);
  const context = layout === null ? null : canvasContext(canvas, layout);
  if (layout === null || context === null) {
    return false;
  }
  context.drawImage(
    video,
    (layout.width - layout.frameWidth) / 2,
    (layout.height - layout.frameHeight) / 2,
    layout.frameWidth,
    layout.frameHeight,
  );
  return true;
}

export function useVideoBuffering(
  videoRef: RefObject<HTMLVideoElement | null>,
): VideoBuffering {
  const frameRef = useRef<HTMLCanvasElement | null>(null);
  const [buffering, setBuffering] = useState(true);
  const [frameVisible, setFrameVisible] = useState(false);
  const previousTimeRef = useRef<number | null>(null);
  const handleBuffering = useCallback(() => {
    const video = videoRef.current;
    const canvas = frameRef.current;
    let captured = false;
    if (video !== null && canvas !== null) {
      try {
        captured = drawCurrentFrame(video, canvas);
      } catch {
        // The video remains visible if a browser cannot copy its decoded frame.
      }
    }
    if (captured) {
      setFrameVisible(true);
    }
    setBuffering(true);
  }, [videoRef]);
  const handleLoadStart = useCallback(() => {
    setBuffering(true);
  }, []);
  const handleReady = useCallback(() => {
    setBuffering(false);
    setFrameVisible(false);
  }, []);
  const handleProgressing = useCallback((event: SyntheticEvent<HTMLVideoElement>) => {
    const video = event.currentTarget;
    const previousTime = previousTimeRef.current;
    previousTimeRef.current = video.currentTime;
    if (
      previousTime !== null &&
      video.currentTime > previousTime &&
      !video.seeking
    ) {
      setBuffering(false);
      setFrameVisible(false);
    }
  }, []);
  const handleSeeked = useCallback((event: SyntheticEvent<HTMLVideoElement>) => {
    if (event.currentTarget.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
      setBuffering(false);
      setFrameVisible(false);
    }
  }, []);
  return {
    buffering,
    frameVisible,
    frameRef,
    handleBuffering,
    handleLoadStart,
    handleProgressing,
    handleReady,
    handleSeeked,
  };
}
