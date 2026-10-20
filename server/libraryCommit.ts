import type { FileOperationActivityState, LibraryFileOperationKind } from "../shared/libraryFiles.ts";
import type { LibraryActivityAction } from "../shared/types.ts";
import { database } from "./database.ts";
import { insertFileOperationActivity, type ActivityActor } from "./libraryActivity.ts";
import type { OperationPlan } from "./libraryFilePlans.ts";
import { markOperation } from "./libraryJournal.ts";
import { remapLibraryState } from "./libraryRemap.ts";

export interface OperationCommit {
  readonly operationId: string;
  readonly plan: OperationPlan;
  readonly actor: ActivityActor;
}

const ACTIONS = {
  "create-folder": "folder-created",
  move: "files-moved",
  rename: "files-renamed",
  revert: "files-reverted",
  trash: "files-trashed",
} as const satisfies Readonly<Record<LibraryFileOperationKind, LibraryActivityAction>>;

const markReverted = database.query<void, [string, number, string]>(
  "UPDATE library_file_operations SET reverted_by_operation_id = ?, updated_at = ? WHERE id = ? AND reverted_by_operation_id IS NULL",
);

function subjectOf(plan: OperationPlan): string {
  const [first] = plan.entries;
  if (plan.entries.length !== 1 || first === undefined) {
    return `${String(plan.entries.length)} items`;
  }
  return first.from ?? first.to;
}

/**
 * Re-points path-keyed state, appends the immutable activity entry, and marks
 * the journal committed in one SQLite transaction: all of it lands, or none.
 * Metadata needs nothing here: each folder's nanime.json moves with it.
 */
export const commitOperation = database.transaction((commit: OperationCommit): void => {
  const { operationId, plan, actor } = commit;
  const now = Date.now();
  remapLibraryState({ operationId, moves: plan.moves, now });
  const activity: FileOperationActivityState = {
    kind: "files",
    operationId,
    operation: plan.kind,
    entries: plan.entries,
    // Always empty now; older entries list the metadata keys a move re-pointed.
    mappings: [],
    revertsOperationId: plan.revertsOperationId,
  };
  insertFileOperationActivity({ actor, action: ACTIONS[plan.kind], subject: subjectOf(plan), next: activity });
  if (plan.revertsOperationId !== null) {
    markReverted.run(operationId, now, plan.revertsOperationId);
  }
  markOperation(operationId, "committed");
});
