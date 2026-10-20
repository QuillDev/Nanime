import { useCallback, useState, type ChangeEvent } from "react";
import { useDownloadAction } from "../hooks/useDownloadAction.ts";
import type { DownloadStatus } from "../types.ts";
import { DialogActions } from "./DialogActions.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog.tsx";

interface RemoveDownloadDialogProps {
  readonly download: DownloadStatus;
  readonly onClose: () => void;
}

function DeleteFilesOption({ checked, disabled, onChange }: {
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly onChange: (event: ChangeEvent<HTMLInputElement>) => void;
}): React.JSX.Element {
  return (
    <div className="flex items-start gap-3 rounded-md border border-border bg-background p-4 text-sm">
      <input
        id="remove-download-delete-files"
        type="checkbox"
        aria-describedby="remove-download-delete-files-description"
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        className="mt-0.5 size-4 accent-primary"
      />
      <span>
        <label htmlFor="remove-download-delete-files" className="block font-medium">
          Delete downloaded files
        </label>
        <span id="remove-download-delete-files-description" className="mt-1 block text-xs text-muted-foreground">
          Leave this off to keep any files already written to the media directory.
        </span>
      </span>
    </div>
  );
}

export function RemoveDownloadDialog({ download, onClose }: RemoveDownloadDialogProps): React.JSX.Element {
  const [deleteFiles, setDeleteFiles] = useState(false);
  const removal = useDownloadAction();
  const torrent = download.kind === "torrent";
  const handleDeleteFiles = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setDeleteFiles(event.target.checked);
  }, []);
  const handleOpenChange = useCallback((open: boolean) => {
    if (!open && !removal.isPending) {
      onClose();
    }
  }, [removal.isPending, onClose]);
  const handleRemove = useCallback(() => {
    removal.mutate({ id: download.id, action: "remove", deleteFiles }, { onSuccess: onClose });
  }, [removal, deleteFiles, onClose, download.id]);

  return (
    <Dialog open onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Remove download?</DialogTitle>
          <DialogDescription>
            {torrent
              ? `This removes ${download.name} from qBittorrent and stops its download.`
              : `This stops downloading ${download.name} and deletes the unfinished file.`}
          </DialogDescription>
        </DialogHeader>
        {torrent && <DeleteFilesOption checked={deleteFiles} disabled={removal.isPending} onChange={handleDeleteFiles} />}
        {removal.error !== null && (
          <p className="text-sm text-destructive">{removal.error.message}</p>
        )}
        <DialogActions
          actionLabel="Remove download"
          cancelLabel="Keep downloading"
          onAction={handleRemove}
          onCancel={onClose}
          pending={removal.isPending}
          pendingLabel="Removing…"
        />
      </DialogContent>
    </Dialog>
  );
}
