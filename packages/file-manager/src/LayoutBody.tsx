import { CascadePane } from "./CascadePane.js";
import { FileTable } from "./FileTable.js";
import { folderFacts } from "./folderFacts.js";
import { FolderTree } from "./FolderTree.js";
import { Inspector } from "./Inspector.js";
import { ClearSelectionButton, LockNote, SelectionActions, SelectionSummary } from "./SelectionActions.js";
import type { ManagerProps } from "./useFileManager.js";

/** Ledger: folder tree rail beside the table. */
function FolderRail<M>({ manager }: ManagerProps<M>) {
  const { model: { index, labels, lockOf }, navigator: { folderId, expanded, toggleExpanded, navigate } } = manager;
  return (
    <nav className="nfm-rail" aria-label="Folders">
      <FolderTree index={index} rootLabel={labels.root} currentId={folderId} expanded={expanded} onToggle={toggleExpanded} onOpen={navigate} lockOf={lockOf} label="Folder tree" />
    </nav>
  );
}

/** Cascade: the last two parent folders as columns; hidden while searching or filtering. */
function CascadePanes<M>({ manager }: ManagerProps<M>) {
  const { model: { index, labels }, navigator: { folderId }, listing: { filtering } } = manager;
  const { crumbs } = folderFacts(index, folderId, labels.root);
  const panes = folderId === null ? [] : [null, ...crumbs.map((node) => node.id)].slice(-2);
  if (filtering || panes.length === 0) {
    return null;
  }
  return (
    <div className="nfm-panes">
      {panes.map((paneId) => <CascadePane key={paneId ?? "\u0000root"} manager={manager} paneId={paneId} />)}
    </div>
  );
}

/** Cascade: floating actions for the selection. */
function CascadeDock<M>({ manager }: ManagerProps<M>) {
  if (manager.selection.selected.length === 0) {
    return null;
  }
  return (
    <div className="nfm-dock" role="toolbar" aria-label="Selection actions">
      <SelectionSummary manager={manager} />
      <LockNote manager={manager} />
      <span className="nfm-sep" />
      <SelectionActions manager={manager} variant="dock" />
      <ClearSelectionButton manager={manager} />
    </div>
  );
}

/**
 * Body of the chosen layout. Every layout uses the ledger body below 720px.
 * The table section keeps its position where layouts share it, so switching
 * between them on resize keeps the table (and an open rename) mounted.
 */
export function LayoutBody<M>({ manager }: ManagerProps<M>) {
  const { layout, compact } = manager.model;
  const table = <section className="nfm-main"><FileTable manager={manager} /></section>;
  if (layout === "cascade" && !compact) {
    return <div className="nfm-body nfm-cascade"><CascadePanes manager={manager} />{table}<CascadeDock manager={manager} /></div>;
  }
  if (layout === "outline" && !compact) {
    return <div className="nfm-body nfm-outline">{table}<Inspector manager={manager} /></div>;
  }
  return <div className="nfm-body nfm-ledger">{compact ? null : <FolderRail manager={manager} />}{table}</div>;
}
