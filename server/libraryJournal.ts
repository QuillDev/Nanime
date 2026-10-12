import type { LibraryFileOperationKind } from "../shared/libraryFiles.ts";
import { database } from "./database.ts";
import { verifyStepPaths } from "./libraryJournalPaths.ts";
import { performFilesystemStep, recoverFilesystemStep, type Checkpoint } from "./libraryJournalFilesystem.ts";

export type JournalStep =
  | { readonly kind: "mkdir"; readonly from: null; readonly to: string }
  | { readonly kind: "rmdir"; readonly from: null; readonly to: string; readonly id: string }
  | { readonly kind: "move-file" | "move-folder"; readonly from: string; readonly to: string; readonly id: string };
export type JournalStatus = "committed" | "failed" | "pending" | "recovery-required" | "rolled-back";
/** Stage is persisted BEFORE capture/create. created is persisted BEFORE
 * publication. Private slots retain captured entries through process crashes. */
export interface StepCheckpoint {
  readonly state: "done" | "started";
  readonly created: string | null;
  readonly stage?: string | undefined;
}
export interface JournalOperation {
  readonly id: string;
  readonly kind: LibraryFileOperationKind;
  readonly actor: { readonly id: number; readonly username: string };
  readonly steps: readonly JournalStep[];
  readonly revertsOperationId: string | null;
}
interface OperationRow {
  readonly id: string;
  readonly kind: LibraryFileOperationKind;
  readonly status: JournalStatus;
  readonly steps: string;
  readonly progress: string | null;
  readonly reverted_by_operation_id: string | null;
}
export interface StoredOperation extends OperationRow {
  readonly parsedSteps: readonly JournalStep[];
  readonly checkpoints: readonly (StepCheckpoint | null)[];
}
export interface CompletedStep {
  readonly step: JournalStep;
  readonly created: string | null;
  readonly stage?: string | undefined;
}
const insertOperation = database.query<void, [string, string, number, string, string, string | null, number, number]>(`
  INSERT INTO library_file_operations
    (id, kind, status, actor_user_id, actor_username, steps, progress, reverts_operation_id, created_at, updated_at)
  VALUES (?, ?, 'pending', ?, ?, ?, '[]', ?, ?, ?)
`);
const updateStatus = database.query<void, [JournalStatus, string | null, number, string]>(
  "UPDATE library_file_operations SET status = ?, error = ?, updated_at = ? WHERE id = ?",
);
const updateProgress = database.query<void, [string, number, string]>(
  "UPDATE library_file_operations SET progress = ?, updated_at = ? WHERE id = ?",
);
const pendingOperations = database.query<OperationRow, []>(`
  SELECT id, kind, status, steps, progress, reverted_by_operation_id FROM library_file_operations
  WHERE status IN ('pending', 'recovery-required') ORDER BY created_at, id
`);
const operationById = database.query<OperationRow, [string]>(
  "SELECT id, kind, status, steps, progress, reverted_by_operation_id FROM library_file_operations WHERE id = ?",
);
export function recordPending(operation: JournalOperation): void {
  const now = Date.now();
  insertOperation.run(operation.id, operation.kind, operation.actor.id, operation.actor.username,
    JSON.stringify(operation.steps), operation.revertsOperationId, now, now);
}
export function markOperation(id: string, status: JournalStatus, error: string | null = null): void {
  updateStatus.run(status, error, Date.now(), id);
}
function parseCheckpoints(row: OperationRow, stepCount: number): readonly (StepCheckpoint | null)[] {
  if (row.progress === null) {
    return Array.from({ length: stepCount }, (): StepCheckpoint => ({ state: "started", created: null }));
  }
  const parsed = JSON.parse(row.progress) as readonly (StepCheckpoint | null)[];
  return Array.from({ length: stepCount }, (_, index) => parsed[index] ?? null);
}
function parseOperation(row: OperationRow): StoredOperation {
  const parsedSteps = JSON.parse(row.steps) as JournalStep[];
  return { ...row, parsedSteps, checkpoints: parseCheckpoints(row, parsedSteps.length) };
}
export function storedOperation(id: string): StoredOperation | null {
  const row = operationById.get(id);
  return row === null ? null : parseOperation(row);
}
/** Writes each checkpoint before and after the actual native mutation. */
function checkpointWriter(operationId: string, stepCount: number): (index: number) => Checkpoint {
  const checkpoints: (StepCheckpoint | null)[] = Array.from({ length: stepCount }, (): null => null);
  return (index) => (state, created, stage) => {
    checkpoints[index] = { state, created: created ?? checkpoints[index]?.created ?? null, stage: stage ?? checkpoints[index]?.stage };
    updateProgress.run(JSON.stringify(checkpoints), Date.now(), operationId);
  };
}
async function applyStep(root: string, step: JournalStep, checkpoint: Checkpoint): Promise<string | null> {
  await verifyStepPaths(root, step);
  return performFilesystemStep(root, step, checkpoint);
}
export function inverseStep(step: JournalStep, created: string | null): JournalStep | null {
  switch (step.kind) {
    case "mkdir": { return created === null ? null : { kind: "rmdir", from: null, to: step.to, id: created }; }
    case "rmdir": { return { kind: "mkdir", from: null, to: step.to }; }
    default: { return { kind: step.kind, from: step.to, to: step.from, id: step.id }; }
  }
}
export async function undoSteps(root: string, completed: readonly CompletedStep[]): Promise<boolean> {
  for (const { step, created, stage } of completed.toReversed()) {
    try {
      if (!await recoverStep(root, step, { state: "done", created, stage })) { return false; }
    } catch { return false; }
  }
  return true;
}
export class StepFailureError extends Error {
  readonly rolledBack: boolean;
  readonly failure: unknown;
  constructor(failure: unknown, rolledBack: boolean) {
    super(failure instanceof Error ? failure.message : "Filesystem change failed");
    this.name = "StepFailureError";
    this.failure = failure;
    this.rolledBack = rolledBack;
  }
}
/** Local evidence is retained even if a later SQLite checkpoint fails. */
interface StepCursor {
  readonly steps: readonly JournalStep[];
  readonly checkpointFor: (index: number) => Checkpoint;
  readonly checkpoints: (StepCheckpoint | null)[];
  readonly completed: CompletedStep[];
}
function applyNextStep(root: string, cursor: StepCursor, index = 0): Promise<readonly CompletedStep[]> {
  if (index === cursor.steps.length) { return Promise.resolve(cursor.completed); }
  const step = cursor.steps[index];
  if (step === undefined) { throw new TypeError("Missing journal step"); }
  const write = cursor.checkpointFor(index);
  return applyStep(root, step, (state, made, stage) => {
    cursor.checkpoints[index] = { state, created: made ?? cursor.checkpoints[index]?.created ?? null, stage: stage ?? cursor.checkpoints[index]?.stage };
    write(state, made, stage);
  }).then((created) => {
    cursor.completed.push({ step, created, stage: cursor.checkpoints[index]?.stage });
    return applyNextStep(root, cursor, index + 1);
  });
}
export async function runSteps(root: string, operationId: string, steps: readonly JournalStep[]): Promise<readonly CompletedStep[]> {
  const checkpointFor = checkpointWriter(operationId, steps.length);
  const checkpoints: (StepCheckpoint | null)[] = Array.from({ length: steps.length }, (): null => null);
  const completed: CompletedStep[] = [];
  try {
    return await applyNextStep(root, { steps, checkpointFor, checkpoints, completed });
  } catch (error) {
    const operation = { parsedSteps: steps, checkpoints };
    const rolledBack = await recoverPreviousSteps(root, operation, { index: steps.length - 1, recovered: true });
    throw new StepFailureError(error, rolledBack);
  }
}
async function recoverStep(root: string, step: JournalStep, checkpoint: StepCheckpoint | null): Promise<boolean> {
  if (checkpoint === null) { return true; }
  await verifyStepPaths(root, step);
  return recoverFilesystemStep(root, step, checkpoint);
}
interface RecoveryCursor { readonly index: number; readonly recovered: boolean }
/** Stop at ambiguity: earlier steps may depend on the current one. */
async function recoverPreviousSteps(root: string, operation: Pick<StoredOperation, "parsedSteps" | "checkpoints">, { index, recovered }: RecoveryCursor): Promise<boolean> {
  if (index < 0 || !recovered) { return recovered; }
  const step = operation.parsedSteps[index];
  if (step === undefined) { return false; }
  const ok = await recoverStep(root, step, operation.checkpoints[index] ?? null).catch(() => false);
  return await recoverPreviousSteps(root, operation, { index: index - 1, recovered: recovered && ok });
}
async function recoverOperation(root: string, row: OperationRow): Promise<void> {
  const operation = parseOperation(row);
  if (await recoverPreviousSteps(root, operation, { index: operation.parsedSteps.length - 1, recovered: true })) {
    markOperation(row.id, "rolled-back", "Interrupted before it finished; rolled back on startup.");
  } else {
    markOperation(row.id, "recovery-required", "Interrupted and could not be rolled back automatically.");
    // eslint-disable-next-line no-console
    console.error(`Library file operation ${row.id} needs manual recovery; see library_file_operations.steps and progress`);
  }
}
export async function recoverInterruptedOperations(root: string): Promise<number> {
  const rows = pendingOperations.all();
  await rows.reduce<Promise<void>>((previous, row) => previous.then(() => recoverOperation(root, row)), Promise.resolve());
  return rows.length;
}
