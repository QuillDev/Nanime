import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { MediaEntry } from "../types.ts";
import type { PlaybackReadiness } from "../libraryApi.ts";
import { useStartTranscode } from "../hooks/useTranscodes.ts";
import { playbackReadinessKey } from "../hooks/usePlaybackReadiness.ts";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog.tsx";

interface TranscodeRequiredProps {
  readonly entry: MediaEntry;
  readonly readiness: PlaybackReadiness;
  readonly seasonPaths: readonly string[];
  readonly canTranscode: boolean;
  readonly onClose: () => void;
}

const BUTTON = "h-10 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:bg-muted disabled:text-muted-foreground";
const SECONDARY_BUTTON = "h-10 rounded-md bg-secondary px-4 text-sm font-semibold text-secondary-foreground disabled:opacity-50";

function transcodeStatusLine(readiness: PlaybackReadiness, canTranscode: boolean): string {
  const job = readiness.transcode;
  if (job?.status === "queued") {
    return "Queued for transcoding.";
  }
  if (job?.status === "processing") {
    return `Transcoding: ${String(Math.floor(job.progress * 100))}%`;
  }
  if (job?.status === "failed") {
    return "The last transcode failed. See Admin → Transcodes.";
  }
  return canTranscode ? "Its video format can't stream live." : "Ask an admin to transcode it.";
}

function canQueue(readiness: PlaybackReadiness): boolean {
  const status = readiness.transcode?.status;
  return status !== "queued" && status !== "processing";
}

export function TranscodeRequired({
  entry,
  readiness,
  seasonPaths,
  canTranscode,
  onClose,
}: TranscodeRequiredProps): React.JSX.Element {
  const client = useQueryClient();
  const start = useStartTranscode();
  const queue = useCallback((paths: readonly string[]) => {
    start.mutate({ paths, preset: "compatibility" }, {
      onSettled: () => client.invalidateQueries({ queryKey: playbackReadinessKey() }),
    });
  }, [client, start]);
  const handleEpisode = useCallback(() => {
    queue([entry.rel]);
  }, [entry.rel, queue]);
  const handleSeason = useCallback(() => {
    queue(seasonPaths);
  }, [queue, seasonPaths]);
  const handleOpenChange = useCallback((open: boolean) => {
    if (!open) {
      onClose();
    }
  }, [onClose]);
  const actionable = canTranscode && canQueue(readiness);
  return (
    <Dialog open onOpenChange={handleOpenChange}>
      <DialogContent className="left-0 top-0 flex h-[100dvh] max-h-none w-screen max-w-none translate-x-0 translate-y-0 flex-col items-center justify-center gap-4 border-0 bg-black p-6 text-center sm:rounded-none">
        <DialogHeader className="items-center">
          <DialogTitle>This episode needs to be transcoded</DialogTitle>
          <DialogDescription>{transcodeStatusLine(readiness, canTranscode)}</DialogDescription>
        </DialogHeader>
        {actionable && (
          <div className="flex flex-wrap justify-center gap-2">
            <button type="button" className={BUTTON} disabled={start.isPending} onClick={handleEpisode}>
              Transcode episode
            </button>
            {seasonPaths.length > 1 && (
              <button type="button" className={SECONDARY_BUTTON} disabled={start.isPending} onClick={handleSeason}>
                Transcode season ({seasonPaths.length})
              </button>
            )}
          </div>
        )}
        {start.error !== null && <p role="alert" className="text-sm text-destructive">{start.error.message}</p>}
      </DialogContent>
    </Dialog>
  );
}
