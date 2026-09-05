import { useEffect, useEffectEvent } from "react";
import { watchTogetherPosition, type WatchTogetherState } from "../../shared/watchTogether.ts";
import type { WatchTogetherPlayer } from "./useWatchTogetherSession.ts";
import { useWatchTogetherContext } from "./watchTogetherContext.ts";

async function matchPlayback(video: HTMLVideoElement, state: WatchTogetherState): Promise<void> {
  video.playbackRate = state.rate;
  if (state.paused) { video.pause(); }
  else if (video.paused) {
    try { await video.play(); }
    catch {
      // Browsers may require the guest to press Enable playback.
    }
  }
}

async function followHost(state: WatchTogetherState, elapsed: number, player: WatchTogetherPlayer): Promise<void> {
  const video = player.videoRef.current;
  if (video === null || video.readyState < 1 || video.seeking) { return; }
  const target = watchTogetherPosition(state, elapsed);
  if (Math.abs(player.playbackPosition(video) - target) > 1.25) { player.onSeek(target); }
  await matchPlayback(video, state);
}

export function useWatchTogether(player: WatchTogetherPlayer) {
  const session = useWatchTogetherContext();
  const { attachPlayer, guestId } = session;
  const { rel, videoRef, playbackPosition, onSeek } = player;
  useEffect(() => attachPlayer({ rel, videoRef, playbackPosition, onSeek }), [attachPlayer, rel, videoRef, playbackPosition, onSeek]);
  const synchronize = useEffectEvent(() => {
    const video = videoRef.current;
    const { snapshot } = session;
    if (video === null) { return; }
    if (snapshot === undefined || snapshot.state.rel !== rel || performance.now() - snapshot.receivedAt > 3000) {
      video.pause();
      return;
    }
    void followHost(snapshot.state, performance.now() - snapshot.receivedAt + snapshot.latency, player);
    if (snapshot.state.isHost && video.readyState >= 2 && !video.seeking && Math.abs(playbackPosition(video) - watchTogetherPosition(snapshot.state, performance.now() - snapshot.receivedAt + snapshot.latency)) <= 1.25) {
      session.markReady(snapshot.state.generation);
    }
  });
  useEffect(() => {
    if (guestId === null) { return; }
    const timer = globalThis.setInterval(synchronize, 250);
    synchronize();
    return () => globalThis.clearInterval(timer);
  }, [guestId]);
  return session;
}

export function useWatchTogetherPosition(rel: string, fallback: number): number {
  const session = useWatchTogetherContext();
  if (session.guestId === null) { return fallback; }
  const { snapshot } = session;
  return snapshot?.state.rel === rel
    ? watchTogetherPosition(snapshot.state, snapshot.latency) : 0;
}
