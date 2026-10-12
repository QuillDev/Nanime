import { useMemo } from "react";
import { flattenFolders } from "./folders.js";
import { FolderTreeNode, FolderTreeRoot } from "./FolderTreeNode.js";
import { childrenOf, type TreeIndex } from "./model.js";
import type { FileItem, ItemLock } from "./types.js";

export interface FolderTreeProps<M> {
  readonly index: TreeIndex<M>;
  readonly rootLabel: string;
  readonly currentId: string | null;
  readonly expanded: ReadonlySet<string>;
  readonly onToggle: (id: string) => void;
  readonly onOpen: (id: string | null) => void;
  readonly lockOf: (item: FileItem<M>) => ItemLock | null;
  readonly label: string;
}

/** Navigation tree used by the ledger rail and the mobile folder drawer. */
export function FolderTree<M>({ index, rootLabel, currentId, expanded, onToggle, onOpen, lockOf, label }: FolderTreeProps<M>) {
  const rows = useMemo(() => flattenFolders(index, expanded), [index, expanded]);
  return (
    <ul className="nfm-tree" role="tree" aria-label={label}>
      <FolderTreeRoot label={rootLabel} count={childrenOf(index, null).length} current={currentId === null} onOpen={onOpen} />
      {rows.map((row) => (
        <FolderTreeNode
          key={row.item.id}
          row={row}
          open={expanded.has(row.item.id)}
          current={currentId === row.item.id}
          count={childrenOf(index, row.item.id).length}
          lockOf={lockOf}
          onToggle={onToggle}
          onOpen={onOpen}
        />
      ))}
    </ul>
  );
}
