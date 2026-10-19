import { useCallback, useMemo, useState } from "react";
import type { ShowGroup } from "../lib/library.ts";
import type { PruneMode } from "../trackPruning.ts";
import type { MediaEntry } from "../types.ts";
import { AdminVideoBulkBar, type BulkActions } from "./AdminVideoBulkBar.tsx";
import { AdminVideoDialogs } from "./AdminVideoDialogs.tsx";
import { AdminVideoTree, type VideoTreeContext } from "./AdminVideoTree.tsx";

export interface VideoListState {
  readonly shows: readonly ShowGroup[];
  readonly forceOpen: boolean;
  readonly context: VideoTreeContext;
  readonly selectedEntries: readonly MediaEntry[];
  readonly onClear: () => void;
}

function useClosers(
  setPruneMode: (mode: PruneMode | null) => void,
  setSubtitleEntry: (entry: MediaEntry | null) => void,
  setDeleteOpen: (open: boolean) => void,
) {
  const handleClosePrune = useCallback(() => setPruneMode(null), [setPruneMode]);
  const handleCloseSubtitles = useCallback(() => setSubtitleEntry(null), [setSubtitleEntry]);
  const handleCloseDelete = useCallback(() => setDeleteOpen(false), [setDeleteOpen]);
  return { handleClosePrune, handleCloseSubtitles, handleCloseDelete };
}

function useDialogs(selected: readonly MediaEntry[], onClear: () => void) {
  const [pruneMode, setPruneMode] = useState<PruneMode | null>(null);
  const [subtitleEntry, setSubtitleEntry] = useState<MediaEntry | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const handleAddSubtitles = useCallback(() => setSubtitleEntry(selected.length === 1 ? selected[0] ?? null : null), [selected]);
  const handleDelete = useCallback(() => setDeleteOpen(true), []);
  const closers = useClosers(setPruneMode, setSubtitleEntry, setDeleteOpen);
  const handleFinished = useCallback(() => {
    setPruneMode(null);
    setDeleteOpen(false);
    onClear();
  }, [onClear]);
  const actions = useMemo<BulkActions>(
    () => ({ onPrune: setPruneMode, onAddSubtitles: handleAddSubtitles, onDelete: handleDelete, onClear }),
    [handleAddSubtitles, handleDelete, onClear],
  );
  return { pruneMode, subtitleEntry, deleteOpen, actions, ...closers, handleFinished };
}

export function VideoListView({ state }: { readonly state: VideoListState }): React.JSX.Element {
  const dialogs = useDialogs(state.selectedEntries, state.onClear);
  return (
    <>
      <div className="mt-4">
        <AdminVideoTree shows={state.shows} forceOpen={state.forceOpen} context={state.context} />
        {state.shows.length === 0 && <p className="py-10 text-sm text-muted-foreground">No videos match.</p>}
      </div>
      <AdminVideoBulkBar selected={state.selectedEntries} actions={dialogs.actions} />
      <AdminVideoDialogs
        selected={state.selectedEntries}
        pruneMode={dialogs.pruneMode}
        subtitleEntry={dialogs.subtitleEntry}
        deleteOpen={dialogs.deleteOpen}
        onClosePrune={dialogs.handleClosePrune}
        onCloseSubtitles={dialogs.handleCloseSubtitles}
        onCloseDelete={dialogs.handleCloseDelete}
        onFinished={dialogs.handleFinished}
      />
    </>
  );
}
