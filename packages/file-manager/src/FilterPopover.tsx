import { useCallback, useMemo, type CSSProperties } from "react";
import { FilterPanel } from "./FilterPanel.js";
import type { ColumnFilter, FileColumn } from "./types.js";
import type { ManagerProps } from "./useFileManager.js";
import type { OpenFilter } from "./useListingOptions.js";

interface OpenPopoverProps<M> extends ManagerProps<M> {
  readonly column: FileColumn<M>;
  readonly at: OpenFilter;
}

function OpenPopover<M>({ manager, column, at }: OpenPopoverProps<M>) {
  const { model: { context }, options: { filters, setFilter }, listing: { filterSource } } = manager;
  const style = useMemo<CSSProperties>(() => ({ top: at.top, left: at.left }), [at.top, at.left]);
  const change = useCallback((filter: ColumnFilter | undefined) => setFilter(column.id, filter), [setFilter, column.id]);
  return (
    <dialog open className="nfm-popover" aria-label={`${column.header} filter`} style={style}>
      <FilterPanel column={column} items={filterSource(column.id)} context={context} filter={filters[column.id]} onChange={change} />
    </dialog>
  );
}

/** Non-modal value filter for one column, anchored under its header or chip. */
export function FilterPopover<M>({ manager }: ManagerProps<M>) {
  const { model: { columns }, options: { openFilter } } = manager;
  const column = openFilter === null ? undefined : columns.find((candidate) => candidate.id === openFilter.id);
  if (openFilter === null || column === undefined) {
    return null;
  }
  return <OpenPopover manager={manager} column={column} at={openFilter} />;
}
