import { useCallback, useMemo, useState, type ChangeEvent } from "react";
import { Search } from "lucide-react";
import { useMediaScans } from "../hooks/useMediaScans.ts";
import { useProfileEpisodes } from "../hooks/useProfileEpisodes.ts";
import { useTranscodes } from "../hooks/useTranscodes.ts";
import { groupShows } from "../lib/library.ts";
import { filterShows, type VideoFilter } from "../lib/videoFilters.ts";
import { buildVideoStatuses } from "../lib/videoStatus.ts";
import type { MediaEntry, ShowMetadata } from "../types.ts";
import { VideoListView, type VideoListState } from "./AdminVideoList.tsx";

const SELECTION_LIMIT = 100;

function useVideoSelection(entries: readonly MediaEntry[]) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const selectedEntries = useMemo(() => entries.filter((entry) => selected.has(entry.rel)), [entries, selected]);
  const handleToggleEntries = useCallback((targets: readonly MediaEntry[]) => {
    setSelected((current) => {
      const next = new Set(current);
      const shouldSelect = targets.some((entry) => !next.has(entry.rel));
      for (const entry of targets) {
        if (!shouldSelect) {
          next.delete(entry.rel);
        } else if (next.size < SELECTION_LIMIT) {
          next.add(entry.rel);
        }
      }
      return next;
    });
  }, []);
  const handleClear = useCallback(() => setSelected(new Set()), []);
  return { selected, selectedEntries, handleToggleEntries, handleClear };
}

function useStatuses() {
  const scans = useMediaScans();
  const transcodes = useTranscodes();
  return useMemo(() => buildVideoStatuses(scans.data ?? [], transcodes.data ?? []), [scans.data, transcodes.data]);
}

function useFilters() {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<VideoFilter>("all");
  const handleQuery = useCallback((event: ChangeEvent<HTMLInputElement>) => setQuery(event.currentTarget.value), []);
  const handleFilter = useCallback((event: ChangeEvent<HTMLInputElement>) => setFilter(event.currentTarget.value as VideoFilter), []);
  return { query, filter, handleQuery, handleFilter };
}

const FILTERS = [["all", "All"], ["needs-transcode", "Needs transcode"], ["unmapped", "Unmapped"]] as const;

function Toolbar({ query, filter, onQuery, onFilter }: {
  readonly query: string;
  readonly filter: VideoFilter;
  readonly onQuery: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly onFilter: (event: ChangeEvent<HTMLInputElement>) => void;
}): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex h-10 min-w-56 flex-1 items-center gap-2 rounded-lg border border-input bg-secondary px-3 focus-within:ring-2 focus-within:ring-ring">
        <Search aria-hidden="true" className="size-4 text-muted-foreground" />
        <span className="sr-only">Filter videos</span>
        <input type="search" value={query} onChange={onQuery} placeholder="Filter shows or episodes" className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
      </label>
      <fieldset aria-label="Show" className="inline-flex rounded-lg bg-secondary p-0.5">
        {FILTERS.map(([value, label]) => (
          <label key={value} className="cursor-pointer">
            <input type="radio" name="video-filter" value={value} checked={filter === value} onChange={onFilter} className="peer sr-only" />
            <span className="block rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground peer-checked:bg-accent peer-checked:text-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-ring">{label}</span>
          </label>
        ))}
      </fieldset>
    </div>
  );
}

export function AdminVideoManagement({ entries, metadata }: { readonly entries: readonly MediaEntry[]; readonly metadata: ShowMetadata }): React.JSX.Element {
  const filters = useFilters();
  const selection = useVideoSelection(entries);
  const statuses = useStatuses();
  const episodes = useProfileEpisodes();
  const shows = useMemo(
    () => filterShows(groupShows(entries, metadata), { metadata, query: filters.query, filter: filters.filter, statuses }),
    [entries, filters.filter, filters.query, metadata, statuses],
  );
  const forceOpen = filters.query.trim() !== "" || filters.filter === "needs-transcode";
  const state = useMemo<VideoListState>(() => ({
    shows,
    forceOpen,
    context: { metadata, episodes, statuses, selected: selection.selected, selectionFull: selection.selected.size >= SELECTION_LIMIT, onToggleEntries: selection.handleToggleEntries },
    selectedEntries: selection.selectedEntries,
    onClear: selection.handleClear,
  }), [episodes, forceOpen, metadata, selection.handleClear, selection.handleToggleEntries, selection.selected, selection.selectedEntries, shows, statuses]);
  return (
    <>
      <Toolbar query={filters.query} filter={filters.filter} onQuery={filters.handleQuery} onFilter={filters.handleFilter} />
      <VideoListView state={state} />
    </>
  );
}
