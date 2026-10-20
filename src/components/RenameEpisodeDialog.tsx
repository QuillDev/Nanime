import { useCallback, useState } from "react";
import { PenLine } from "lucide-react";
import { useDialogToggle } from "../hooks/useRenameDialogs.ts";
import type { MediaEntry } from "../types.ts";
import { useEpisodeNames } from "../hooks/useLibraryFiles.ts";
import { episodeFileName } from "../lib/episodeNames.ts";
import { DialogActions } from "./DialogActions.tsx";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog.tsx";

interface RenameEpisodeDialogProps {
  readonly entry: MediaEntry;
  readonly number: number;
  readonly title: string;
  readonly onClose: () => void;
}

/** Sets one episode's title; the file becomes `NNN. Title.ext`. */
export function RenameEpisodeDialog({ entry, number, title, onClose }: RenameEpisodeDialogProps): React.JSX.Element {
  const rename = useEpisodeNames();
  const [draft, setDraft] = useState(title);
  const name = episodeFileName(entry, number, draft);
  const handleOpenChange = useCallback((open: boolean) => {
    if (!open && !rename.isPending) {
      onClose();
    }
  }, [onClose, rename.isPending]);
  const handleDraft = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setDraft(event.target.value);
  }, []);
  const handleSubmit = useCallback((event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (name === null) {
      return;
    }
    rename.mutate({
      folder: entry.folder, showFolder: null, seasonFolder: null, episodes: [{ rel: entry.rel, name }],
    }, { onSuccess: onClose });
  }, [entry, name, onClose, rename]);
  return (
    <Dialog open onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <form onSubmit={handleSubmit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Rename episode {String(number)}</DialogTitle>
          </DialogHeader>
          <label className="grid gap-1.5 text-sm font-medium">
            Title
            <input
              value={draft}
              onChange={handleDraft}
              maxLength={200}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm font-normal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
          <p className="truncate text-xs text-muted-foreground" title={name ?? undefined}>{name ?? "Enter a title."}</p>
          {rename.error !== null && <p className="text-sm text-destructive">{rename.error.message}</p>}
          <DialogActions
            actionLabel="Rename"
            disabled={name === null || name === entry.name}
            onCancel={onClose}
            pending={rename.isPending}
            pendingLabel="Renaming…"
            tone="primary"
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface RenameEpisodeActionProps {
  readonly entry: MediaEntry;
  readonly number: number;
  readonly title: string;
  readonly menuRef: React.RefObject<HTMLDetailsElement | null>;
}

/** The episode menu's Rename item and the dialog it opens. */
export function RenameEpisodeAction({ entry, number, title, menuRef }: RenameEpisodeActionProps): React.JSX.Element {
  const closeMenu = useCallback(() => {
    menuRef.current?.removeAttribute("open");
  }, [menuRef]);
  const dialog = useDialogToggle(closeMenu);
  return (
    <>
      <button type="button" role="menuitem" onClick={dialog.handleOpen} className="flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none">
        <PenLine className="size-4" />
        Rename
      </button>
      {dialog.open && <RenameEpisodeDialog entry={entry} number={number} title={title} onClose={dialog.handleClose} />}
    </>
  );
}
