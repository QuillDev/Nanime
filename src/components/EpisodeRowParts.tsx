import { Check } from "lucide-react";
import type { MediaEntry } from "../types.ts";
import { formatDuration } from "../format.ts";
import type { WatchView } from "../lib/episodeWatch.ts";
import { formatRemaining, type EpisodeTranscodeState } from "../lib/seasonTranscode.ts";
import { cn } from "../lib/utils.ts";
import { MediaThumbnail } from "./MediaThumbnail.tsx";

function transcodeText(state: EpisodeTranscodeState): string | null {
  if (state.kind === "transcoding") {
    const left = state.remainingSeconds === null ? "" : ` · ${formatRemaining(state.remainingSeconds)} left`;
    return `Transcoding ${String(Math.floor(state.progress * 100))}%${left}`;
  }
  if (state.kind === "queued") {
    return state.next ? "Up next" : "Queued";
  }
  return null;
}

function transcodeNote(state: EpisodeTranscodeState): { readonly text: string; readonly tone: string } | null {
  if (state.kind === "needs-transcode") {
    return { text: "Needs transcode", tone: "font-medium text-warning" };
  }
  if (state.kind === "failed") {
    return { text: "Transcode failed", tone: "font-medium text-destructive" };
  }
  const working = transcodeText(state);
  return working === null ? null : { text: working, tone: "tabular-nums text-muted-foreground" };
}

/** Why an episode can't play yet, in words; nothing once it can. */
export function EpisodeRowNote({ state, className }: { readonly state: EpisodeTranscodeState; readonly className: string }): React.JSX.Element | null {
  const note = transcodeNote(state);
  return note === null ? null : <span className={cn("text-xs", note.tone, className)}>{note.text}</span>;
}

/** The right-hand word on a row: what blocks playback, else how far along it is, else its length. Phones show the first under the title. */
export function EpisodeRowStatus({ state, watch, minutes }: {
  readonly state: EpisodeTranscodeState;
  readonly watch: WatchView;
  readonly minutes: number | null | undefined;
}): React.JSX.Element | null {
  if (blocksPlayback(state)) {
    return <EpisodeRowNote state={state} className="hidden shrink-0 sm:block" />;
  }
  if (watch.watched) {
    return <Check aria-label="Watched" className="size-4 shrink-0 stroke-[3] text-primary" />;
  }
  if (watch.remaining !== null) {
    return <span className="shrink-0 text-xs tabular-nums text-primary">{formatDuration(watch.remaining)} left</span>;
  }
  return minutes === null || minutes === undefined ? null : <span className="shrink-0 text-xs text-muted-foreground">{minutes} min</span>;
}

function RowBar({ state, watch }: { readonly state: EpisodeTranscodeState; readonly watch: WatchView }): React.JSX.Element | null {
  if (state.kind === "transcoding") {
    return <progress aria-label="Transcode progress" max={100} value={Math.floor(state.progress * 100)} className="playback-progress absolute inset-x-0 bottom-0 block h-1 w-full" />;
  }
  return watch.percent > 0 && !blocksPlayback(state)
    ? <progress aria-label="Episode progress" max={100} value={watch.percent} className="playback-progress absolute inset-x-0 bottom-0 block h-1 w-full" />
    : null;
}

/** Loading counts as playable-looking, so rows never flash a warning they may not need. */
function blocksPlayback(state: EpisodeTranscodeState): boolean {
  return state.kind !== "ready" && state.kind !== "loading";
}

/** The episode's frame: dimmed while it can't play or once watched, with its progress along the bottom. */
export function EpisodeRowThumbnail({ entry, source, state, watch }: {
  readonly entry: MediaEntry;
  readonly source: string | null | undefined;
  readonly state: EpisodeTranscodeState;
  readonly watch: WatchView;
}): React.JSX.Element {
  const unavailable = blocksPlayback(state);
  return (
    <span className={cn(
      "relative block w-24 shrink-0 overflow-hidden rounded-lg sm:w-28 [&_img]:transition-[filter,opacity] [&_img]:duration-300",
      unavailable && "[&_img]:brightness-[.4] [&_img]:grayscale",
      watch.watched && !unavailable && "[&_img]:opacity-50",
    )}
    >
      <MediaThumbnail rel={entry.rel} source={source} sizes="112px" className="w-full" />
      <RowBar state={state} watch={watch} />
    </span>
  );
}
