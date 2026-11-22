import { useCallback } from "react";
import { SHOW_FILTERS, type ShowFilter } from "../lib/libraryHome.ts";
import { cn } from "../lib/utils.ts";

function FilterButton({ option, active, onFilter }: {
  readonly option: (typeof SHOW_FILTERS)[number];
  readonly active: boolean;
  readonly onFilter: (filter: ShowFilter) => void;
}): React.JSX.Element {
  const handleClick = useCallback(() => {
    onFilter(option.key);
  }, [onFilter, option.key]);
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={handleClick}
      className={cn(
        "flex h-10 shrink-0 origin-left items-center rounded-sm font-display font-bold tracking-tight transition-transform duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
        // Hovering grows a filter to the selected one's size, without moving its neighbors.
        active ? "text-xl text-foreground" : "text-[17px] text-muted-foreground hover:scale-[1.176] hover:text-foreground",
      )}
    >
      {option.label}
    </button>
  );
}

/** The library's filters: a rail beside the shows, a swipe row above them on small screens. */
export function ShowFilters({ filter, onFilter }: { readonly filter: ShowFilter; readonly onFilter: (filter: ShowFilter) => void }): React.JSX.Element {
  return (
    <fieldset className="-mx-6 mb-5 flex min-w-0 gap-x-6 overflow-x-auto px-6 lg:sticky lg:top-[calc(var(--header-height)+1.5rem)] lg:mx-0 lg:mb-0 lg:flex-col lg:gap-y-0.5 lg:self-start lg:overflow-visible lg:px-0">
      <legend className="sr-only">Filter shows</legend>
      {SHOW_FILTERS.map((option) => <FilterButton key={option.key} option={option} active={filter === option.key} onFilter={onFilter} />)}
    </fieldset>
  );
}
