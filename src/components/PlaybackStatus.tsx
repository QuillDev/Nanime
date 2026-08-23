import { CheckCircle2 } from "lucide-react";
import type { PlaybackProgress } from "../types.ts";
import { formatDuration } from "../api.ts";
import { hasMeaningfulPlaybackProgress } from "../lib/playback.ts";

interface PlaybackStatusProps {
  readonly progress: PlaybackProgress | undefined;
}

export function PlaybackStatus({ progress }: PlaybackStatusProps): React.JSX.Element | null {
  if (progress === undefined || !hasMeaningfulPlaybackProgress(progress.position)) {
    return null;
  }
  if (progress.completed) {
    return (
      <span className="mt-2 flex items-center gap-1.5 text-xs font-medium text-primary">
        <CheckCircle2 className="size-3.5" />
        Watched
      </span>
    );
  }
  const percent = progress.duration > 0
    ? Math.min(100, Math.max(0, progress.position / progress.duration * 100))
    : 0;
  return (
    <span className="mt-2 flex flex-col gap-1.5">
      <span className="text-xs text-muted-foreground">
        {formatDuration(progress.position)} of {formatDuration(progress.duration)}
      </span>
      <progress
        aria-label="Episode progress"
        max={100}
        value={percent}
        className="playback-progress h-1 w-full overflow-hidden rounded-full"
      />
    </span>
  );
}
