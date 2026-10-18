import { useCallback, useState } from "react";
import { SHOW_SORTS, type ShowSort } from "../lib/libraryHome.ts";
import { cn } from "../lib/utils.ts";

const SORT_STORAGE_KEY = "nanime.showSort";

function storedSort(): ShowSort {
  const stored = globalThis.localStorage.getItem(SORT_STORAGE_KEY);
  return SHOW_SORTS.find((sort) => sort.key === stored)?.key ?? "added";
}

/** The chosen show order, remembered on this device. */
export function useShowSort(): readonly [ShowSort, (sort: ShowSort) => void] {
  const [sort, setSort] = useState<ShowSort>(storedSort);
  const choose = useCallback((next: ShowSort) => {
    globalThis.localStorage.setItem(SORT_STORAGE_KEY, next);
    setSort(next);
  }, []);
  return [sort, choose];
}

function SortTab({ option, active, onSort }: {
  readonly option: (typeof SHOW_SORTS)[number];
  readonly active: boolean;
  readonly onSort: (sort: ShowSort) => void;
}): React.JSX.Element {
  const handleClick = useCallback(() => {
    onSort(option.key);
  }, [onSort, option.key]);
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={handleClick}
      className={cn(
        "rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active ? "text-foreground" : "text-muted-foreground/70 hover:text-foreground",
      )}
    >
      {option.label}
    </button>
  );
}

export function SortTabs({ sort, onSort }: { readonly sort: ShowSort; readonly onSort: (sort: ShowSort) => void }): React.JSX.Element {
  return (
    <fieldset className="flex flex-wrap gap-x-5 gap-y-1 text-[13px] font-medium">
      <legend className="sr-only">Sort shows</legend>
      {SHOW_SORTS.map((option) => <SortTab key={option.key} option={option} active={sort === option.key} onSort={onSort} />)}
    </fieldset>
  );
}
