import { useCallback, useState, type ChangeEvent } from "react";
import { Download, ExternalLink } from "lucide-react";
import { useAddTorrent } from "../hooks/useAddTorrent.ts";
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

const CATEGORIES = [
  ["1_0", "All anime"],
  ["1_2", "English-translated"],
  ["1_3", "Non-English-translated"],
  ["1_4", "Raw"],
] as const;

function useNyaaFilters() {
  const [category, setCategory] = useState("1_0");
  const [trusted, setTrusted] = useState(false);
  const handleCategory = useCallback((event: ChangeEvent<HTMLSelectElement>) => setCategory(event.target.value), []);
  const handleTrusted = useCallback((event: ChangeEvent<HTMLInputElement>) => setTrusted(event.target.checked), []);
  return { category, trusted, handleCategory, handleTrusted };
}

function ResultRow({
  result,
  showFolder,
}: {
  readonly result: NyaaSearchResult;
  readonly showFolder: string;
}): React.JSX.Element {
  const addTorrent = useAddTorrent();
  const handleDownload = useCallback(() => {
    addTorrent.mutate({ file: null, magnet: result.magnet, showFolder });
  }, [addTorrent, result.magnet, showFolder]);

  return (
    <tr className="border-b border-border last:border-b-0">
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
          {addTorrent.error !== null && (
            <p className="text-sm text-destructive">{addTorrent.error.message}</p>
          )}
          {addTorrent.isSuccess && (
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
          disabled={addTorrent.isPending}
          aria-label={`${addTorrent.isPending ? "Adding" : "Download"} ${result.name}`}
          title="Download"
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground disabled:bg-muted disabled:text-muted-foreground"
        >
          <Download
            aria-hidden="true"
            className={`size-4 ${addTorrent.isPending ? "animate-pulse" : ""}`}
          />
        </button>
      </td>
    </tr>
  );
}

export function AdminNyaaSearchDialog({
  open,
  onOpenChange,
  search,
  showFolder,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly search: string;
  readonly showFolder: string;
}): React.JSX.Element {
  const filters = useNyaaFilters();
  const { category, trusted } = filters;
  const [sort, setSort] = useState<NyaaSort>("id");
  const [order, setOrder] = useState<NyaaSortOrder>("desc");
  const handleSort = useCallback((event: ChangeEvent<HTMLSelectElement>) => {
    setSort(nyaaSort(event.target.value));
  }, []);
  const handleOrder = useCallback((event: ChangeEvent<HTMLSelectElement>) => {
    setOrder(nyaaSortOrder(event.target.value));
  }, []);
  const results = useNyaaSearch({ search, category, trusted, sort, order });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] grid-rows-[auto_minmax(0,1fr)]">
        <DialogHeader>
          <DialogTitle>Nyaa results for “{search}”</DialogTitle>
          <DialogDescription>Choose a torrent to send to qBittorrent.</DialogDescription>
          <div className="flex flex-wrap gap-3 pt-2">
            <label className="text-xs font-medium text-muted-foreground">
              Sort by
              <select
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
                value={order}
                onChange={handleOrder}
                className="mt-1 block h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground"
              >
                <option value="desc">Descending</option>
                <option value="asc">Ascending</option>
              </select>
            </label>
            <label className="text-xs font-medium text-muted-foreground">
              Category
              <select
                value={category}
                onChange={filters.handleCategory}
                className="mt-1 block h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground"
              >
                {CATEGORIES.map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 self-end pb-2 text-sm text-muted-foreground">
              <input type="checkbox" checked={trusted} onChange={filters.handleTrusted} className="size-4 accent-primary" />
              Trusted only
            </label>
          </div>
        </DialogHeader>
        <div className="min-h-0 overflow-auto">
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
                  <th scope="col" className="pb-3 pr-4 font-medium">Title</th>
                  <th scope="col" className="px-4 pb-3 text-center font-medium">Seeders</th>
                  <th scope="col" className="px-4 pb-3 text-right font-medium">Size</th>
                  <th scope="col" className="pb-3 pl-4 text-right font-medium">Download</th>
                </tr>
              </thead>
              <tbody>
                {results.data.map((result) => (
                  <ResultRow key={result.id} result={result} showFolder={showFolder} />
                ))}
              </tbody>
            </table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
