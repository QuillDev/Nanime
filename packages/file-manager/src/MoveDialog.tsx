import { useCallback } from "react";
import { DestinationList } from "./DestinationList.js";
import type { LockResolver } from "./locks.js";
import { pathOf, type TreeIndex } from "./model.js";
import { MovePreview } from "./MovePreview.js";
import { ErrorLine, Sheet, SheetFooter, SheetHeader } from "./Sheet.js";
import { plural } from "./text.js";
import { useMoveDraft, type MoveDraft } from "./useMoveDraft.js";

export interface MoveDialogProps<M> {
  readonly index: TreeIndex<M>;
  readonly ids: readonly string[];
  readonly currentFolderId: string | null;
  readonly rootLabel: string;
  readonly lockOf: LockResolver<M>;
  readonly pending: boolean;
  readonly error: string | null;
  readonly onSubmit: (ids: readonly string[], targetId: string | null) => void;
  readonly onCancel: () => void;
}

interface MoveNoteProps<M> {
  readonly draft: MoveDraft<M>;
  readonly index: TreeIndex<M>;
  readonly rootLabel: string;
}

/** Footer summary: the destination path, or why the move can't happen. */
function MoveNote<M>({ draft, index, rootLabel }: MoveNoteProps<M>) {
  const { plan, target } = draft;
  if (plan === null) {
    return "Pick a destination";
  }
  if (plan.ok) {
    return <>to <b>{pathOf(index, target === undefined ? null : target, rootLabel)}</b></>;
  }
  const conflicts = plan.entries.filter((entry) => entry.issue !== null).length;
  return plan.blocker?.message ?? `${plural(conflicts, "conflict")}. Leave ${conflicts === 1 ? "it" : "them"} out or pick another folder.`;
}

function confirmLabel<M>(draft: MoveDraft<M>, pending: boolean, error: string | null): string {
  if (pending) {
    return "Moving…";
  }
  if (error !== null) {
    return "Try again";
  }
  return draft.target === undefined ? "Move" : `Move to ${draft.targetLabel}`;
}

/** Moves the selection as one unit after previewing every item's destination. */
export function MoveDialog<M>(props: MoveDialogProps<M>) {
  const { index, rootLabel, pending, error, onSubmit, onCancel } = props;
  const draft = useMoveDraft(props);
  const { moving, target, plan } = draft;
  const label = confirmLabel(draft, pending, error);
  const submit = useCallback(() => {
    if (target !== undefined) {
      onSubmit(moving, target);
    }
  }, [target, onSubmit, moving]);
  return (
    <Sheet className="nfm-sheet--move" busy={pending} onClose={onCancel}>
      <SheetHeader title={`Move ${plural(moving.length, "item")}`}>From <b>{draft.fromLabel}</b></SheetHeader>
      <DestinationList draft={draft} index={index} rootLabel={rootLabel} pending={pending} />
      <MovePreview draft={draft} index={index} rootLabel={rootLabel} />
      <SheetFooter>
        <ErrorLine error={error} />
        <div className="nfm-foot-row">
          <span className="nfm-foot-note"><MoveNote draft={draft} index={index} rootLabel={rootLabel} /></span>
          <button type="button" className="nfm-btn" disabled={pending} onClick={onCancel}>Cancel</button>
          <button type="button" className="nfm-btn nfm-btn--primary" data-testid="move-confirm" title={label} disabled={plan === null || !plan.ok || pending} onClick={submit}>
            <span className="nfm-btn-label">{label}</span>
          </button>
        </div>
      </SheetFooter>
    </Sheet>
  );
}
