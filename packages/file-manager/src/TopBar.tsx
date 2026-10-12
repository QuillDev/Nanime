import { Breadcrumbs } from "./Breadcrumbs.js";
import { FilterChips } from "./FilterChips.js";
import { FilterIcon, FolderTreeIcon, NewFolderIcon } from "./icons.js";
import { SearchField } from "./SearchField.js";
import { ClearSelectionButton, LockNote, SelectionActions, SelectionSummary } from "./SelectionActions.js";
import type { ManagerProps } from "./useFileManager.js";

function SelectionToolbar<M>({ manager }: ManagerProps<M>) {
  return (
    <div className="nfm-bar-row" role="toolbar" aria-label="Selection actions">
      <ClearSelectionButton manager={manager} />
      <SelectionSummary manager={manager} />
      <span className="nfm-grow" />
      <LockNote manager={manager} />
      <SelectionActions manager={manager} variant="bar" />
    </div>
  );
}

function BrowseToolbar<M>({ manager }: ManagerProps<M>) {
  const { model: { compact }, options: { filterIds }, runner: { busy }, dialogs: { openFolders, openViewSheet, openCreate } } = manager;
  return (
    <div className="nfm-bar-row">
      {compact && (
        <button type="button" className="nfm-iconbtn" aria-label="Browse folders" onClick={openFolders}><FolderTreeIcon /></button>
      )}
      <Breadcrumbs manager={manager} />
      <span className="nfm-grow" />
      {!compact && <SearchField manager={manager} />}
      {compact && (
        <button type="button" className="nfm-iconbtn" aria-label="Sort and filter" data-active={filterIds.length > 0 || undefined} onClick={openViewSheet}><FilterIcon /></button>
      )}
      <button type="button" className="nfm-btn" disabled={busy} onClick={openCreate} aria-label={compact ? "New folder" : undefined}>
        <NewFolderIcon />{!compact && <span>New folder</span>}
      </button>
    </div>
  );
}

/** Browse bar, or in the ledger layout the selection action bar that replaces it. */
export function TopBar<M>({ manager }: ManagerProps<M>) {
  const { model: { layout, compact }, selection: { selected }, runner: { busy } } = manager;
  const selecting = layout === "ledger" && !compact && selected.length > 0;
  return (
    <div className="nfm-bar" data-mode={selecting ? "selection" : "browse"}>
      {selecting ? <SelectionToolbar manager={manager} /> : <BrowseToolbar manager={manager} />}
      {compact && <div className="nfm-bar-row nfm-bar-row--search"><SearchField manager={manager} /></div>}
      <FilterChips manager={manager} />
      {busy && <div className="nfm-progress" aria-hidden="true" />}
    </div>
  );
}
