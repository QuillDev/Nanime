import { useCallback } from "react";
import { Download, ExternalLink } from "lucide-react";
import { useAddTorrent } from "../hooks/useAddTorrent.ts";
import { useNyaaSearch } from "../hooks/useNyaaSearch.ts";
import type { NyaaSearchResult } from "../types.ts";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog.tsx";

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
  const results = useNyaaSearch(search, category, trusted);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] grid-rows-[auto_minmax(0,1fr)]">
        <DialogHeader>
          <DialogTitle>Nyaa results for “{search}”</DialogTitle>
          <DialogDescription>Choose a torrent to send to qBittorrent.</DialogDescription>
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
