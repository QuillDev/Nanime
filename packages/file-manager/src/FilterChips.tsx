import { useCallback, type MouseEvent } from "react";
import { describeFilter } from "./filterValues.js";
import { CloseIcon } from "./icons.js";
import type { ColumnFilter } from "./types.js";
import type { ManagerProps } from "./useFileManager.js";

interface FilterChipProps {
  readonly columnId: string;
  readonly header: string;
  readonly filter: ColumnFilter;
  readonly onEdit: (columnId: string, anchor: HTMLElement) => void;
  readonly onRemove: (columnId: string, filter: undefined) => void;
}

function FilterChip({ columnId, header, filter, onEdit, onRemove }: FilterChipProps) {
  const edit = useCallback((event: MouseEvent<HTMLButtonElement>) => onEdit(columnId, event.currentTarget), [onEdit, columnId]);
  const remove = useCallback(() => onRemove(columnId, undefined), [onRemove, columnId]);
  return (
    <span className="nfm-chip">
      <button type="button" className="nfm-chip-body" onClick={edit}>{header}: <b>{describeFilter(filter)}</b></button>
      <button type="button" className="nfm-chip-x" aria-label={`Remove ${header} filter`} onClick={remove}><CloseIcon /></button>
    </span>
  );
}

/** Active column filters, each reopening its popover, plus a way to drop them all. */
export function FilterChips<M>({ manager }: ManagerProps<M>) {
  const { model: { columns }, options: { filters, filterIds, openFilterAt, setFilter, clearFilters } } = manager;
  if (filterIds.length === 0) {
    return null;
  }
  return (
    <div className="nfm-chips" aria-label="Active filters">
      {filterIds.map((id) => {
        const column = columns.find((candidate) => candidate.id === id);
        const filter = filters[id];
        return column === undefined || filter === undefined ? null : <FilterChip key={id} columnId={id} header={column.header} filter={filter} onEdit={openFilterAt} onRemove={setFilter} />;
      })}
      <button type="button" className="nfm-link" onClick={clearFilters}>Clear filters</button>
    </div>
  );
}
