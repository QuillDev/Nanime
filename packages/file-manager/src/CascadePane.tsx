import { useCallback, useMemo, type ReactNode } from "react";
import { NAME_COLUMN_ID, sortItems } from "./columns.js";
import { folderFacts } from "./folderFacts.js";
import { ChevronRightIcon } from "./icons.js";
import { LockMark } from "./LockMark.js";
import { childrenOf } from "./model.js";
import type { FileItem, ItemLock, SortState } from "./types.js";
import type { ManagerProps } from "./useFileManager.js";

const BY_NAME: SortState = { columnId: NAME_COLUMN_ID, direction: "asc" };

interface CascadeEntryProps<M> {
  readonly item: FileItem<M>;
  /** The entry leads toward the current folder. */
  readonly onTrail: boolean;
  readonly icon: ReactNode;
  readonly lock: ItemLock | null;
  readonly onNavigate: (id: string | null, nextSelection?: readonly string[]) => void;
}

/** Folders open; files open their folder with the file selected. */
function CascadeEntry<M>({ item, onTrail, icon, lock, onNavigate }: CascadeEntryProps<M>) {
  const open = useCallback(() => {
    if (item.kind === "folder") {
      onNavigate(item.id);
    } else {
      onNavigate(item.parentId, [item.id]);
    }
  }, [item, onNavigate]);
  return (
    <button type="button" className="nfm-pane-row" data-trail={onTrail || undefined} data-kind={item.kind} onClick={open}>
      {icon}
      <span className="nfm-name">{item.name}</span>
      <LockMark lock={lock} />
      {item.kind === "folder" && <ChevronRightIcon />}
    </button>
  );
}

export interface CascadePaneProps<M> extends ManagerProps<M> {
  /** Folder listed in this pane; `null` is the root. */
  readonly paneId: string | null;
}

/** One parent folder of the current folder, listed as a column. */
export function CascadePane<M>({ manager, paneId }: CascadePaneProps<M>) {
  const { model: { index, labels, columns, context, lockOf, renderIcon }, navigator: { folderId, navigate } } = manager;
  const { crumbs } = folderFacts(index, folderId, labels.root);
  const position = paneId === null ? 0 : crumbs.findIndex((node) => node.id === paneId) + 1;
  const nextInPath = crumbs[position]?.id ?? folderId;
  const name = paneId === null ? labels.root : index.byId.get(paneId)?.name;
  const entries = useMemo(() => sortItems(childrenOf(index, paneId), BY_NAME, columns, context), [index, paneId, columns, context]);
  return (
    <ul className="nfm-pane" aria-label={name}>
      <li className="nfm-pane-head">{name}</li>
      {entries.map((item) => (
        <li key={item.id}>
          <CascadeEntry item={item} onTrail={item.id === nextInPath} icon={renderIcon(item, item.id === nextInPath)} lock={lockOf(item)} onNavigate={navigate} />
        </li>
      ))}
    </ul>
  );
}
