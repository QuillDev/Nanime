import { useCallback } from "react";
import { useDeleteMedia } from "../hooks/useDeleteMedia.ts";
import type { MediaEntry } from "../types.ts";
import { DialogActions } from "./DialogActions.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog.tsx";

interface DeleteMediaTarget {
  readonly label: string;
  readonly entries: readonly MediaEntry[];
  readonly returnToShows: boolean;
}

interface DeleteMediaDialogProps {
  readonly target: DeleteMediaTarget;
  readonly onClose: () => void;
  readonly onDeleted: (returnToShows: boolean) => void;
}

export function DeleteMediaDialog({
  target,
  onClose,
  onDeleted,
}: DeleteMediaDialogProps): React.JSX.Element {
  const deletion = useDeleteMedia();
  const handleOpenChange = useCallback((open: boolean) => {
    if (!open && !deletion.isPending) {
      onClose();
    }
  }, [deletion.isPending, onClose]);
  const handleDelete = useCallback(() => {
    deletion.mutate(target.entries.map((entry) => entry.rel), {
      onSuccess: () => onDeleted(target.returnToShows),
    });
  }, [deletion, onDeleted, target]);
  return (
    <Dialog open onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Delete {target.label}?</DialogTitle>
          <DialogDescription>
            This permanently deletes {target.entries.length} {target.entries.length === 1 ? "episode" : "episodes"}.
            Any qBittorrent task containing them is removed so the files are not downloaded again;
            unselected episodes remain on disk.
          </DialogDescription>
        </DialogHeader>
        {deletion.error !== null && (
          <p className="text-sm text-destructive">{deletion.error.message}</p>
        )}
        <DialogActions
          actionLabel="Delete permanently"
          onAction={handleDelete}
          onCancel={onClose}
          pending={deletion.isPending}
          pendingLabel="Deleting…"
        />
      </DialogContent>
    </Dialog>
  );
}
