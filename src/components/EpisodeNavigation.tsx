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
