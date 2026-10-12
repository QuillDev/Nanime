import { useCallback } from "react";
import { FolderTree } from "./FolderTree.js";
import { CloseIcon } from "./icons.js";
import { useModal } from "./modal.js";
import type { ManagerProps } from "./useFileManager.js";

/** Touch layouts: the folder tree in a modal drawer; picking a folder closes it. */
export function FolderDrawer<M>({ manager }: ManagerProps<M>) {
  const { model: { index, labels, lockOf }, navigator: { folderId, expanded, toggleExpanded, navigate }, dialogs: { closeDialog, hideDialog } } = manager;
  const { panel, onCancel } = useModal(closeDialog);
  const open = useCallback((id: string | null) => {
    navigate(id);
    hideDialog();
  }, [navigate, hideDialog]);
  return (
    <div className="nfm-overlay nfm-overlay--drawer">
      <dialog ref={panel} className="nfm-drawer" aria-modal="true" aria-label="Folders" onCancel={onCancel}>
        <header className="nfm-sheet-head"><div><h2>Folders</h2></div><button type="button" className="nfm-iconbtn" aria-label="Close" onClick={closeDialog}><CloseIcon /></button></header>
        <FolderTree index={index} rootLabel={labels.root} currentId={folderId} expanded={expanded} onToggle={toggleExpanded} onOpen={open} lockOf={lockOf} label="Folder tree" />
      </dialog>
    </div>
  );
}
