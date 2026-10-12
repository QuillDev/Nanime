import { ClearSelectionButton, LockNote, SelectionActions, SelectionSummary } from "./SelectionActions.js";
import type { ManagerProps } from "./useFileManager.js";

/** Touch layouts: selection summary and large action buttons along the bottom. */
export function MobileSelectionBar<M>({ manager }: ManagerProps<M>) {
  if (!manager.model.compact || manager.selection.selected.length === 0) {
    return null;
  }
  return (
    <div className="nfm-mobilebar" role="toolbar" aria-label="Selection actions">
      <div className="nfm-mobilebar-top"><ClearSelectionButton manager={manager} /><SelectionSummary manager={manager} /></div>
      <LockNote manager={manager} />
      <div className="nfm-mobilebar-actions"><SelectionActions manager={manager} variant="dock" /></div>
    </div>
  );
}
