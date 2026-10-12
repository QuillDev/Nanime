import type { FileItem } from "./types.js";

export const ROOT_KEY = "\u0000root";

export interface TreeIndex<M = unknown> {
  readonly byId: ReadonlyMap<string, FileItem<M>>;
  readonly children: ReadonlyMap<string, readonly FileItem<M>[]>;
  readonly caseSensitive: boolean;
}

export function parentKey(id: string | null): string {
  return id ?? ROOT_KEY;
}

export function buildIndex<M>(items: readonly FileItem<M>[], caseSensitive = false): TreeIndex<M> {
  const byId = new Map<string, FileItem<M>>();
  const children = new Map<string, FileItem<M>[]>();
  for (const item of items) {
    byId.set(item.id, item);
    const key = parentKey(item.parentId);
    const list = children.get(key);
    if (list === undefined) {
      children.set(key, [item]);
    } else {
      list.push(item);
    }
  }
  return { byId, children, caseSensitive };
}

/** Items for the ids that still exist, in the order given. */
export function existingItems<M>(index: TreeIndex<M>, ids: Iterable<string>): FileItem<M>[] {
  const items: FileItem<M>[] = [];
  for (const id of ids) {
    const item = index.byId.get(id);
    if (item !== undefined) {
      items.push(item);
    }
  }
  return items;
}

export function childrenOf<M>(index: TreeIndex<M>, id: string | null): readonly FileItem<M>[] {
  return index.children.get(parentKey(id)) ?? [];
}

function parentOf<M>(index: TreeIndex<M>, item: FileItem<M> | undefined): FileItem<M> | undefined {
  return item === undefined || item.parentId === null ? undefined : index.byId.get(item.parentId);
}

/** Ancestors from the root down, excluding the item itself. */
export function ancestorsOf<M>(index: TreeIndex<M>, id: string | null): FileItem<M>[] {
  const chain: FileItem<M>[] = [];
  const seen = new Set<string>();
  let node = parentOf(index, id === null ? undefined : index.byId.get(id));
  while (node !== undefined && !seen.has(node.id)) {
    seen.add(node.id);
    chain.unshift(node);
    node = parentOf(index, node);
  }
  return chain;
}

export function pathOf<M>(index: TreeIndex<M>, id: string | null, rootLabel = ""): string {
  if (id === null) {
    return rootLabel;
  }
  const self = index.byId.get(id);
  const names = [...ancestorsOf(index, id).map((node) => node.name), self?.name ?? "?"];
  return rootLabel === "" ? names.join("/") : [rootLabel, ...names].join("/");
}

export function isDescendantOf<M>(index: TreeIndex<M>, id: string | null, ancestorId: string): boolean {
  return ancestorsOf(index, id).some((node) => node.id === ancestorId);
}

/** Every descendant of the given ids, not including the ids themselves. */
export function descendantsOf<M>(index: TreeIndex<M>, ids: Iterable<string>): FileItem<M>[] {
  const out: FileItem<M>[] = [];
  const pending = [...ids];
  const seen = new Set<string>();
  for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
    if (!seen.has(id)) {
      seen.add(id);
      const children = childrenOf(index, id);
      out.push(...children);
      pending.push(...children.flatMap((child) => (child.kind === "folder" ? [child.id] : [])));
    }
  }
  return out;
}

export function subtreeSize<M>(index: TreeIndex<M>, id: string): number {
  const self = index.byId.get(id);
  if (self === undefined) {
    return 0;
  }
  if (self.kind === "file") {
    return self.size ?? 0;
  }
  return descendantsOf(index, [id]).reduce((sum, node) => sum + (node.kind === "file" ? node.size ?? 0 : 0), 0);
}

/** Drops ids whose ancestor is also in the list, so a folder moves once with its contents. */
export function topLevelIds<M>(index: TreeIndex<M>, ids: readonly string[]): string[] {
  const set = new Set(ids);
  return ids.filter((id) => index.byId.has(id) && !ancestorsOf(index, id).some((node) => set.has(node.id)));
}

const BYTE_UNITS = ["KB", "MB", "GB", "TB"] as const;

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) {
    return "";
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} ${BYTE_UNITS[unit] ?? ""}`;
}
