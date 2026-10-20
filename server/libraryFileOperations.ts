import { randomUUID } from "node:crypto";
import type { LibraryFileOperationResult, LibraryFilesSnapshot } from "../shared/libraryFiles.ts";
import type { ActivityActor } from "./libraryActivity.ts";
import { commitOperation, type OperationCommit } from "./libraryCommit.ts";
import {
  markOperation, recordPending, recoverInterruptedOperations, runSteps, StepFailureError, undoSteps, type JournalStep,
} from "./libraryJournal.ts";
import { currentLocks, localLocks, lockAffecting, type LockSources, type LockState } from "./libraryLocks.ts";
import { baseName, hasInternalSegment, LibraryFileError } from "./libraryPaths.ts";
import { planRequest, type LibraryFileRequest, type OperationPlan } from "./libraryPlanRequest.ts";
import { librarySnapshot, walkLibrary } from "./libraryTree.ts";
import { claimLibraryPaths } from "./libraryWriters.ts";

export type { LibraryFileRequest } from "./libraryPlanRequest.ts";

export interface LibraryFileContext {
  readonly root: string;
  readonly videoExtensions: ReadonlySet<string>;
  readonly lockSources: LockSources;
  /** Marks the start of disk changes; the returned function marks their end. */
  readonly beginMutation: () => () => void;
  /** Cache migration and library refresh once an operation is durable. */
  readonly afterCommit: (plan: OperationPlan) => Promise<void>;
}

let tail: Promise<unknown> = Promise.resolve();
let recovery: Promise<number> | null = null;

/**
 * Library writes (and listings, which must never observe a half-moved entry)
 * run one at a time. This queue, like the path claims other writers check, is
 * in-process: Nanime must be the only process changing a library root.
 */
async function exclusive<T>(work: () => Promise<T>): Promise<T> {
  const previous = tail;
  const turn = Promise.withResolvers<undefined>();
  tail = turn.promise;
  try {
    await previous;
    return await work();
  } finally {
    turn.resolve(undefined);
  }
}

export function recoverLibraryFileOperations(root: string): Promise<number> {
  recovery ??= exclusive(() => recoverInterruptedOperations(root));
  return recovery;
}

export async function listLibraryFiles(context: LibraryFileContext): Promise<LibraryFilesSnapshot> {
  await recoverLibraryFileOperations(context.root);
  // Lock sources are read outside the write queue so a slow qBittorrent never delays writes.
  const [locks, entries] = await Promise.all([
    currentLocks(context.lockSources),
    exclusive(() => walkLibrary(context.root)),
  ]);
  return librarySnapshot(entries, locks, context.videoExtensions);
}

function failureMessage(error: unknown, rolledBack: boolean): string {
  const detail = error instanceof Error ? error.message : "unknown error";
  return rolledBack
    ? `The change failed and was rolled back; nothing was changed. (${detail})`
    : `The change failed and could not be fully rolled back. Affected items stay locked until Nanime recovers them on restart. (${detail})`;
}

/** Records how a failed operation ended and turns it into a user-facing error. */
function settleFailure(operationId: string, error: unknown, rolledBack: boolean): LibraryFileError {
  markOperation(operationId, rolledBack ? "rolled-back" : "recovery-required", error instanceof Error ? error.message : "Operation failed");
  if (error instanceof LibraryFileError && rolledBack) {
    return new LibraryFileError(error.status, failureMessage(error, true));
  }
  return new LibraryFileError(rolledBack ? 500 : 503, failureMessage(error, rolledBack));
}

async function execute(context: LibraryFileContext, commit: OperationCommit): Promise<void> {
  const completed = await runSteps(context.root, commit.operationId, commit.plan.steps).catch((error: unknown) => {
    const failure = error instanceof StepFailureError ? error : new StepFailureError(error, false);
    throw settleFailure(commit.operationId, failure.failure, failure.rolledBack);
  });
  try {
    commitOperation(commit);
  } catch (error) {
    throw settleFailure(commit.operationId, error, await undoSteps(context.root, completed));
  }
}

function visiblePaths(step: JournalStep): readonly string[] {
  return [step.from, step.to].flatMap((path) => (path === null || hasInternalSegment(path) ? [] : [path]));
}

/**
 * Re-checks every path the steps touch against locks read just now. New
 * folders ignore the global "qBittorrent unreachable" lock: a folder that
 * doesn't exist yet can't hold anyone's payload.
 */
function rejectLockedSteps(steps: readonly JournalStep[], locks: LockState): void {
  for (const step of steps) {
    const state = step.kind === "mkdir" ? { ...locks, global: null } : locks;
    for (const path of visiblePaths(step)) {
      const found = lockAffecting(state, path);
      if (found !== null) {
        throw new LibraryFileError(423, `“${baseName(found.path)}” is locked: ${found.lock.reason}`);
      }
    }
  }
}

/**
 * Re-reads locks after planning and claims the operation's paths. Nanime's
 * own jobs and uploads are re-read and the paths claimed in one synchronous
 * step, so no other writer can claim a path in between and
 * every later writer sees these paths as busy. Returns the claim's release.
 */
async function claimPaths(context: LibraryFileContext, commit: OperationCommit): Promise<() => void> {
  const torrents = await currentLocks({ ...context.lockSources, uploads: () => [] });
  const { steps } = commit.plan;
  rejectLockedSteps(steps, { ...torrents, paths: [...torrents.paths, ...localLocks(context.lockSources)] });
  return claimLibraryPaths(steps.flatMap((step) => visiblePaths(step)));
}

/** Journals and runs a claimed operation, releasing its claim however it ends. */
async function executeClaimed(context: LibraryFileContext, commit: OperationCommit, release: () => void): Promise<void> {
  const endMutation = context.beginMutation();
  try {
    const { operationId, plan, actor } = commit;
    recordPending({ id: operationId, kind: plan.kind, actor, steps: plan.steps, revertsOperationId: plan.revertsOperationId });
    await execute(context, commit);
  } finally {
    endMutation();
    release();
  }
}

async function performExclusive(context: LibraryFileContext, request: LibraryFileRequest, actor: ActivityActor): Promise<LibraryFileOperationResult> {
  const locks = await currentLocks(context.lockSources);
  const operationId = randomUUID();
  const plan = await planRequest({ root: context.root, videoExtensions: context.videoExtensions, locks }, request, operationId);
  const commit: OperationCommit = { operationId, plan, actor };
  await executeClaimed(context, commit, await claimPaths(context, commit));
  try {
    await context.afterCommit(plan);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Library file operation committed; follow-up cache work failed", error);
  }
  return {
    operationId,
    kind: plan.kind,
    entries: plan.entries,
    revertible: plan.kind === "move" || plan.kind === "rename" || plan.kind === "trash",
  };
}

export interface LibraryFileCall {
  readonly context: LibraryFileContext;
  readonly request: LibraryFileRequest;
  readonly actor: ActivityActor;
}

export async function performLibraryFileOperation(call: LibraryFileCall): Promise<LibraryFileOperationResult> {
  await recoverLibraryFileOperations(call.context.root);
  return exclusive(() => performExclusive(call.context, call.request, call.actor));
}
