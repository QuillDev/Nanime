import { useCallback, useState, type ChangeEvent, type FormEvent } from "react";
import { useSubtitleTracks } from "../hooks/useSubtitleTracks.ts";
import { useUploadSubtitle } from "../hooks/useUploadSubtitle.ts";
import type { MediaEntry } from "../types.ts";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog.tsx";
import { Input } from "./ui/input.tsx";
import { DialogActions } from "./DialogActions.tsx";

interface SubtitleUploadDialogProps {
  readonly entry: MediaEntry;
  readonly onClose: () => void;
}

export function SubtitleUploadDialog({
  entry,
  onClose,
}: SubtitleUploadDialogProps): React.JSX.Element {
  const [file, setFile] = useState<File | null>(null);
  const [offsetSeconds, setOffsetSeconds] = useState(0);
  const upload = useUploadSubtitle(entry.rel);
  const tracks = useSubtitleTracks(entry.rel);
  const handleFile = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setFile(event.target.files?.[0] ?? null);
  }, []);
  const handleOffset = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setOffsetSeconds(event.target.valueAsNumber);
  }, []);
  const handleOpenChange = useCallback((open: boolean) => {
    if (!open && !upload.isPending) {
      onClose();
    }
  }, [onClose, upload.isPending]);
  const handleSubmit = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (file !== null && Number.isFinite(offsetSeconds)) {
      upload.mutate({ subtitle: file, offsetSeconds }, { onSuccess: onClose });
    }
  }, [file, offsetSeconds, onClose, upload]);

  return (
    <Dialog open onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add subtitles</DialogTitle>
          <DialogDescription>
            Attach an SRT or ASS sidecar subtitle to {entry.name}. It will be available
            from the player&apos;s subtitle menu.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <label htmlFor="episode-subtitle-file" className="block text-sm font-medium">
            Subtitle file
            <input
              id="episode-subtitle-file"
              type="file"
              accept=".srt,.ass,application/x-subrip,text/x-ssa,text/plain"
              required
              disabled={upload.isPending}
              onChange={handleFile}
              className="mt-2 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1 file:font-semibold file:text-primary-foreground disabled:opacity-50"
            />
          </label>
          <label htmlFor="episode-subtitle-offset" className="block text-sm font-medium">
            Timing offset
            <Input
              id="episode-subtitle-offset"
              type="number"
              value={offsetSeconds}
              min={-3600}
              max={3600}
              step={0.1}
              required
              disabled={upload.isPending}
              onChange={handleOffset}
              className="mt-2"
            />
            <span className="mt-2 block text-xs font-normal text-muted-foreground">
              Seconds: positive values show subtitles later; negative values show them earlier.
            </span>
          </label>
          {tracks.data !== undefined && tracks.data.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Existing tracks: {tracks.data.map((track) => track.label).join(", ")}
            </p>
          )}
          {upload.error !== null && (
            <p className="text-sm text-destructive">{upload.error.message}</p>
          )}
          <DialogActions
            actionLabel="Add subtitles"
            disabled={file === null || !Number.isFinite(offsetSeconds)}
            onCancel={onClose}
            pending={upload.isPending}
            pendingLabel="Uploading…"
            tone="primary"
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}
