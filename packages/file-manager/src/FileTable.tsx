import { useMemo, useRef, type CSSProperties } from "react";
import { WidgetRole } from "./aria.js";
import { folderFacts } from "./folderFacts.js";
import type { RenameBinding } from "./RenameField.js";
import { TableHead, type CheckState } from "./TableHead.js";
import { TableRow, type RowControls, type TableRowModel } from "./TableRow.js";
import type { FileColumn } from "./types.js";
import type { Manager, ManagerProps } from "./useFileManager.js";
import { useRowEvents, type RowEventHandlers } from "./useRowEvents.js";

interface GridStyle extends CSSProperties {
  readonly "--nfm-cols": string;
}

export function gridTemplate<M>(columns: readonly FileColumn<M>[], compact: boolean): string {
  if (compact) {
    return "44px minmax(0, 1fr)";
  }
  return ["40px", "minmax(220px, 1fr)", ...columns.map((column) => column.width ?? "minmax(72px, 0.4fr)")].join(" ");
}

function checkState<M>(rows: readonly TableRowModel<M>[], selected: ReadonlySet<string>): CheckState {
  const inView = rows.filter((row) => selected.has(row.item.id)).length;
  if (inView === 0) {
    return "none";
  }
  return inView === rows.length ? "all" : "some";
}

function useRowEventHandlers<M>({ rows }: Manager<M>): RowEventHandlers<M> {
  const { onRowClick, openItem, onRowKeyDown } = rows;
  return useMemo(() => ({ onRowClick, onRowDoubleClick: openItem, onRowKeyDown }), [onRowClick, openItem, onRowKeyDown]);
}

function useRowControls<M>({ rows }: Manager<M>): RowControls<M> {
  const { onCheck, onToggleExpand } = rows;
  return useMemo(() => ({ onCheck, onToggleExpand }), [onCheck, onToggleExpand]);
}

function useRenameBinding<M>({ rename, runner }: Manager<M>): RenameBinding {
  const { renameError, clearRenameError, cancelRename, submitRename } = rename;
  const { busy } = runner;
  return useMemo(() => ({ error: renameError, pending: busy, onEdit: clearRenameError, onCancel: cancelRename, onSubmit: submitRename }), [renameError, busy, clearRenameError, cancelRename, submitRename]);
}

interface RowListProps<M> extends ManagerProps<M> {
  readonly controls: RowControls<M>;
  readonly binding: RenameBinding;
}

function RowList<M>({ manager, controls, binding }: RowListProps<M>) {
  const { model: { context, compact, renderIcon }, selection: { selectedSet, focusedId }, listing: { rows, visibleColumns }, rename: { renamingId } } = manager;
  const tabbableId = focusedId ?? rows[0]?.item.id ?? null;
  return rows.map((row) => (
    <TableRow
      key={row.item.id}
      row={row}
      columns={visibleColumns}
      context={context}
      compact={compact}
      selected={selectedSet.has(row.item.id)}
      tabbable={tabbableId === row.item.id}
      rename={renamingId === row.item.id ? binding : null}
      icon={renderIcon(row.item, row.expanded === true)}
      controls={controls}
    />
  ));
}

/** The file grid for the current listing. */
export function FileTable<M>({ manager }: ManagerProps<M>) {
  const { model: { index, labels, compact }, navigator: { folderId }, options: { sort, filters, openFilter, cycleSort, toggleFilter }, selection: { selectedSet }, listing: { rows, visibleColumns, filtering }, rows: { checkAll } } = manager;
  const style = useMemo<GridStyle>(() => ({ "--nfm-cols": gridTemplate(visibleColumns, compact) }), [visibleColumns, compact]);
  const grid = useRef<HTMLDivElement>(null);
  useRowEvents(grid, index, useRowEventHandlers(manager));
  const controls = useRowControls(manager);
  const binding = useRenameBinding(manager);
  const { currentName } = folderFacts(index, folderId, labels.root);
  return (
    <div ref={grid} className="nfm-table" role="grid" aria-label={filtering ? `Results in ${currentName}` : currentName} aria-multiselectable="true" aria-rowcount={rows.length + 1} style={style}>
      <TableHead columns={visibleColumns} compact={compact} sort={sort} filters={filters} openFilterId={openFilter?.id ?? null} checkState={checkState(rows, selectedSet)} onCheckAll={checkAll} onSort={cycleSort} onOpenFilter={toggleFilter} />
      <div role={WidgetRole.rowGroup} className="nfm-tbody">
        <RowList manager={manager} controls={controls} binding={binding} />
        {rows.length === 0 && <div className="nfm-empty">{filtering ? labels.noResults : labels.empty}</div>}
      </div>
    </div>
  );
}
