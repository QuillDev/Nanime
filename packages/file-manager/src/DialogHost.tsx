import { useCallback } from "react";
import { CreateFolderDialog } from "./CreateFolderDialog.js";
import { DeleteDialog } from "./DeleteDialog.js";
import { FolderDrawer } from "./FolderDrawer.js";
import { MoveDialog } from "./MoveDialog.js";
import type { ManagerProps } from "./useFileManager.js";
import { ViewSheet } from "./ViewSheet.js";

interface CreateSheetProps<M> extends ManagerProps<M> {
  readonly parentId: string | null;
}

function CreateSheet<M>({ manager, parentId }: CreateSheetProps<M>) {
  const { model: { index, labels }, runner: { busy }, dialogs: { dialogError, closeDialog, submitCreate } } = manager;
  const submit = useCallback((name: string) => submitCreate(parentId, name), [submitCreate, parentId]);
  return <CreateFolderDialog index={index} parentId={parentId} rootLabel={labels.root} pending={busy} error={dialogError} onCancel={closeDialog} onSubmit={submit} />;
}

/** The open sheet or drawer, if any. */
export function DialogHost<M>({ manager }: ManagerProps<M>) {
  const { model: { index, labels, lockOf }, navigator: { folderId }, runner: { busy }, dialogs: { dialog, dialogError, closeDialog, submitMove, submitDelete } } = manager;
  switch (dialog?.type) {
    case "move": {
      return <MoveDialog index={index} ids={dialog.ids} currentFolderId={folderId} rootLabel={labels.root} lockOf={lockOf} pending={busy} error={dialogError} onCancel={closeDialog} onSubmit={submitMove} />;
    }
    case "delete": {
      return <DeleteDialog index={index} ids={dialog.ids} lockOf={lockOf} pending={busy} error={dialogError} onCancel={closeDialog} onSubmit={submitDelete} />;
    }
    case "create": {
      return <CreateSheet manager={manager} parentId={dialog.parentId} />;
    }
    case "folders": {
      return <FolderDrawer manager={manager} />;
    }
    case "view": {
      return <ViewSheet manager={manager} />;
    }
    case undefined: {
      return null;
    }
  }
}
