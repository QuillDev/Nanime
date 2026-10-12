import { useCallback, type MouseEvent, type ReactNode } from "react";
import { WidgetRole } from "./aria.js";
import { displayValue, isBlank } from "./columns.js";
import type { RenameBinding } from "./RenameField.js";
import { RowNameCell } from "./RowNameCell.js";
import type { ColumnContext, FileColumn, FileItem } from "./types.js";

export interface TableRowModel<M> {
  readonly item: FileItem<M>;
  readonly depth: number;
  /** Outline layout only: null hides the disclosure control. */
  readonly expanded: boolean | null;
  /** Parent path, shown when rows come from several folders. */
  readonly path: string | null;
}

/** Controls inside a row; clicks and keys on the row itself are delegated to the grid. */
export interface RowControls<M> {
  readonly onCheck: (item: FileItem<M>, range: boolean) => void;
  readonly onToggleExpand: (id: string) => void;
}

export interface TableRowProps<M> {
  readonly row: TableRowModel<M>;
  readonly columns: readonly FileColumn<M>[];
  readonly context: ColumnContext<M>;
  readonly compact: boolean;
  readonly selected: boolean;
  readonly tabbable: boolean;
  /** Set while this row is being renamed. */
  readonly rename: RenameBinding | null;
  readonly icon: ReactNode;
  readonly controls: RowControls<M>;
}

/** The row checkbox is driven by its click handler, which knows about Shift. */
function keepCheckboxControlled(): void {
  // Selection changes arrive through onClick.
}

/** Parent path plus, on touch layouts, the values of `metaColumns`. */
function subLine<M>(row: TableRowModel<M>, metaColumns: readonly FileColumn<M>[], context: ColumnContext<M>): string | null {
  const parts = row.path === null ? [] : [row.path];
  for (const column of metaColumns) {
    const text = displayValue(column, column.value(row.item, context), row.item);
    if (text !== "") {
      parts.push(text);
    }
  }
  return parts.length === 0 ? null : parts.join("  ·  ");
}

const NO_COLUMNS: readonly never[] = [];

interface DataCellProps<M> {
  readonly column: FileColumn<M>;
  readonly item: FileItem<M>;
  readonly context: ColumnContext<M>;
}

function DataCell<M>({ column, item, context }: DataCellProps<M>) {
  const value = column.value(item, context);
  return (
    <div role={WidgetRole.gridCell} className="nfm-cell" data-align={column.align ?? "start"} data-blank={isBlank(value) || undefined}>
      {column.render?.(item, context) ?? displayValue(column, value, item)}
    </div>
  );
}

export function TableRow<M>({ row, columns, context, compact, selected, tabbable, rename, icon, controls }: TableRowProps<M>) {
  const { item, depth, expanded } = row;
  const { onCheck, onToggleExpand } = controls;
  const handleCheck = useCallback((event: MouseEvent) => onCheck(item, event.shiftKey), [onCheck, item]);
  return (
    <div
      role={WidgetRole.row}
      className="nfm-row"
      data-nfm-row=""
      data-nfm-id={item.id}
      data-kind={item.kind}
      aria-selected={selected}
      aria-level={expanded === null && depth === 0 ? undefined : depth + 1}
      aria-expanded={expanded ?? undefined}
      tabIndex={tabbable ? 0 : -1}
    >
      <div role={WidgetRole.gridCell} className="nfm-cell nfm-cell--check">
        <label className="nfm-checkcell" data-nfm-stop="">
          <input type="checkbox" className="nfm-check" aria-label={`Select ${item.name}`} checked={selected} onChange={keepCheckboxControlled} onClick={handleCheck} />
        </label>
      </div>
      <RowNameCell item={item} depth={depth} expanded={expanded} lock={context.lockOf(item)} sub={subLine(row, compact ? columns : NO_COLUMNS, context)} rename={rename} icon={icon} onToggleExpand={onToggleExpand} />
      {!compact && columns.map((column) => <DataCell key={column.id} column={column} item={item} context={context} />)}
    </div>
  );
}
