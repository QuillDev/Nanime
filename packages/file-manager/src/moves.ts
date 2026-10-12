import { findLock, type LockResolver } from "./locks.js";
import { buildIndex, descendantsOf, existingItems, isDescendantOf, topLevelIds, type TreeIndex } from "./model.js";
import { findSibling, lockIssue, type Issue } from "./names.js";
import type { FileItem } from "./types.js";

export interface MoveEntry<M = unknown> {
  readonly item: FileItem<M>;
  readonly from: string | null;
  readonly issue: Issue | null;
}

export interface MovePlan<M = unknown> {
  readonly entries: readonly MoveEntry<M>[];
  /** Blocks the whole move regardless of entries. */
  readonly blocker: Issue | null;
  readonly ok: boolean;
}

/** Trailing `planMove` arguments: the destination (`null` = root) and the host lock policy. */
export type MoveQuery<M> = readonly [targetId: string | null, resolve?: LockResolver<M>];

interface EntryCheck<M> {
  readonly index: TreeIndex<M>;
  readonly item: FileItem<M>;
  readonly targetId: string | null;
  /** Names already claimed by earlier entries of the same move. */
  readonly incoming: ReadonlySet<string>;
}

function destinationIssue<M>(index: TreeIndex<M>, targetId: string | null): Issue | null {
  if (targetId === null) {
    return null;
  }
  const target = index.byId.get(targetId);
  if (target === undefined) {
    return { code: "missing", message: "Destination no longer exists." };
  }
  return target.kind === "folder" ? null : { code: "not-folder", message: "Destination must be a folder." };
}

function nameKey<M>(index: TreeIndex<M>, item: FileItem<M>): string {
  return index.caseSensitive ? item.name : item.name.toLocaleLowerCase();
}

/** A folder can't go into itself or below itself, and nothing moves to where it already is. */
function placementIssue<M>({ index, item, targetId }: EntryCheck<M>): Issue | null {
  const { id } = item;
  if (targetId === id) {
    return { code: "self", message: "Can't move a folder into itself.", id };
  }
  if (item.kind === "folder" && isDescendantOf(index, targetId, id)) {
    return { code: "descendant", message: "Can't move a folder into its own subfolder.", id };
  }
  return item.parentId === targetId ? { code: "same-location", message: "Already in this folder.", id } : null;
}

/** Names must stay unique among the moving items and in the destination. */
function nameIssue<M>({ index, item, targetId, incoming }: EntryCheck<M>): Issue | null {
  if (incoming.has(nameKey(index, item))) {
    return { code: "collision", message: `Two selected items are named "${item.name}".`, id: item.id };
  }
  const clash = findSibling(index, targetId, item.name);
  return clash === undefined ? null : { code: "collision", message: `A ${clash.kind} with this name already exists there.`, id: item.id };
}

/** Validates a move as one unit. Any issue makes `ok` false; nothing partial. */
export function planMove<M>(index: TreeIndex<M>, ids: readonly string[], ...[targetId, resolve]: MoveQuery<M>): MovePlan<M> {
  const roots = existingItems(index, topLevelIds(index, ids));
  if (roots.length === 0) {
    return { entries: [], blocker: { code: "missing", message: "Nothing to move." }, ok: false };
  }
  const found = findLock(index, roots.map((item) => item.id), "move", resolve);
  const blocker = destinationIssue(index, targetId) ?? (found === null ? null : lockIssue(found));
  const incoming = new Set<string>();
  const entries = roots.map((item): MoveEntry<M> => {
    const check: EntryCheck<M> = { index, item, targetId, incoming };
    const issue = placementIssue(check) ?? nameIssue(check);
    incoming.add(nameKey(index, item));
    return { item, from: item.parentId, issue };
  });
  return { entries, blocker, ok: blocker === null && entries.every((entry) => entry.issue === null) };
}

/** Pure application of a validated move. Hosts can use it for in-memory stores. */
export function applyMove<M>(items: readonly FileItem<M>[], ids: readonly string[], targetId: string | null): FileItem<M>[] {
  const moving = new Set(ids);
  return items.map((item) => (moving.has(item.id) ? { ...item, parentId: targetId } : item));
}

export function applyRename<M>(items: readonly FileItem<M>[], id: string, name: string): FileItem<M>[] {
  return items.map((item) => (item.id === id ? { ...item, name } : item));
}

export function applyDelete<M>(items: readonly FileItem<M>[], ids: readonly string[], caseSensitive = false): FileItem<M>[] {
  const index = buildIndex(items, caseSensitive);
  const doomed = new Set([...ids, ...descendantsOf(index, ids).map((item) => item.id)]);
  return items.filter((item) => !doomed.has(item.id));
}
