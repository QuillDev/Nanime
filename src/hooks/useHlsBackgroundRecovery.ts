import { useEffect, type RefObject } from "react";
import { HLS_SESSION_IDLE_MS } from "../../shared/playback.ts";

interface BackgroundSource {
  hiddenAt: number | null;
  recoveryPending: boolean;
  readonly video: HTMLVideoElement | null;
}

interface BackgroundRecoveryOptions<T extends BackgroundSource> {
  readonly enabled: boolean;
  readonly onRecover: (video: HTMLVideoElement) => void;
  readonly sourceRef: RefObject<T>;
}

function suspend(source: BackgroundSource): void {
  source.hiddenAt ??= Date.now();
}

export function backgroundRecoveryDue(hiddenAt: number | null, now: number): boolean {
  return hiddenAt !== null && now - hiddenAt >= HLS_SESSION_IDLE_MS;
}

function updateRecoveryState(source: BackgroundSource): void {
  const { hiddenAt } = source;
  source.hiddenAt = null;
  source.recoveryPending ||= backgroundRecoveryDue(hiddenAt, Date.now());
}

function recoverIfNeeded(
  source: BackgroundSource,
  onRecover: (video: HTMLVideoElement) => void,
): void {
  const { video } = source;
  if (!source.recoveryPending || video === null || video.paused || video.ended) {
    return;
  }
  source.recoveryPending = false;
  onRecover(video);
}

export function useHlsBackgroundRecovery<T extends BackgroundSource>(
  options: BackgroundRecoveryOptions<T>,
): void {
  const { enabled, onRecover, sourceRef } = options;
  useEffect(() => {
    if (!enabled) {
      return undefined;
    }
    return bindRecoveryLifecycle(sourceRef.current, onRecover);
  }, [enabled, onRecover, sourceRef]);
}

function bindRecoveryLifecycle(
  source: BackgroundSource,
  onRecover: (video: HTMLVideoElement) => void,
): () => void {
  const foreground = () => {
    if (document.visibilityState === "hidden") {
      suspend(source);
      return;
    }
    updateRecoveryState(source);
    recoverIfNeeded(source, onRecover);
  };
  const background = () => suspend(source);
  const { video } = source;
  document.addEventListener("visibilitychange", foreground);
  globalThis.addEventListener("pagehide", background);
  globalThis.addEventListener("pageshow", foreground);
  video?.addEventListener("play", foreground);
  return () => {
    document.removeEventListener("visibilitychange", foreground);
    globalThis.removeEventListener("pagehide", background);
    globalThis.removeEventListener("pageshow", foreground);
    video?.removeEventListener("play", foreground);
  };
}
