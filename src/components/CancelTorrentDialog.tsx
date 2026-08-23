import { useCallback, useState, type ChangeEvent } from "react";
import { useCancelTorrent } from "../hooks/useCancelTorrent.ts";
import type { TorrentStatus } from "../types.ts";
import { DialogActions } from "./DialogActions.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog.tsx";

interface CancelTorrentDialogProps {
  readonly torrent: TorrentStatus;
  readonly onClose: () => void;
}

export function CancelTorrentDialog({
  torrent,
  onClose,
}: CancelTorrentDialogProps): React.JSX.Element {
  const [deleteFiles, setDeleteFiles] = useState(false);
  const cancellation = useCancelTorrent();
  const handleDeleteFiles = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setDeleteFiles(event.target.checked);
  }, []);
  const handleOpenChange = useCallback((open: boolean) => {
    if (!open && !cancellation.isPending) {
      onClose();
    }
  }, [cancellation.isPending, onClose]);
  const handleCancelTorrent = useCallback(() => {
    cancellation.mutate({ hash: torrent.hash, deleteFiles }, { onSuccess: onClose });
  }, [cancellation, deleteFiles, onClose, torrent.hash]);

  return (
    <Dialog open onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Cancel torrent?</DialogTitle>
          <DialogDescription>
            This removes {torrent.name} from qBittorrent and stops its download.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-start gap-3 rounded-md border border-border bg-background p-4 text-sm">
          <input
            id="cancel-torrent-delete-files"
            type="checkbox"
            aria-describedby="cancel-torrent-delete-files-description"
            checked={deleteFiles}
            disabled={cancellation.isPending}
            onChange={handleDeleteFiles}
            className="mt-0.5 size-4 accent-primary"
          />
          <span>
            <label htmlFor="cancel-torrent-delete-files" className="block font-medium">
              Delete downloaded files
            </label>
            <span
              id="cancel-torrent-delete-files-description"
              className="mt-1 block text-xs text-muted-foreground"
            >
              Leave this off to keep any files already written to the media directory.
            </span>
          </span>
        </div>
        {cancellation.error !== null && (
          <p className="text-sm text-destructive">{cancellation.error.message}</p>
        )}
        <DialogActions
          actionLabel="Cancel torrent"
          cancelLabel="Keep downloading"
          onAction={handleCancelTorrent}
          onCancel={onClose}
          pending={cancellation.isPending}
          pendingLabel="Cancelling…"
        />
      </DialogContent>
    </Dialog>
  );
}
