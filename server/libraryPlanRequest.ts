import type { LibraryFileReference } from "../shared/libraryFiles.ts";
import { planCreateFolder, planMove, planRename, planTrash, type OperationPlan, type PlanContext } from "./libraryFilePlans.ts";
import { LibraryFileError } from "./libraryPaths.ts";
import { planRevert } from "./libraryRevert.ts";

export type { OperationPlan } from "./libraryFilePlans.ts";

export type LibraryFileRequest =
  | { readonly type: "create-folder"; readonly parent: LibraryFileReference | null; readonly name: string }
  | { readonly type: "move"; readonly items: readonly LibraryFileReference[]; readonly target: LibraryFileReference | null }
  | { readonly type: "rename"; readonly item: LibraryFileReference; readonly name: string }
  | { readonly type: "revert"; readonly operationId: string }
  | { readonly type: "trash"; readonly items: readonly LibraryFileReference[] };

/** Validates a request against the library as it is now and plans its filesystem steps. */
export function planRequest(context: PlanContext, request: LibraryFileRequest, operationId: string): Promise<OperationPlan> {
  switch (request.type) {
    case "create-folder": { return planCreateFolder(context, request.parent, request.name); }
    case "move": { return planMove(context, request.items, request.target); }
    case "rename": { return planRename(context, request.item, request.name); }
    case "trash": { return planTrash(context, request.items, operationId); }
    case "revert": { return planRevert(context, request.operationId); }
    default: { throw new LibraryFileError(400, "Unknown file operation."); }
  }
}
