import { useCallback, useEffect, useRef, type MouseEvent } from "react";
import { WidgetRole } from "./aria.js";
import { NAME_COLUMN_ID } from "./columns.js";
import { ArrowDownIcon, ArrowUpIcon, FilterIcon, SortableIcon } from "./icons.js";
import type { ColumnFilters } from "./filterValues.js";
import type { ColumnFilter, FileColumn, SortDirection, SortState } from "./types.js";

export type CheckState = "none" | "some" | "all";

interface SortGlyphProps {
  readonly active: boolean;
  readonly direction: SortDirection;
}

function SortGlyph({ active, direction }: SortGlyphProps) {
  if (!active) {
    return <span className="nfm-sort nfm-sort--idle"><SortableIcon /></span>;
  }
  return <span className="nfm-sort">{direction === "asc" ? <ArrowUpIcon /> : <ArrowDownIcon />}</span>;
}

interface CheckAllProps {
  readonly state: CheckState;
  readonly onToggle: () => void;
}

function CheckAll({ state, onToggle }: CheckAllProps) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current !== null) {
      ref.current.indeterminate = state === "some";
    }
  }, [state]);
  return (
    <label className="nfm-checkcell" data-nfm-stop="">
      <input ref={ref} type="checkbox" className="nfm-check" aria-label="Select all in view" checked={state === "all"} onChange={onToggle} />
    </label>
  );
}

interface ColumnHandlers {
  readonly onSort: (columnId: string) => void;
  readonly onOpenFilter: (columnId: string, anchor: HTMLElement) => void;
}

interface HeaderCellProps<M> extends ColumnHandlers {
  readonly column: FileColumn<M> | null;
  readonly sort: SortState;
  readonly filter: ColumnFilter | undefined;
  readonly filterOpen: boolean;
}

function ariaSort(active: boolean, direction: SortDirection): "ascending" | "descending" | "none" {
  if (!active) {
    return "none";
  }
  return direction === "asc" ? "ascending" : "descending";
}

function HeaderCell<M>({ column, sort, filter, filterOpen, onSort, onOpenFilter }: HeaderCellProps<M>) {
  const id = column?.id ?? NAME_COLUMN_ID;
  const header = column?.header ?? "Name";
  const sortable = column === null || column.sortable !== false;
  const active = sort.columnId === id;
  const sortBy = useCallback(() => onSort(id), [onSort, id]);
  const openFilter = useCallback((event: MouseEvent<HTMLButtonElement>) => onOpenFilter(id, event.currentTarget), [onOpenFilter, id]);
  return (
    <div role={WidgetRole.columnHeader} aria-sort={sortable ? ariaSort(active, sort.direction) : undefined} className="nfm-hcell" data-align={column?.align ?? "start"} data-active={active || undefined}>
      {sortable ? (
        <button type="button" className="nfm-hbtn" onClick={sortBy} title={`Sort by ${header.toLocaleLowerCase()}`}>
          <span>{header}</span>
          <SortGlyph active={active} direction={sort.direction} />
        </button>
      ) : (
        <span className="nfm-hlabel">{header}</span>
      )}
      {column?.filterable === true && (
        <button type="button" className="nfm-hfilter" aria-label={`Filter ${header}`} aria-haspopup="dialog" aria-expanded={filterOpen} data-active={filter !== undefined || undefined} onClick={openFilter}>
          <FilterIcon />
        </button>
      )}
    </div>
  );
}

export interface TableHeadProps<M> extends ColumnHandlers {
  readonly columns: readonly FileColumn<M>[];
  readonly compact: boolean;
  readonly sort: SortState;
  readonly filters: ColumnFilters;
  readonly openFilterId: string | null;
  readonly checkState: CheckState;
  readonly onCheckAll: () => void;
}

export function TableHead<M>({ columns, compact, sort, filters, openFilterId, checkState, onCheckAll, onSort, onOpenFilter }: TableHeadProps<M>) {
  return (
    <div role={WidgetRole.rowGroup} className="nfm-thead">
      <div role={WidgetRole.row} className="nfm-hrow">
        <div role={WidgetRole.columnHeader} className="nfm-hcell nfm-hcell--check">
          <CheckAll state={checkState} onToggle={onCheckAll} />
        </div>
        <HeaderCell column={null} sort={sort} filter={undefined} filterOpen={false} onSort={onSort} onOpenFilter={onOpenFilter} />
        {!compact && columns.map((column) => <HeaderCell key={column.id} column={column} sort={sort} filter={filters[column.id]} filterOpen={openFilterId === column.id} onSort={onSort} onOpenFilter={onOpenFilter} />)}
      </div>
    </div>
  );
}
