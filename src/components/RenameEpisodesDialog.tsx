import { useCallback } from "react";
import { useEpisodeNames } from "../hooks/useLibraryFiles.ts";
import type { NameChange, SeasonRenamePlan } from "../lib/episodeNames.ts";
import { DialogActions } from "./DialogActions.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog.tsx";

interface RenameEpisodesDialogProps {
  readonly plan: SeasonRenamePlan;
  readonly onClose: () => void;
}

function ChangeRow({ change }: { readonly change: NameChange }): React.JSX.Element {
  return (
    <li className="min-w-0 py-2">
      <p className="truncate text-sm font-medium" title={change.to}>{change.to}</p>
      <p className="truncate text-xs text-muted-foreground" title={change.from}>{change.from}</p>
    </li>
  );
}

function folderChange(plan: SeasonRenamePlan): NameChange | null {
  if (plan.seasonFolder === null && plan.showFolder === null) {
    return null;
  }
  const season = plan.seasonFolder?.to ?? plan.folder.split("/").at(-1) ?? plan.folder;
  return { from: plan.folder, to: plan.showFolder === null ? season : `${plan.showFolder}/${season}` };
}

/** Old → new names for one season, applied together. */
export function RenameEpisodesDialog({ plan, onClose }: RenameEpisodesDialogProps): React.JSX.Element {
  const rename = useEpisodeNames();
  const folder = folderChange(plan);
  const handleOpenChange = useCallback((open: boolean) => {
    if (!open && !rename.isPending) {
      onClose();
    }
  }, [onClose, rename.isPending]);
  const handleRename = useCallback(() => {
    rename.mutate({
      folder: plan.folder,
      showFolder: plan.showFolder,
      seasonFolder: plan.seasonFolder?.to ?? null,
      episodes: plan.episodes.map((episode) => ({ rel: episode.rel, name: episode.to })),
    }, { onSuccess: onClose });
  }, [onClose, plan, rename]);
  return (
    <Dialog open onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Rename episodes</DialogTitle>
          <DialogDescription>
            Renames the files on disk. If the season is seeding, its torrent is removed from qBittorrent and the files stay.
          </DialogDescription>
        </DialogHeader>
        <ul className="max-h-[50vh] divide-y divide-border overflow-y-auto">
          {folder !== null && <ChangeRow change={folder} />}
          {plan.episodes.map((episode) => <ChangeRow key={episode.rel} change={episode} />)}
        </ul>
        {plan.conflicts.length > 0 && (
          <p className="text-sm text-destructive">Two episodes would share “{plan.conflicts[0]}”. Rename one of them first.</p>
        )}
        {rename.error !== null && <p className="text-sm text-destructive">{rename.error.message}</p>}
        <DialogActions
          actionLabel="Rename"
          disabled={plan.conflicts.length > 0}
          onAction={handleRename}
          onCancel={onClose}
          pending={rename.isPending}
          pendingLabel="Renaming…"
          tone="primary"
        />
      </DialogContent>
    </Dialog>
  );
}
