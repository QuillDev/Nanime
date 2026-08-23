import { useCallback } from "react";
import { Database, RefreshCw } from "lucide-react";
import {
  useLibraryStatus,
  useMetadataRefreshStatus,
  useRefreshLibrary,
  useRefreshMetadata,
} from "../hooks/useLibraryMaintenance.ts";
import { AdminPanel } from "./AdminPanel.tsx";

function timestamp(value: number | null | undefined): string {
  return value === null || value === undefined ? "Never" : new Date(value).toLocaleString();
}

export function AdminLibraryMaintenance(): React.JSX.Element {
  const library = useLibraryStatus();
  const metadata = useMetadataRefreshStatus();
  const refreshLibrary = useRefreshLibrary();
  const refreshMetadata = useRefreshMetadata();
  const handleLibraryRefresh = useCallback(() => refreshLibrary.mutate(), [refreshLibrary]);
  const handleMetadataRefresh = useCallback(() => refreshMetadata.mutate(), [refreshMetadata]);
  const metadataRunning = metadata.data?.state === "running";
  return (
    <div className="grid items-start gap-4 lg:grid-cols-2">
      <AdminPanel
        title="Library catalog"
        description="The filesystem is scanned in the background and cached in SQLite."
        icon={Database}
      >
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Episodes</dt><dd>{library.data?.entryCount ?? "—"}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Last scan</dt><dd className="text-right">{timestamp(library.data?.lastScannedAt)}</dd></div>
        </dl>
        <button
          type="button"
          onClick={handleLibraryRefresh}
          disabled={refreshLibrary.isPending || library.data?.scanning === true}
          className="mt-5 inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:bg-muted disabled:text-muted-foreground"
        >
          <RefreshCw className={refreshLibrary.isPending ? "size-4 animate-spin" : "size-4"} />
          {refreshLibrary.isPending ? "Scanning…" : "Rescan library"}
        </button>
        {refreshLibrary.error !== null && <p className="mt-3 select-text text-sm text-destructive">{refreshLibrary.error.message}</p>}
      </AdminPanel>
      <AdminPanel
        title="Cached show metadata"
        description="AniList titles, covers, descriptions, and TVmaze episode data change only when refreshed here."
        icon={RefreshCw}
      >
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Status</dt><dd className="capitalize">{metadata.data?.state ?? "Loading"}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Progress</dt><dd>{metadata.data === undefined ? "—" : `${String(metadata.data.completed)} / ${String(metadata.data.total)}`}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Last completed</dt><dd className="text-right">{timestamp(metadata.data?.completedAt)}</dd></div>
          {(metadata.data?.failed ?? 0) > 0 && <div className="flex justify-between gap-4 text-destructive"><dt>Failed</dt><dd>{metadata.data?.failed}</dd></div>}
        </dl>
        <button
          type="button"
          onClick={handleMetadataRefresh}
          disabled={refreshMetadata.isPending || metadataRunning}
          className="mt-5 inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:bg-muted disabled:text-muted-foreground"
        >
          <RefreshCw className={metadataRunning ? "size-4 animate-spin" : "size-4"} />
          {metadataRunning ? "Refreshing…" : "Refresh all metadata"}
        </button>
        <p className="mt-3 text-xs leading-5 text-muted-foreground">Large libraries refresh gradually to stay within upstream API limits. Cached data remains available throughout.</p>
        {metadata.data?.error !== null && metadata.data?.error !== undefined && <p className="mt-3 select-text text-sm text-destructive">{metadata.data.error}</p>}
        {refreshMetadata.error !== null && <p className="mt-3 select-text text-sm text-destructive">{refreshMetadata.error.message}</p>}
      </AdminPanel>
    </div>
  );
}
