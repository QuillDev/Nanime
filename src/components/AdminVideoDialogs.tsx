import { useMemo } from "react";
import type { MediaEntry } from "../types.ts";
import { DeleteMediaDialog } from "./DeleteMediaDialog.tsx";
import { SubtitleUploadDialog } from "./SubtitleUploadDialog.tsx";
import { TrackPruneDialog } from "./TrackPruneDialog.tsx";

export { AdminVideoActions } from "./AdminVideoActions.tsx";

type PruneMode = "audio" | "subtitles";

export function AdminVideoDialogs({
  selected,
  pruneMode,
  subtitleEntry,
  deleteOpen,
  onClosePrune,
  onCloseSubtitles,
  onCloseDelete,
  onFinished,
}: {
  readonly selected: readonly MediaEntry[];
  readonly pruneMode: PruneMode | null;
  readonly subtitleEntry: MediaEntry | null;
  readonly deleteOpen: boolean;
  readonly onClosePrune: () => void;
  readonly onCloseSubtitles: () => void;
  readonly onCloseDelete: () => void;
  readonly onFinished: () => void;
}): React.JSX.Element {
  const deleteTarget = useMemo(() => ({
    label: `${String(selected.length)} selected videos`,
    entries: selected,
    returnToShows: false,
  }), [selected]);
  return (
    <>
      {pruneMode !== null && <TrackPruneDialog entries={selected} mode={pruneMode} onClose={onClosePrune} onPruned={onFinished} />}
      {subtitleEntry !== null && <SubtitleUploadDialog entry={subtitleEntry} onClose={onCloseSubtitles} />}
      {deleteOpen && <DeleteMediaDialog target={deleteTarget} onClose={onCloseDelete} onDeleted={onFinished} />}
    </>
  );
}
