import { useCallback } from "react";
import { useDepthStyle } from "./depthStyle.js";
import type { FolderRow } from "./folders.js";
import { ChevronDownIcon, ChevronRightIcon, FolderIcon, FolderOpenIcon, FolderTreeIcon } from "./icons.js";
import { LockMark } from "./LockMark.js";
import type { FileItem, ItemLock } from "./types.js";

interface TwistProps {
  readonly id: string;
  readonly name: string;
  readonly open: boolean;
  readonly onToggle: (id: string) => void;
}

function TreeTwist({ id, name, open, onToggle }: TwistProps) {
  const toggle = useCallback(() => onToggle(id), [onToggle, id]);
  return (
    <button type="button" className="nfm-tree-twist" aria-label={`${open ? "Collapse" : "Expand"} ${name}`} onClick={toggle}>
      {open ? <ChevronDownIcon /> : <ChevronRightIcon />}
    </button>
  );
}

interface TreeLineProps {
  /** Folder id, or `null` for the root line. */
  readonly id: string | null;
  readonly name: string;
  readonly depth: number;
  readonly count: number;
  readonly current: boolean;
  /** In the expanded set (shows the open-folder glyph). */
  readonly open: boolean;
  /** Has subfolders, so it gets a disclosure button. */
  readonly expandable: boolean;
  readonly lock: ItemLock | null;
  readonly onToggle: (id: string) => void;
  readonly onOpen: (id: string | null) => void;
}

function TreeGlyph({ id, open, current }: Pick<TreeLineProps, "id" | "open" | "current">) {
  if (id === null) {
    return <FolderTreeIcon />;
  }
  return open || current ? <FolderOpenIcon /> : <FolderIcon />;
}

/** One line of the tree: disclosure control, then the folder button. */
function TreeLine({ id, name, depth, count, current, open, expandable, lock, onToggle, onOpen }: TreeLineProps) {
  const style = useDepthStyle(depth);
  const navigate = useCallback(() => onOpen(id), [onOpen, id]);
  return (
    <div className="nfm-tree-line" data-current={current || undefined} style={style}>
      {id !== null && expandable ? <TreeTwist id={id} name={name} open={open} onToggle={onToggle} /> : <span className="nfm-tree-twist" />}
      <button type="button" className="nfm-tree-row" data-current={current || undefined} onClick={navigate} title={id === null ? undefined : name}>
        <TreeGlyph id={id} open={open} current={current} />
        <span className="nfm-tree-name">{name}</span>
        <LockMark lock={lock} />
        <span className="nfm-tree-count">{count}</span>
      </button>
    </div>
  );
}

function ignoreToggle(): void {
  // The root line is always open and has no disclosure control.
}

export interface FolderTreeRootProps {
  readonly label: string;
  readonly count: number;
  readonly current: boolean;
  readonly onOpen: (id: string | null) => void;
}

export function FolderTreeRoot({ label, count, current, onOpen }: FolderTreeRootProps) {
  return (
    <li role="treeitem" aria-selected={current} aria-level={1}>
      <TreeLine id={null} name={label} depth={0} count={count} current={current} open={false} expandable={false} lock={null} onToggle={ignoreToggle} onOpen={onOpen} />
    </li>
  );
}

export interface FolderTreeNodeProps<M> {
  readonly row: FolderRow<M>;
  readonly open: boolean;
  readonly current: boolean;
  readonly count: number;
  readonly lockOf: (item: FileItem<M>) => ItemLock | null;
  readonly onToggle: (id: string) => void;
  readonly onOpen: (id: string | null) => void;
}

export function FolderTreeNode<M>({ row, open, current, count, lockOf, onToggle, onOpen }: FolderTreeNodeProps<M>) {
  const { item, depth, hasChildren } = row;
  return (
    <li role="treeitem" aria-selected={current} aria-level={depth + 1} aria-expanded={hasChildren ? open : undefined}>
      <TreeLine id={item.id} name={item.name} depth={depth} count={count} current={current} open={open} expandable={hasChildren} lock={lockOf(item)} onToggle={onToggle} onOpen={onOpen} />
    </li>
  );
}
