import { useCallback, useId } from "react";
import { WidgetRole } from "./aria.js";
import { useDepthStyle } from "./depthStyle.js";
import { CheckIcon, ChevronDownIcon, ChevronRightIcon, FolderIcon, FolderOpenIcon, FolderTreeIcon, SearchIcon } from "./icons.js";
import { pathOf, type TreeIndex } from "./model.js";
import type { MoveDraft } from "./useMoveDraft.js";

interface IconProps {
  readonly folderId: string | null;
  readonly open: boolean;
}

function DestinationIcon({ folderId, open }: IconProps) {
  if (folderId === null) {
    return <FolderTreeIcon />;
  }
  return open ? <FolderOpenIcon /> : <FolderIcon />;
}

interface MarkProps {
  readonly reason: string | null;
  readonly picked: boolean;
}

/** Why a folder is unavailable, or a check on the chosen one. */
function DestinationMark({ reason, picked }: MarkProps) {
  if (reason !== null) {
    return <span className="nfm-dest-why">{reason}</span>;
  }
  return picked ? <span className="nfm-dest-pick"><CheckIcon /></span> : null;
}

interface RowProps<M> {
  readonly draft: MoveDraft<M>;
  readonly folderId: string | null;
  readonly name: string;
  readonly depth: number;
  readonly hasChildren: boolean;
  /** Parent path, shown for search results. */
  readonly sub: string | null;
  readonly pending: boolean;
}

function DestinationRow<M>({ draft, folderId, name, depth, hasChildren, sub, pending }: RowProps<M>) {
  const { reasonFor, target, expanded, needle, toggle, pick } = draft;
  const reason = reasonFor(folderId);
  const open = folderId !== null && expanded.has(folderId);
  const style = useDepthStyle(depth);
  const toggleOpen = useCallback(() => {
    if (folderId !== null) {
      toggle(folderId);
    }
  }, [toggle, folderId]);
  const choose = useCallback(() => pick(folderId), [pick, folderId]);
  return (
    <li className="nfm-dest-line" style={style}>
      {hasChildren && needle === "" && folderId !== null ? (
        <button type="button" className="nfm-tree-twist" aria-label={`${open ? "Collapse" : "Expand"} ${name}`} onClick={toggleOpen}>
          {open ? <ChevronDownIcon /> : <ChevronRightIcon />}
        </button>
      ) : <span className="nfm-tree-twist" />}
      <button type="button" className="nfm-dest" role={WidgetRole.option} aria-selected={target === folderId} aria-disabled={reason !== null} data-dest={folderId ?? ""} disabled={reason !== null || pending} onClick={choose}>
        <DestinationIcon folderId={folderId} open={open} />
        <span className="nfm-dest-name">
          <span>{name}</span>
          {sub !== null && <span className="nfm-sub">{sub}</span>}
        </span>
        <DestinationMark reason={reason} picked={target === folderId} />
      </button>
    </li>
  );
}

export interface DestinationListProps<M> {
  readonly draft: MoveDraft<M>;
  readonly index: TreeIndex<M>;
  readonly rootLabel: string;
  readonly pending: boolean;
}

/** Folder search and the destination tree (or flat search results). */
export function DestinationList<M>({ draft, index, rootLabel, pending }: DestinationListProps<M>) {
  const searchId = useId();
  const { needle, rows, query, onQuery } = draft;
  return (
    <div className="nfm-move-body">
      <label className="nfm-field nfm-field--sm nfm-move-search" htmlFor={searchId}>
        <SearchIcon />
        <input id={searchId} type="search" value={query} placeholder="Find a folder" autoComplete="off" onChange={onQuery} />
      </label>
      <ul className="nfm-dest-list" role={WidgetRole.listbox} aria-label="Destination folders">
        {needle === "" && <DestinationRow draft={draft} folderId={null} name={rootLabel} depth={0} hasChildren={false} sub={null} pending={pending} />}
        {rows.map(({ item, depth, hasChildren }) => (
          <DestinationRow key={item.id} draft={draft} folderId={item.id} name={item.name} depth={depth} hasChildren={hasChildren} sub={needle === "" ? null : pathOf(index, item.parentId, rootLabel)} pending={pending} />
        ))}
        {rows.length === 0 && needle !== "" && <li className="nfm-filter-none">No folders match</li>}
      </ul>
    </div>
  );
}
