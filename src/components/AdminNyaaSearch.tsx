import { useCallback, useState, type ChangeEvent } from "react";
import { Download, ExternalLink } from "lucide-react";
import { useNyaaDownloads } from "../hooks/useNyaaDownloads.ts";
import { useNyaaSearch } from "../hooks/useNyaaSearch.ts";
import type { NyaaSearchResult, NyaaSort, NyaaSortOrder } from "../types.ts";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog.tsx";

const SORT_OPTIONS: readonly (readonly [NyaaSort, string])[] = [
  ["id", "Upload date"],
  ["seeders", "Seeders"],
  ["leechers", "Leechers"],
  ["downloads", "Downloads"],
  ["size", "Size"],
];

function nyaaSort(value: string): NyaaSort {
  if (
    value === "size" || value === "seeders" || value === "leechers" ||
    value === "downloads"
  ) {
    return value;
  }
  return "id";
}

function nyaaSortOrder(value: string): NyaaSortOrder {
  return value === "asc" ? "asc" : "desc";
}

function ResultRow({
  result,
  downloads,
}: {
  readonly result: NyaaSearchResult;
  readonly downloads: ReturnType<typeof useNyaaDownloads>;
}): React.JSX.Element {
  const state = downloads.downloads.get(result.magnet);
  const handleDownload = useCallback(() => {
    void downloads.download([result]);
  }, [downloads, result]);
  const handleSelect = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    downloads.select(result.magnet, event.target.checked);
  }, [downloads, result.magnet]);

  return (
    <tr className="border-b border-border last:border-b-0">
      <td className="py-3 pr-3">
        <input
          type="checkbox"
          aria-label={`Select ${result.name}`}
          checked={downloads.selected.has(result.magnet)}
          onChange={handleSelect}
          disabled={downloads.pending || !downloads.available(result)}
          className="size-4 accent-primary"
        />
      </td>
      <td className="min-w-80 py-3 pr-4 align-middle">
        <div className="space-y-1.5">
          <a
            href={result.detailsUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex break-words text-sm font-medium hover:text-primary"
          >
            {result.name}
            <ExternalLink aria-hidden="true" className="ml-1 mt-0.5 size-3.5 shrink-0" />
          </a>
          <div className="flex flex-wrap items-center gap-2">
            {result.trusted && (
              <span className="rounded-sm bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground">
                Trusted
              </span>
            )}
            {result.remake && (
              <span className="rounded-sm bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                Remake
              </span>
            )}
            <span className="text-xs text-muted-foreground">{result.category}</span>
          </div>
          {state?.status === "error" && (
            <p role="alert" className="text-sm text-destructive">{state.error}</p>
          )}
          {state?.status === "success" && (
            <p className="text-sm text-primary">Added to qBittorrent.</p>
          )}
        </div>
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-center text-sm tabular-nums">
        {result.seeders}
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-right text-sm text-muted-foreground">
        {result.size}
      </td>
      <td className="py-3 pl-4 text-right">
        <button
          type="button"
          onClick={handleDownload}
          disabled={downloads.pending || !downloads.available(result)}
          aria-label={`${state?.status === "pending" ? "Adding" : "Download"} ${result.name}`}
          title="Download"
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground disabled:bg-muted disabled:text-muted-foreground"
        >
          <Download
            aria-hidden="true"
            className={`size-4 ${state?.status === "pending" ? "animate-pulse" : ""}`}
          />
        </button>
      </td>
    </tr>
  );
}

function SelectAllResults({
  results,
  downloads,
}: {
  readonly results: readonly NyaaSearchResult[];
  readonly downloads: ReturnType<typeof useNyaaDownloads>;
}): React.JSX.Element {
  const available = results.filter((result) => downloads.available(result));
  const selectedCount = available.filter((result) => downloads.selected.has(result.magnet)).length;
  const handleChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    downloads.selectAll(results, event.target.checked);
  }, [downloads, results]);
  const handleRef = useCallback((input: HTMLInputElement | null) => {
    if (input !== null) {
      input.indeterminate = selectedCount > 0 && selectedCount < available.length;
    }
  }, [available.length, selectedCount]);
  return (
    <input
      ref={handleRef}
      type="checkbox"
      aria-label="Select all available results"
      disabled={downloads.pending || available.length === 0}
      checked={available.length > 0 && selectedCount === available.length}
      onChange={handleChange}
      className="size-4 accent-primary"
    />
  );
}

function SearchSession({
  open,
  onOpenChange,
  search,
  category,
  trusted,
  showFolder,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly search: string;
  readonly category: string;
  readonly trusted: boolean;
  readonly showFolder: string;
}): React.JSX.Element {
  const downloads = useNyaaDownloads(showFolder);
  const [sort, setSort] = useState<NyaaSort>("id");
  const [order, setOrder] = useState<NyaaSortOrder>("desc");
  const handleSort = useCallback((event: ChangeEvent<HTMLSelectElement>) => {
    downloads.selectAll([], false);
    setSort(nyaaSort(event.target.value));
  }, [downloads]);
  const handleOrder = useCallback((event: ChangeEvent<HTMLSelectElement>) => {
    downloads.selectAll([], false);
    setOrder(nyaaSortOrder(event.target.value));
  }, [downloads]);
  const results = useNyaaSearch({ search, category, trusted, sort, order });
  const handleOpenChange = useCallback((nextOpen: boolean) => {
    if (!downloads.pending) {
      onOpenChange(nextOpen);
    }
  }, [downloads.pending, onOpenChange]);
  const handleBulkDownload = useCallback(() => {
    void downloads.download((results.data ?? []).filter((result) => downloads.selected.has(result.magnet)));
  }, [downloads, results.data]);
  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[85vh] grid-rows-[auto_minmax(0,1fr)]">
        <DialogHeader>
          <DialogTitle>Nyaa results for “{search}”</DialogTitle>
          <DialogDescription>Choose torrents to send to qBittorrent. Destination: {showFolder || "New show (library root)"}.</DialogDescription>
          <div className="flex flex-wrap gap-3 pt-2">
            <label className="text-xs font-medium text-muted-foreground">
              Sort by
              <select
                disabled={downloads.pending}
                value={sort}
                onChange={handleSort}
                className="mt-1 block h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground"
              >
                {SORT_OPTIONS.map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            <label className="text-xs font-medium text-muted-foreground">
              Order
              <select
                disabled={downloads.pending}
                value={order}
                onChange={handleOrder}
                className="mt-1 block h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground"
              >
                <option value="desc">Descending</option>
                <option value="asc">Ascending</option>
              </select>
            </label>
          </div>
        </DialogHeader>
        <div className="min-h-0 overflow-auto">
          <div className="mb-3 flex items-center justify-between gap-3">
            <output aria-live="polite" className="text-sm text-muted-foreground">{downloads.selected.size} selected{downloads.pending ? " · Adding…" : ""}</output>
            <button
              type="button"
              disabled={downloads.selected.size === 0 || downloads.pending}
              onClick={handleBulkDownload}
              className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:bg-muted disabled:text-muted-foreground"
            >
              Download selected
            </button>
          </div>
          {results.status === "pending" && (
            <p className="py-12 text-center text-sm text-muted-foreground">Searching Nyaa…</p>
          )}
          {results.status === "error" && (
            <p className="py-6 text-sm text-destructive">{results.error.message}</p>
          )}
          {results.status === "success" && results.data.length === 0 && (
            <p className="py-12 text-center text-sm text-muted-foreground">
              No matching torrents found.
            </p>
          )}
          {results.status === "success" && results.data.length > 0 && (
            <table className="w-full border-collapse">
              <thead className="sticky top-0 bg-background">
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th scope="col" className="pb-3 pr-3">
                    <SelectAllResults results={results.data} downloads={downloads} />
                  </th>
                  <th scope="col" className="pb-3 pr-4 font-medium">Title</th>
                  <th scope="col" className="px-4 pb-3 text-center font-medium">Seeders</th>
                  <th scope="col" className="px-4 pb-3 text-right font-medium">Size</th>
                  <th scope="col" className="pb-3 pl-4 text-right font-medium">Download</th>
                </tr>
              </thead>
              <tbody>
                {results.data.map((result) => (
                  <ResultRow key={result.id} result={result} downloads={downloads} />
                ))}
              </tbody>
            </table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function AdminNyaaSearchDialog(props: Parameters<typeof SearchSession>[0]): React.JSX.Element | null {
  if (!props.open) {
    return null;
  }
  return (
    <SearchSession
      key={JSON.stringify([props.search, props.category, props.trusted, props.showFolder])}
      open={props.open}
      onOpenChange={props.onOpenChange}
      search={props.search}
      category={props.category}
      trusted={props.trusted}
      showFolder={props.showFolder}
    />
  );
}
