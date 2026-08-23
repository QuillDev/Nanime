import { SkipBack, SkipForward } from "lucide-react";
import type { MediaEntry } from "../types.ts";
import { formatDuration } from "../api.ts";

interface PlayerDescriptionProps {
  readonly entry: MediaEntry;
  readonly resumeAt: number;
}

export function PlayerDescription({
  entry,
  resumeAt,
}: PlayerDescriptionProps): React.JSX.Element {
  if (resumeAt > 0) {
    return <span>Resuming from {formatDuration(resumeAt)}.</span>;
  }
  return <span>{entry.direct ? "Direct play." : "Transcoded stream — seek anywhere."}</span>;
}

interface EpisodeNavigationProps {
  readonly previousAvailable: boolean;
  readonly nextAvailable: boolean;
  readonly onPrevious: () => void;
  readonly onNext: () => void;
}

const buttonClass = "inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-pink-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function EpisodeNavigation({
  previousAvailable,
  nextAvailable,
  onPrevious,
  onNext,
}: EpisodeNavigationProps): React.JSX.Element | null {
  if (!previousAvailable && !nextAvailable) {
    return null;
  }
  return (
    <div className="flex justify-between gap-3">
      <span>
        {previousAvailable && (
          <button type="button" onClick={onPrevious} className={buttonClass}>
            <SkipBack className="size-4" />
            Previous episode
          </button>
        )}
      </span>
      {nextAvailable && (
        <button type="button" onClick={onNext} className={buttonClass}>
          Next episode
          <SkipForward className="size-4" />
        </button>
      )}
    </div>
  );
}
