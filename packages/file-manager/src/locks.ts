import { descendantsOf, existingItems, type TreeIndex } from "./model.js";
import type { FileItem, ItemLock, LockableAction } from "./types.js";

export type LockResolver<M> = (item: FileItem<M>) => ItemLock | null | undefined;

export interface FoundLock<M> {
  readonly item: FileItem<M>;
  readonly lock: ItemLock;
}

/** Trailing `findLock` arguments: the action being attempted and the host lock policy. */
export type LockQuery<M> = readonly [action: LockableAction, resolve: LockResolver<M> | undefined];

export function blockingLock(lock: ItemLock | null | undefined, action: LockableAction): ItemLock | null {
  if (lock === null || lock === undefined) {
    return null;
  }
  return lock.blocks === undefined || lock.blocks.includes(action) ? lock : null;
}

/**
 * First lock that blocks `action` on any of the items or, for folders,
 * anything inside them. Renaming or moving a folder changes every
 * descendant path, so descendants count too.
 */
export function findLock<M>(index: TreeIndex<M>, ids: readonly string[], ...[action, resolve]: LockQuery<M>): FoundLock<M> | null {
  if (resolve === undefined) {
    return null;
  }
  for (const item of [...existingItems(index, ids), ...descendantsOf(index, ids)]) {
    const lock = blockingLock(resolve(item), action);
    if (lock !== null) {
      return { item, lock };
    }
  }
  return null;
}
