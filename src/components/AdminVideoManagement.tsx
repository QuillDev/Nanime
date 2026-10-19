import { useCallback, useMemo, useState, type ChangeEvent } from "react";
import { Search, WandSparkles } from "lucide-react";
import { useStartTranscode } from "../hooks/useTranscodes.ts";
import { mediaTitle } from "../lib/anilist.ts";
import { groupShows, showMetadataKey, type ShowGroup } from "../lib/library.ts";
import type { MediaEntry, ShowMetadata, TranscodePreset } from "../types.ts";
import { AdminPanel } from "./AdminPanel.tsx";
import { AdminVideoTree } from "./AdminVideoTree.tsx";
import {
  AdminVideoActions,
  AdminVideoDialogs,
  type PruneMode,
} from "./AdminVideoDialogs.tsx";

function resolvedShowTitle(show: ShowGroup, metadata: ShowMetadata): string {
  const media = metadata[showMetadataKey(show.name)];
  return media === undefined ? show.name : mediaTitle(media);
}

function useVideoSelection(entries: readonly MediaEntry[]) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const selectedEntries = useMemo(() => entries.filter((entry) => selected.has(entry.rel)), [entries, selected]);
  const handleToggleEntries = useCallback((targets: readonly MediaEntry[]) => {
    setSelected((current) => {
      const next = new Set(current);
      const shouldSelect = targets.some((entry) => !next.has(entry.rel));
      for (const entry of targets) {
        if (shouldSelect && next.size < 100) {
          next.add(entry.rel);
        } else if (!shouldSelect) {
          next.delete(entry.rel);
        }
      }
      return next;
    });
  }, []);
  const handleClear = useCallback(() => setSelected(new Set()), []);
  return { selected, selectedEntries, handleToggleEntries, handleClear };
}

function useFilteredShows(entries: readonly MediaEntry[], metadata: ShowMetadata, query: string): readonly ShowGroup[] {
  return useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return groupShows(entries, metadata).filter((show) => needle === "" || [resolvedShowTitle(show, metadata), show.name, ...show.entries.map((entry) => entry.name)].join(" ").toLocaleLowerCase().includes(needle));
  }, [entries, metadata, query]);
}

function useManagementFilters() {
  const [query, setQuery] = useState("");
  const [preset, setPreset] = useState<TranscodePreset>("space-saver");
  const handleQuery = useCallback((event: ChangeEvent<HTMLInputElement>) => setQuery(event.currentTarget.value), []);
  const handlePreset = useCallback((event: ChangeEvent<HTMLSelectElement>) => setPreset(event.currentTarget.value as TranscodePreset), []);
  return { query, preset, handleQuery, handlePreset };
}

function useManagementDialogs(selectedEntries: readonly MediaEntry[], onFinished: () => void) {
  const [pruneMode, setPruneMode] = useState<PruneMode | null>(null);
  const [subtitleEntry, setSubtitleEntry] = useState<MediaEntry | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const handleAddSubtitles = useCallback(() => {
    const [entry] = selectedEntries;
    if (selectedEntries.length === 1 && entry !== undefined) {setSubtitleEntry(entry);}
  }, [selectedEntries]);
  const handleClosePrune = useCallback(() => setPruneMode(null), []);
  const handleCloseSubtitles = useCallback(() => setSubtitleEntry(null), []);
  const handleDelete = useCallback(() => setDeleteOpen(true), []);
  const handleCloseDelete = useCallback(() => setDeleteOpen(false), []);
  const handleFinished = useCallback(() => {setPruneMode(null); setDeleteOpen(false); onFinished();}, [onFinished]);
  return { pruneMode, subtitleEntry, deleteOpen, setPruneMode, handleAddSubtitles, handleClosePrune, handleCloseSubtitles, handleDelete, handleCloseDelete, handleFinished };
}

export function AdminVideoManagement({ entries, metadata }: { readonly entries: readonly MediaEntry[]; readonly metadata: ShowMetadata }): React.JSX.Element {
  const filters = useManagementFilters();
  const transcode = useStartTranscode();
  const selection = useVideoSelection(entries);
  const dialogs = useManagementDialogs(selection.selectedEntries, selection.handleClear);
  const { setPruneMode: handlePrune } = dialogs;
  const shows = useFilteredShows(entries, metadata, filters.query);
  const handleTranscode = useCallback(() => transcode.mutate({ paths: selection.selectedEntries.map((entry) => entry.rel), preset: filters.preset }), [filters.preset, selection.selectedEntries, transcode]);
  return (
    <div className="space-y-4">
      <AdminPanel title="Video management" description="Select shows, seasons, or individual episodes, then process up to 100 videos together." icon={WandSparkles}>
        <div className="space-y-3">
          <div className="relative"><label htmlFor="video-management-filter" className="sr-only">Filter videos</label><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><input id="video-management-filter" type="search" value={filters.query} onChange={filters.handleQuery} placeholder="Filter shows or episodes…" className="h-10 w-full rounded-md border border-border bg-background pl-9 pr-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" /></div>
          <AdminVideoActions selectedEntries={selection.selectedEntries} preset={filters.preset} pending={transcode.isPending} onPreset={filters.handlePreset} onTranscode={handleTranscode} onPrune={handlePrune} onAddSubtitles={dialogs.handleAddSubtitles} onDelete={dialogs.handleDelete} />
          {transcode.error !== null && <p className="select-text text-sm text-destructive">{transcode.error.message}</p>}
          <div className="max-h-[65dvh] overflow-y-auto rounded-md border border-border bg-background"><AdminVideoTree shows={shows} metadata={metadata} selected={selection.selected} forceOpen={filters.query.trim() !== ""} onToggleEntries={selection.handleToggleEntries} />{shows.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">No videos match.</p>}</div>
        </div>
      </AdminPanel>
      <AdminVideoDialogs selected={selection.selectedEntries} pruneMode={dialogs.pruneMode} subtitleEntry={dialogs.subtitleEntry} deleteOpen={dialogs.deleteOpen} onClosePrune={dialogs.handleClosePrune} onCloseSubtitles={dialogs.handleCloseSubtitles} onCloseDelete={dialogs.handleCloseDelete} onFinished={dialogs.handleFinished} />
    </div>
  );
}
