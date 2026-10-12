// In-memory host adapter for the demo. A real host would call its own API here,
// then replace `items` once the write is confirmed.
import { applyDelete, applyMove, applyRename, buildIndex, descendantsOf, findLock, findSibling, planMove, topLevelIds, validateCreateFolder, validateRename, type FileOperation, type ItemLock, type OperationResult, type TreeIndex } from "../src/index.ts";
import type { Item, MediaMeta } from "./fixture.tsx";

export interface AdapterOptions {
  readonly read: () => readonly Item[];
  readonly write: (next: readonly Item[]) => void;
  readonly lockOf: () => (item: Item) => ItemLock | null;
  readonly latency: () => number;
  /** Returns true once to simulate a backend refusal. */
  readonly takeFailure: () => boolean;
  /** Mutation-test hook: acknowledge moves without writing them. */
  readonly brokenMove: boolean;
  readonly log: (line: string) => void;
}

/** The store as one operation found it. */
interface Snapshot {
  readonly options: AdapterOptions;
  readonly items: readonly Item[];
  readonly index: TreeIndex<MediaMeta>;
  readonly lockOf: (item: Item) => ItemLock | null;
}

type Operation<T extends FileOperation["type"]> = Extract<FileOperation, { readonly type: T }>;

let counter = 0;

async function wait(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  await promise;
}

function commit(options: AdapterOptions, next: readonly Item[], line: string): void {
  options.write(next);
  options.log(line);
}

function snapshot(options: AdapterOptions): Snapshot {
  const items = options.read();
  return { options, items, index: buildIndex(items), lockOf: options.lockOf() };
}

/** Removed items can only come back where their folder still exists and the name is free. */
function assertRestorable(index: TreeIndex<MediaMeta>, missing: readonly Item[], removedIds: ReadonlySet<string>): void {
  for (const item of missing) {
    const parentRestored = item.parentId !== null && removedIds.has(item.parentId);
    if (!parentRestored && item.parentId !== null && !index.byId.has(item.parentId)) {
      throw new Error(`Can't undo: the folder that held “${item.name}” is gone.`);
    }
    const clash = parentRestored ? undefined : findSibling(index, item.parentId, item.name);
    if (clash !== undefined) {
      throw new Error(`Can't undo: “${clash.name}” now exists in that folder.`);
    }
  }
}

/** Undo for a delete: puts the removed items back if their places are still free. */
function restore(options: AdapterOptions, removed: readonly Item[]) {
  return async () => {
    await wait(options.latency());
    const { items, index } = snapshot(options);
    const missing = removed.filter((item) => !index.byId.has(item.id));
    assertRestorable(index, missing, new Set(removed.map((item) => item.id)));
    commit(options, [...items, ...missing], `undo delete (${removed.length})`);
  };
}

/** Moved items can only go back if they still exist and nothing took their names. */
function assertReturnable(index: TreeIndex<MediaMeta>, origins: ReadonlyMap<string, string | null>): void {
  for (const [id, parentId] of origins) {
    const item = index.byId.get(id);
    if (item === undefined) {
      throw new Error("Can't undo: an item that was moved no longer exists.");
    }
    if (findSibling(index, parentId, item.name, id) !== undefined) {
      throw new Error(`Can't undo: “${item.name}” already exists where it came from.`);
    }
  }
}

/** Undo for a move: sends every item back to its original folder. */
function moveBack(options: AdapterOptions, origins: ReadonlyMap<string, string | null>) {
  return async () => {
    await wait(options.latency());
    const { items, index } = snapshot(options);
    assertReturnable(index, origins);
    let next = items;
    for (const [id, parentId] of origins) {
      next = applyMove(next, [id], parentId);
    }
    commit(options, next, `undo move (${origins.size})`);
  };
}

function createFolder({ options, items, index }: Snapshot, operation: Operation<"create-folder">): undefined {
  const issue = validateCreateFolder(index, operation.parentId, operation.name);
  if (issue !== null) {
    throw new Error(issue.message);
  }
  counter += 1;
  commit(options, [...items, { id: `new-${Date.now().toString(36)}-${counter}`, parentId: operation.parentId, name: operation.name, kind: "folder", modifiedAt: Date.now() }], `create ${operation.name}`);
  return undefined;
}

function rename({ options, items, index, lockOf }: Snapshot, operation: Operation<"rename">): undefined {
  const issue = validateRename(index, operation.id, operation.name, lockOf);
  if (issue !== null) {
    throw new Error(issue.message);
  }
  commit(options, applyRename(items, operation.id, operation.name), `rename ${operation.id} -> ${operation.name}`);
  return undefined;
}

function move({ options, items, index, lockOf }: Snapshot, operation: Operation<"move">): OperationResult | undefined {
  const plan = planMove(index, operation.ids, operation.targetId, lockOf);
  if (!plan.ok) {
    throw new Error(plan.blocker?.message ?? plan.entries.find((entry) => entry.issue !== null)?.issue?.message ?? "Move rejected.");
  }
  const origins = new Map(plan.entries.map((entry) => [entry.item.id, entry.from] as const));
  if (options.brokenMove) {
    options.log("move acknowledged without writing (broken adapter)");
    return undefined;
  }
  commit(options, applyMove(items, [...origins.keys()], operation.targetId), `move ${[...origins.keys()].join(",")} -> ${operation.targetId ?? "root"}`);
  return { undo: moveBack(options, origins) };
}

function remove({ options, items, index, lockOf }: Snapshot, operation: Operation<"delete">): OperationResult {
  const roots = topLevelIds(index, operation.ids);
  const locked = findLock(index, roots, "delete", lockOf);
  if (locked !== null) {
    throw new Error(locked.lock.reason);
  }
  const removed = [...roots.map((id) => index.byId.get(id)).filter((item): item is Item => item !== undefined), ...descendantsOf(index, roots)];
  commit(options, applyDelete(items, roots), `delete ${removed.length}`);
  return { undo: restore(options, removed) };
}

function apply(state: Snapshot, operation: FileOperation): OperationResult | undefined {
  switch (operation.type) {
    case "create-folder": {
      return createFolder(state, operation);
    }
    case "rename": {
      return rename(state, operation);
    }
    case "move": {
      return move(state, operation);
    }
    case "delete": {
      return remove(state, operation);
    }
  }
}

export function createMemoryAdapter(options: AdapterOptions) {
  return async (operation: FileOperation): Promise<OperationResult | undefined> => {
    await wait(options.latency());
    if (options.takeFailure()) {
      options.log(`rejected ${operation.type}`);
      throw new Error("The storage service refused the request (simulated). Nothing was changed.");
    }
    return apply(snapshot(options), operation);
  };
}
