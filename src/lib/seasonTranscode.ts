import type { PlaybackReadiness, PlaybackReadinessBatch } from "../libraryApi.ts";

export type EpisodeTranscodeState =
  | { readonly kind: "ready" }
  | { readonly kind: "needs-transcode" }
  | { readonly kind: "failed" }
  | { readonly kind: "queued"; readonly next: boolean }
  | { readonly kind: "transcoding"; readonly progress: number; readonly remainingSeconds: number | null };

export interface SeasonTranscodeSummary {
  readonly kind: "ready" | "needs-transcode" | "transcoding";
  readonly total: number;
  readonly ready: number;
  /** Projected time until every queued and running episode is ready. */
  readonly remainingSeconds: number | null;
  readonly episodes: ReadonlyMap<string, EpisodeTranscodeState>;
}

function itemState(item: PlaybackReadiness): EpisodeTranscodeState {
  const job = item.transcode;
  if (item.ready) {
    return { kind: "ready" };
  }
  if (job?.status === "processing") {
    return { kind: "transcoding", progress: job.progress, remainingSeconds: job.remainingSeconds };
  }
  if (job?.status === "queued") {
    return { kind: "queued", next: false };
  }
  return job?.status === "failed" ? { kind: "failed" } : { kind: "needs-transcode" };
}

function markNextQueued(paths: readonly string[], states: Map<string, EpisodeTranscodeState>): void {
  const next = paths.find((path) => states.get(path)?.kind === "queued");
  if (next !== undefined) {
    states.set(next, { kind: "queued", next: true });
  }
}

/** Running episodes finish on their own estimates; queued ones share the workers at the running average. */
function seasonRemaining(states: readonly EpisodeTranscodeState[], workers: number): number | null {
  const running = states.flatMap((state) => (state.kind === "transcoding" ? [state] : []));
  const queued = states.filter((state) => state.kind === "queued").length;
  const estimates = running.flatMap((state) => (
    state.remainingSeconds === null || state.progress >= 1 ? [] : [state.remainingSeconds / (1 - state.progress)]
  ));
  if (estimates.length === 0 || estimates.length < running.length) {
    return null;
  }
  const perEpisode = estimates.reduce((sum, value) => sum + value, 0) / estimates.length;
  const runningLeft = running.reduce((sum, state) => sum + (state.remainingSeconds ?? 0), 0);
  return Math.round((runningLeft + queued * perEpisode) / Math.max(1, workers));
}

function episodeStates(
  streamedPaths: readonly string[],
  batch: PlaybackReadinessBatch | undefined,
): Map<string, EpisodeTranscodeState> {
  const byPath = new Map((batch?.items ?? []).map((item) => [item.path, item]));
  const states = new Map<string, EpisodeTranscodeState>();
  for (const path of streamedPaths) {
    const item = byPath.get(path);
    states.set(path, item === undefined ? { kind: "ready" } : itemState(item));
  }
  markNextQueued(streamedPaths, states);
  return states;
}

function seasonKind(active: boolean, notReady: number): SeasonTranscodeSummary["kind"] {
  if (active) {
    return "transcoding";
  }
  return notReady > 0 ? "needs-transcode" : "ready";
}

/**
 * Directly playable episodes are not part of the batch; they count as ready.
 */
export function summarizeSeasonTranscode(
  streamedPaths: readonly string[],
  total: number,
  batch: PlaybackReadinessBatch | undefined,
): SeasonTranscodeSummary {
  const states = episodeStates(streamedPaths, batch);
  const values = [...states.values()];
  const notReady = values.filter((state) => state.kind !== "ready").length;
  const active = values.some((state) => state.kind === "queued" || state.kind === "transcoding");
  return {
    kind: seasonKind(active, notReady),
    total,
    ready: total - notReady,
    remainingSeconds: active ? seasonRemaining(values, batch?.workers ?? 1) : null,
    episodes: states,
  };
}

export function formatRemaining(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) {
    return `${String(minutes)} min`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${String(hours)} h` : `${String(hours)} h ${String(rest)} min`;
}
