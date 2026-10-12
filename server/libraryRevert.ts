import { lstat, readdir } from "node:fs/promises";
import type { LibraryFileMovement } from "../shared/libraryFiles.ts";
import { inverseStep, storedOperation, type JournalStep, type StoredOperation } from "./libraryJournal.ts";
import { lockAffecting } from "./libraryLocks.ts";
import { absolutePath, baseName, isInternalName, LibraryFileError, parentPath, sameEntry } from "./libraryPaths.ts";
import { inspectFolder, rejectCollisions, TRASH_FOLDER, type OperationPlan, type PlanContext } from "./libraryFilePlans.ts";

type MoveStep = Extract<JournalStep, { readonly from: string }>;

const REVERTIBLE = new Set(["move", "rename", "trash"]);

function isMove(step: JournalStep): step is MoveStep {
  return step.kind === "move-file" || step.kind === "move-folder";
}

function visible(path: string): boolean {
  return !path.split("/").some((segment) => isInternalName(segment));
}

function displayName(path: string): string {
  return baseName(path);
}

/** The entry currently at `step.from` must be the one the original operation moved. */
async function verifySource(root: string, step: MoveStep): Promise<void> {
  const stats = await lstat(absolutePath(root, step.from)).catch((): null => null);
  if (stats === null || stats.isSymbolicLink() || !sameEntry(step.id, stats)) {
    throw new LibraryFileError(409, `“${displayName(step.from)}” has changed since then, so this can't be undone automatically.`);
  }
}

async function verifyDestination(root: string, step: MoveStep, moves: readonly MoveStep[]): Promise<void> {
  const parent = parentPath(step.to);
  // Only entries leaving this same folder free up a name in it (an undone rename).
  const vacating = new Set(moves.flatMap((move) => (parentPath(move.from) === parent ? [baseName(move.from).toLocaleLowerCase()] : [])));
  const parentStats = parent === null ? null : await lstat(absolutePath(root, parent)).catch((): null => null);
  if (parent !== null && (parentStats === null || !parentStats.isDirectory() || parentStats.isSymbolicLink())) {
    throw new LibraryFileError(409, `The original folder “${baseName(parent)}” no longer exists, so this can't be undone.`);
  }
  const names = await readdir(parent === null ? root : absolutePath(root, parent));
  rejectCollisions([baseName(step.to)], new Map(names.map((name) => [name.toLocaleLowerCase(), name])), vacating);
}

function rejectLocked(context: PlanContext, step: MoveStep): void {
  for (const path of [step.from, step.to].filter((candidate) => visible(candidate))) {
    const found = lockAffecting(context.locks, path);
    if (found !== null) {
      throw new LibraryFileError(423, `“${baseName(found.path)}” is locked: ${found.lock.reason}`);
    }
  }
}

function loadRevertible(operationId: string): StoredOperation {
  const stored = storedOperation(operationId);
  if (stored === null || stored.status !== "committed") {
    throw new LibraryFileError(404, "That change can't be found, so it can't be undone.");
  }
  if (stored.reverted_by_operation_id !== null) {
    throw new LibraryFileError(409, "That change was already undone.");
  }
  if (!REVERTIBLE.has(stored.kind)) {
    throw new LibraryFileError(400, "That kind of change can't be undone.");
  }
  return stored;
}

/**
 * The inverse steps, newest first. Staging folders are removed only when the
 * original operation recorded their identity; the shared trash folder itself
 * always stays, because later operations may be using it.
 */
function inverseSteps(original: StoredOperation): readonly JournalStep[] {
  return [...original.parsedSteps.entries()].toReversed().flatMap(([index, step]) => {
    if (step.kind === "mkdir" && step.to === TRASH_FOLDER) {
      return [];
    }
    const inverse = inverseStep(step, original.checkpoints[index]?.created ?? null);
    return inverse === null ? [] : [inverse];
  });
}

/** Every file a reverted move carries, including files inside reverted folders. */
async function revertedFiles(root: string, moves: readonly MoveStep[]): Promise<OperationPlan["files"]> {
  const perMove = await Promise.all(moves.map(async (step) => {
    if (step.kind === "move-file") {
      return [{ from: step.from, to: step.to }];
    }
    const inside = await inspectFolder(root, step.from);
    return inside.map((from) => ({ from, to: `${step.to}${from.slice(step.from.length)}` }));
  }));
  return perMove.flat();
}

/**
 * Plans the exact inverse of a committed move, rename, or trash. Every entry
 * is verified to still be the one that was moved, and every original location
 * must be free, so undo never overwrites or resurrects the wrong thing.
 */
export async function planRevert(context: PlanContext, operationId: string): Promise<OperationPlan> {
  const original = loadRevertible(operationId);
  const steps = inverseSteps(original);
  const moves = steps.filter((step) => isMove(step));
  for (const step of moves) {
    rejectLocked(context, step);
  }
  await Promise.all(moves.map(async (step) => {
    await verifySource(context.root, step);
    await verifyDestination(context.root, step, moves);
  }));
  const entries: LibraryFileMovement[] = original.parsedSteps.flatMap((step) => (isMove(step) ? [{ from: step.to, to: step.from }] : []));
  return {
    kind: "revert",
    steps,
    moves: moves.map((step) => ({ from: step.from, to: step.to, folder: step.kind === "move-folder" })),
    entries,
    files: await revertedFiles(context.root, moves),
    revertsOperationId: operationId,
  };
}
