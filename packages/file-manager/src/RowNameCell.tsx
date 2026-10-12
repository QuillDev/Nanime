import { useCallback, type ReactNode } from "react";
import { RowRename, type RenameBinding } from "./RenameField.js";
import { WidgetRole } from "./aria.js";
import { useDepthStyle } from "./depthStyle.js";
import { ChevronDownIcon, ChevronRightIcon } from "./icons.js";
import { LockMark } from "./LockMark.js";
import type { FileItem, ItemLock } from "./types.js";

interface TwistProps {
  readonly id: string;
  readonly name: string;
  readonly expanded: boolean | null;
  readonly depth: number;
  readonly onToggle: (id: string) => void;
}

function RowTwist({ id, name, expanded, depth, onToggle }: TwistProps) {
  const toggle = useCallback(() => onToggle(id), [onToggle, id]);
  if (expanded === null) {
    return depth > 0 ? <span className="nfm-twist" /> : null;
  }
  return (
    <button type="button" className="nfm-twist" data-nfm-stop="" aria-label={`${expanded ? "Collapse" : "Expand"} ${name}`} onClick={toggle}>
      {expanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
    </button>
  );
}

export interface RowNameCellProps<M> {
  readonly item: FileItem<M>;
  readonly depth: number;
  /** Outline layout only: null hides the disclosure control. */
  readonly expanded: boolean | null;
  readonly lock: ItemLock | null;
  /** Secondary line: parent path and, on touch layouts, column values. */
  readonly sub: string | null;
  /** Set while this row is being renamed. */
  readonly rename: RenameBinding | null;
  readonly icon: ReactNode;
  readonly onToggleExpand: (id: string) => void;
}

export function RowNameCell<M>({ item, depth, expanded, lock, sub, rename, icon, onToggleExpand }: RowNameCellProps<M>) {
  const style = useDepthStyle(depth);
  return (
    <div role={WidgetRole.gridCell} className="nfm-cell nfm-cell--name" style={style}>
      <RowTwist id={item.id} name={item.name} expanded={expanded} depth={depth} onToggle={onToggleExpand} />
      <span className="nfm-kind">{icon}</span>
      <span className="nfm-namewrap">
        {rename === null ? (
          <span className="nfm-nameline"><span className="nfm-name" title={item.name}>{item.name}</span><LockMark lock={lock} /></span>
        ) : (
          <RowRename key={item.id} item={item} binding={rename} />
        )}
        {sub !== null && rename === null && <span className="nfm-sub">{sub}</span>}
      </span>
    </div>
  );
}
