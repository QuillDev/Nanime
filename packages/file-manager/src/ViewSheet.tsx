import { useCallback, useMemo } from "react";
import { WidgetRole } from "./aria.js";
import { NAME_COLUMN_ID } from "./columns.js";
import { FilterPanel } from "./FilterPanel.js";
import { describeFilter } from "./filterValues.js";
import { ArrowDownIcon, ArrowUpIcon } from "./icons.js";
import { Sheet, SheetFooter, SheetHeader } from "./Sheet.js";
import { plural } from "./text.js";
import type { ColumnFilter, FileColumn, SortState } from "./types.js";
import type { ManagerProps } from "./useFileManager.js";

interface SortChoice {
  readonly id: string;
  readonly header: string;
}

function sortChoices<M>(columns: readonly FileColumn<M>[]): SortChoice[] {
  const choices: SortChoice[] = [{ id: NAME_COLUMN_ID, header: "Name" }];
  for (const column of columns) {
    if (column.sortable !== false) {
      choices.push({ id: column.id, header: column.header });
    }
  }
  return choices;
}

interface SortOptionProps {
  readonly choice: SortChoice;
  readonly sort: SortState;
  readonly onSort: (columnId: string) => void;
}

function SortOption({ choice, sort, onSort }: SortOptionProps) {
  const active = sort.columnId === choice.id;
  const select = useCallback(() => onSort(choice.id), [onSort, choice.id]);
  return (
    <button type="button" role={WidgetRole.radio} aria-checked={active} className="nfm-viewsort-opt" onClick={select}>
      {choice.header}{active && (sort.direction === "asc" ? <ArrowUpIcon /> : <ArrowDownIcon />)}
    </button>
  );
}

interface ViewFilterProps<M> extends ManagerProps<M> {
  readonly column: FileColumn<M>;
}

function ViewFilter<M>({ manager, column }: ViewFilterProps<M>) {
  const { model: { context }, options: { filters, setFilter }, listing: { filterSource } } = manager;
  const filter = filters[column.id];
  const change = useCallback((next: ColumnFilter | undefined) => setFilter(column.id, next), [setFilter, column.id]);
  if (column.filterable !== true) {
    return null;
  }
  return (
    <details className="nfm-viewfilter" open={filter !== undefined}>
      <summary>{column.header}{filter !== undefined && <b>{describeFilter(filter)}</b>}</summary>
      <FilterPanel column={column} items={filterSource(column.id)} context={context} filter={filter} onChange={change} />
    </details>
  );
}

/** Touch layouts: sorting and column filters in one sheet. */
export function ViewSheet<M>({ manager }: ManagerProps<M>) {
  const { model: { columns }, options: { sort, cycleSort, filterIds, clearFilters }, listing: { rows }, dialogs: { closeDialog } } = manager;
  const choices = useMemo(() => sortChoices(columns), [columns]);
  return (
    <Sheet className="nfm-sheet--view" busy={false} onClose={closeDialog}>
      <SheetHeader title="Sort and filter" />
      <div className="nfm-viewsheet">
        <div className="nfm-viewsort" role="radiogroup" aria-label="Sort by">
          {choices.map((choice) => <SortOption key={choice.id} choice={choice} sort={sort} onSort={cycleSort} />)}
        </div>
        {columns.map((column) => <ViewFilter key={column.id} manager={manager} column={column} />)}
      </div>
      <SheetFooter>
        <div className="nfm-foot-row">
          <button type="button" className="nfm-link" onClick={clearFilters} disabled={filterIds.length === 0}>Clear filters</button>
          <span className="nfm-grow" />
          <button type="button" className="nfm-btn nfm-btn--primary" onClick={closeDialog}>Show {plural(rows.length, "item")}</button>
        </div>
      </SheetFooter>
    </Sheet>
  );
}
