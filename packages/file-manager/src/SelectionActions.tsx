import { useCallback } from "react";
import { CloseIcon, LockIcon, MoveIcon, RenameIcon, TrashIcon } from "./icons.js";
import type { FoundLock } from "./locks.js";
import { formatBytes } from "./model.js";
import type { ManagerProps } from "./useFileManager.js";
import type { BlockingLock } from "./useManagerModel.js";

export interface SelectionLocks<M> {
  readonly move: FoundLock<M> | null;
  readonly rename: FoundLock<M> | null;
  readonly remove: FoundLock<M> | null;
  /** The reason shown next to the actions: move, then rename, then delete. */
  readonly first: FoundLock<M> | null;
}

export function selectionLocks<M>(blocking: BlockingLock<M>, selected: readonly string[]): SelectionLocks<M> {
  const any = selected.length > 0;
  const move = any ? blocking(selected, "move") : null;
  const rename = selected.length === 1 ? blocking(selected, "rename") : null;
  const remove = any ? blocking(selected, "delete") : null;
  return { move, rename, remove, first: move ?? rename ?? remove };
}

export interface SelectionActionsProps<M> extends ManagerProps<M> {
  /** The action bar shows the F2 hint; docks and touch bars don't. */
  readonly variant: "bar" | "stack" | "dock";
}

export function SelectionActions<M>({ manager, variant }: SelectionActionsProps<M>) {
  const { model: { blocking, compact }, selection: { selected }, runner: { busy }, rename: { startRename }, dialogs: { openMove, openDelete } } = manager;
  const locks = selectionLocks(blocking, selected);
  const renameSelection = useCallback(() => {
    const [id] = selected;
    if (id !== undefined) {
      startRename(id);
    }
  }, [selected, startRename]);
  const moveSelection = useCallback(() => openMove(selected), [openMove, selected]);
  const deleteSelection = useCallback(() => openDelete(selected), [openDelete, selected]);
  return (
    <>
      <button type="button" className="nfm-btn" data-action="rename" disabled={busy || selected.length !== 1 || locks.rename !== null} title={selected.length === 1 ? locks.rename?.lock.reason ?? "Rename (F2)" : "Select one item to rename"} onClick={renameSelection}>
        <RenameIcon /><span>Rename</span>{variant !== "dock" && !compact && <kbd>F2</kbd>}
      </button>
      <button type="button" className="nfm-btn" data-action="move" disabled={busy || locks.move !== null} title={locks.move?.lock.reason ?? "Move to another folder"} onClick={moveSelection}>
        <MoveIcon /><span>Move</span>
      </button>
      <button type="button" className="nfm-btn nfm-btn--quiet-danger" data-action="delete" disabled={busy || locks.remove !== null} title={locks.remove?.lock.reason ?? "Delete"} onClick={deleteSelection}>
        <TrashIcon /><span>Delete</span>
      </button>
    </>
  );
}

export function LockNote<M>({ manager }: ManagerProps<M>) {
  const { first } = selectionLocks(manager.model.blocking, manager.selection.selected);
  if (first === null) {
    return null;
  }
  return <span className="nfm-locknote" role="note"><LockIcon /><span>{first.lock.reason}</span></span>;
}

export function SelectionSummary<M>({ manager }: ManagerProps<M>) {
  const { model: { context }, selection: { selected, selectedItems } } = manager;
  const bytes = selectedItems.reduce((sum, item) => sum + context.subtreeSize(item.id), 0);
  return <span className="nfm-selcount"><b>{selected.length}</b> selected<span className="nfm-dim"> · {formatBytes(bytes)}</span></span>;
}

export function ClearSelectionButton<M>({ manager }: ManagerProps<M>) {
  const { clear } = manager.rows;
  return <button type="button" className="nfm-iconbtn" aria-label="Clear selection" onClick={clear}><CloseIcon /></button>;
}
