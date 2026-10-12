import type { FileOperationActivityState, LibraryFileOperationKind, LibraryMappingMovement } from "../shared/libraryFiles.ts";
import type { LibraryActivityAction } from "../shared/types.ts";
import { database } from "./database.ts";
import { insertFileOperationActivity, type ActivityActor } from "./libraryActivity.ts";
import type { OperationPlan } from "./libraryFilePlans.ts";
import { markOperation } from "./libraryJournal.ts";
import { planMappings } from "./libraryMappings.ts";
import { LibraryFileError } from "./libraryPaths.ts";
import { remapLibraryState } from "./libraryRemap.ts";

export interface OperationCommit {
  readonly operationId: string;
  readonly plan: OperationPlan;
  readonly actor: ActivityActor;
  readonly videoExtensions: ReadonlySet<string>;
  /** Show/season mappings can't move while a metadata refresh rewrites them. */
  readonly metadataBusy: () => boolean;
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
 * The mappings an operation carries, validated against the database as it is
 * now. Throws instead of losing or reassigning a mapping, and while a
 * metadata refresh would race the re-keying.
 */
function operationMappings(commit: OperationCommit): readonly LibraryMappingMovement[] {
  const { plan, videoExtensions } = commit;
  const created = plan.entries.flatMap((entry) => (entry.from === null ? [entry.to] : []));
  const mappings = planMappings({ moves: plan.moves, created, files: plan.files, videoExtensions });
  if (mappings.length > 0 && commit.metadataBusy()) {
    throw new LibraryFileError(423, "A metadata refresh is running and this would move a show or season mapping. Try again when it finishes.");
  }
  return mappings;
}

/**
 * Mapping changes the commit would refuse, checked before the disk changes so
 * a doomed operation never has to be rolled back. The commit re-checks them,
 * along with stale per-path state, inside its transaction.
 */
export function validateCommit(commit: OperationCommit): void {
  operationMappings(commit);
}

/**
 * Re-validates mappings, re-points path-keyed state, appends the immutable
 * activity entry, and marks the journal committed in one SQLite transaction:
 * all of it lands, or none. Returns the mappings that moved.
 */
export const commitOperation = database.transaction((commit: OperationCommit): readonly LibraryMappingMovement[] => {
  const { operationId, plan, actor } = commit;
  const now = Date.now();
  const mappings = operationMappings(commit);
  remapLibraryState({ operationId, moves: plan.moves, mappings, now });
  const activity: FileOperationActivityState = {
    kind: "files",
    operationId,
    operation: plan.kind,
    entries: plan.entries,
    mappings,
    revertsOperationId: plan.revertsOperationId,
  };
  insertFileOperationActivity({ actor, action: ACTIONS[plan.kind], subject: subjectOf(plan), next: activity });
  if (plan.revertsOperationId !== null) {
    markReverted.run(operationId, now, plan.revertsOperationId);
  }
  markOperation(operationId, "committed");
  return mappings;
});
