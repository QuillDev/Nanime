import { childrenOf, type TreeIndex } from "./model.js";
import type { FileItem } from "./types.js";

export interface FolderRow<M> {
  readonly item: FileItem<M>;
  readonly depth: number;
  readonly hasChildren: boolean;
}

export function sortFolders<M>(items: readonly FileItem<M>[]): FileItem<M>[] {
  return items.filter((item) => item.kind === "folder").toSorted((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
}

export function flattenFolders<M>(index: TreeIndex<M>, expanded: ReadonlySet<string>): FolderRow<M>[] {
  const out: FolderRow<M>[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const folder of sortFolders(childrenOf(index, parentId))) {
      const hasChildren = childrenOf(index, folder.id).some((child) => child.kind === "folder");
      out.push({ item: folder, depth, hasChildren });
      if (hasChildren && expanded.has(folder.id)) {
        walk(folder.id, depth + 1);
      }
    }
  };
  walk(null, 1);
  return out;
}

/** Folders whose name contains `needle`, flat, for the destination search. */
export function matchingFolders<M>(index: TreeIndex<M>, needle: string): FolderRow<M>[] {
  const rows: FolderRow<M>[] = [];
  for (const item of index.byId.values()) {
    if (item.kind === "folder" && item.name.toLocaleLowerCase().includes(needle)) {
      rows.push({ item, depth: 0, hasChildren: false });
    }
  }
  return rows;
}

export function toggledSet(current: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(current);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  return next;
}
