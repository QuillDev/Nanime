import { createHash, randomUUID } from "node:crypto";
import { readdirSync, type Stats } from "node:fs";
import type { JournalStep, StepCheckpoint } from "./libraryJournal.ts";
import { entryId, LibraryFileError, sameEntry } from "./libraryPaths.ts";
import { anchorParent, anchorRoot, assertAnchor, closeAnchor, mkdirAt, privateStage, removeStaged, renameAtNoReplace, statsAt, type Anchor } from "./libraryJournalNative.ts";

export type Checkpoint = (state: StepCheckpoint["state"], created: string | null, stage?: string) => void;
interface Context { readonly root: Anchor; readonly stage: Anchor; readonly source: Anchor; readonly target: Anchor; readonly slot: string }
const nameOf = (path: string): string => path.slice(path.lastIndexOf("/") + 1);
function legacySlot(step: JournalStep): string { return createHash("sha256").update(JSON.stringify(step)).digest("hex"); }
function withContext<T>(root: string, { step, slot }: { step: JournalStep; slot: string }, action: (context: Context) => T): T {
  if (!/^[a-zA-Z0-9-]{1,80}$/u.test(slot)) { throw new LibraryFileError(409, "Invalid journal staging slot."); }
  const anchors: Anchor[] = [];
  try {
    const rootFd = anchorRoot(root); anchors.push(rootFd);
    const stage = privateStage(rootFd); anchors.push(stage);
    const source = anchorParent(rootFd, step.from ?? step.to); anchors.push(source);
    const target = anchorParent(rootFd, step.to); anchors.push(target);
    const result = action({ root: rootFd, stage, source, target, slot });
    // Do not commit or report recovery complete if an anchored directory was
    // relocated during a syscall. Its descriptor never follows the new symlink,
    // but the journal's public paths no longer describe that namespace.
    for (const anchor of anchors) { assertAnchor(anchor); }
    return result;
  } finally { for (const anchor of anchors.toReversed()) { closeAnchor(anchor); } }
}
function changed(): LibraryFileError { return new LibraryFileError(409, "An entry changed while the operation was running. Nothing was overwritten; recovery may be required."); }
function matches(id: string | null, stats: Stats | null, directory: boolean): boolean {
  return id !== null && stats !== null && !stats.isSymbolicLink() && sameEntry(id, stats) && (directory ? stats.isDirectory() : stats.isFile());
}
function empty(context: Context): boolean { return readdirSync(`/proc/self/fd/${context.stage.fd}/${context.slot}`).length === 0; }
function restore(context: Context, parent: Anchor, name: string): void { renameAtNoReplace({ parent: context.stage, name: context.slot }, { parent, name }); }
/** Capture first, THEN inspect ownership. A substituted public name is never
 * unlinked. If restoration collides it is kept in the journaled private slot.
 * Do not lstat-check-and-unlink a public name, even via an anchored parent.
 */
function capture(context: Context, { parent, name }: { parent: Anchor; name: string }, { id, directory }: { id: string | null; directory: boolean }): void {
  renameAtNoReplace({ parent, name }, { parent: context.stage, name: context.slot });
  if (!matches(id, statsAt(context.stage, context.slot), directory)) {
    restore(context, parent, name);
    throw changed();
  }
}
/** Every mutation is synchronous after descriptor acquisition. Checkpoints
 * precede capture/create and publication, and follow actual FS changes. */
export function performFilesystemStep(root: string, step: JournalStep, checkpoint: Checkpoint): string | null {
  const slot = randomUUID();
  return withContext(root, { step, slot }, (context) => {
    checkpoint("started", null, slot);
    if (step.kind === "mkdir") {
      mkdirAt(context.stage, slot);
      const stats = statsAt(context.stage, slot);
      if (stats === null || !stats.isDirectory()) { throw changed(); }
      const created = entryId(stats);
      checkpoint("started", created, slot);
      restore(context, context.target, nameOf(step.to));
      checkpoint("done", created, slot);
      return created;
    }
    const sourceName = nameOf(step.from ?? step.to);
    const directory = step.kind !== "move-file";
    // A preliminary check avoids capturing known foreign entries, but is NOT
    // the safety boundary. capture verifies what rename actually took.
    if (!matches(step.id, statsAt(context.source, sourceName), directory)) { throw changed(); }
    capture(context, { parent: context.source, name: sourceName }, { id: step.id, directory });
    checkpoint("started", step.id, slot);
    if (step.kind === "rmdir") {
      if (!empty(context)) { restore(context, context.source, sourceName); throw new LibraryFileError(409, "The folder is not empty."); }
      // Retain the exact directory for rollback. Committed empty quarantines
      // remain private; never delete an untrusted public directory name.
    } else {
      restore(context, context.target, nameOf(step.to));
    }
    checkpoint("done", step.id, slot);
    return step.id;
  });
}
function recoverStaged(context: Context, step: JournalStep, checkpoint: StepCheckpoint): boolean | null {
  const staged = statsAt(context.stage, context.slot);
  if (staged === null) { return null; }
  if (step.kind === "mkdir") {
    // Private namespace is trusted. An interrupted private create before its
    // identity checkpoint can be discarded, but never a public unproven mkdir.
    if (!staged.isDirectory() || !empty(context)) { return false; }
    if (checkpoint.created !== null && !matches(checkpoint.created, staged, true)) { return false; }
    removeStaged(context.stage, context.slot, true);
    return true;
  }
  const sourceName = nameOf(step.from ?? step.to);
  // Includes foreign objects captured at the syscall boundary: preserve their
  // inode, restore without overwriting, or retain them in the durable slot.
  restore(context, context.source, sourceName);
  return matches(step.id, staged, step.kind !== "move-file");
}
function recoverCreated(context: Context, step: JournalStep, checkpoint: StepCheckpoint): boolean {
  const name = nameOf(step.to);
  const target = statsAt(context.target, name);
  if (target === null) { return true; }
  if (!matches(checkpoint.created, target, true)) { return false; }
  capture(context, { parent: context.target, name }, { id: checkpoint.created, directory: true });
  if (!empty(context)) { restore(context, context.target, name); return false; }
  removeStaged(context.stage, context.slot, true);
  return true;
}
function recoverRemoved(context: Context, step: Extract<JournalStep, { kind: "rmdir" }>): boolean {
  const target = statsAt(context.target, nameOf(step.to));
  if (target !== null) { return matches(step.id, target, true); }
  // Legacy rmdir had no retained inode. Create privately and publish atomically.
  mkdirAt(context.stage, context.slot);
  restore(context, context.target, nameOf(step.to));
  return true;
}
function recoverUnmoved(context: Context, { step, checkpoint }: { step: Extract<JournalStep, { from: string }>; checkpoint: StepCheckpoint }, target: Stats): boolean {
  if (step.kind === "move-file") {
    if (!matches(step.id, target, false)) { return true; }
    capture(context, { parent: context.target, name: nameOf(step.to) }, { id: step.id, directory: false });
    // Legacy half-link, private only.
    removeStaged(context.stage, context.slot, false);
    return true;
  }
  if (checkpoint.created === step.id) { return true; }
  if (!matches(checkpoint.created, target, true)) { return !(target.isDirectory() && checkpoint.created === null); }
  capture(context, { parent: context.target, name: nameOf(step.to) }, { id: checkpoint.created, directory: true });
  if (!empty(context)) { restore(context, context.target, nameOf(step.to)); return false; }
  removeStaged(context.stage, context.slot, true);
  return true;
}
function recoverMoved(context: Context, step: Extract<JournalStep, { from: string }>, checkpoint: StepCheckpoint): boolean {
  const source = statsAt(context.source, nameOf(step.from));
  const target = statsAt(context.target, nameOf(step.to));
  if (matches(step.id, source, step.kind === "move-folder")) {
    return target === null || recoverUnmoved(context, { step, checkpoint }, target);
  }
  if (source !== null || !matches(step.id, target, step.kind === "move-folder")) { return false; }
  capture(context, { parent: context.target, name: nameOf(step.to) }, { id: step.id, directory: step.kind === "move-folder" });
  restore(context, context.source, nameOf(step.from));
  return true;
}
function recoverCaptured(context: Context, step: JournalStep, checkpoint: StepCheckpoint): boolean | null {
  const staged = statsAt(context.stage, context.slot);
  if (staged === null) { return null; }
  if (step.kind === "mkdir") {
    if (!matches(checkpoint.created, staged, true)) { restore(context, context.target, nameOf(step.to)); return false; }
    if (!empty(context)) { restore(context, context.target, nameOf(step.to)); return false; }
    removeStaged(context.stage, context.slot, true);
    return true;
  }
  if (step.kind === "rmdir") {
    // Only legacy rmdir recovery creates in this derived private slot; the
    // original rmdir quarantine uses the separately journaled primary slot.
    if (!staged.isDirectory()) { return false; }
    restore(context, context.target, nameOf(step.to));
    return true;
  }
  const source = statsAt(context.source, nameOf(step.from));
  if (matches(step.id, source, step.kind === "move-folder")) {
    return recoverCapturedDuplicate(context, { step, checkpoint }, staged);
  }
  if (!matches(step.id, staged, step.kind === "move-folder")) {
    restore(context, context.target, nameOf(step.to));
    return false;
  }
  restore(context, context.source, nameOf(step.from));
  return true;
}
function recoverCapturedDuplicate(context: Context, { step, checkpoint }: { step: Extract<JournalStep, { from: string }>; checkpoint: StepCheckpoint }, staged: Stats): boolean {
  const id = step.kind === "move-file" ? step.id : checkpoint.created;
  const directory = step.kind === "move-folder";
  if (!matches(id, staged, directory) || (directory && !empty(context))) {
    restore(context, context.target, nameOf(step.to));
    return false;
  }
  removeStaged(context.stage, context.slot, directory);
  return true;
}
export function recoverFilesystemStep(root: string, step: JournalStep, checkpoint: StepCheckpoint): boolean {
  const slot = checkpoint.stage ?? legacySlot(step);
  return withContext(root, { step, slot }, (primary) => {
    if (checkpoint.stage !== undefined) {
      const recovered = recoverStaged(primary, step, checkpoint);
      if (recovered !== null) { return recovered; }
    }
    // Recovery captures TARGET names, not apply's SOURCE names. A distinct,
    // deterministic suffix preserves this provenance across recovery crashes
    // without needing another SQLite write between capture and verification.
    const context = { ...primary, slot: `${slot}-back` };
    const recovered = recoverCaptured(context, step, checkpoint);
    if (recovered !== null) { return recovered; }
    switch (step.kind) {
      case "mkdir": { return recoverCreated(context, step, checkpoint); }
      case "rmdir": { return recoverRemoved(context, step); }
      default: { return recoverMoved(context, step, checkpoint); }
    }
  });
}
