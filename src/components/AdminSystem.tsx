import { useCallback } from "react";
import { RefreshCw } from "lucide-react";
import { formatSize } from "../format.ts";
import {
  useLibraryStatus,
  useMetadataRefreshStatus,
  useRefreshLibrary,
  useRefreshMetadata,
} from "../hooks/useLibraryMaintenance.ts";
import { useStorageStatus } from "../hooks/useStorageStatus.ts";
import { relativeTime } from "../lib/relativeTime.ts";
import { AdminPage } from "./AdminPage.tsx";
import { MaintenanceRow } from "./MaintenanceRow.tsx";

export { AdminVideoManagement } from "./AdminVideoManagement.tsx";

function StorageSection(): React.JSX.Element {
  const storage = useStorageStatus();
  if (storage.status !== "success" || storage.data.totalBytes <= 0) {
    return <p className={`text-sm ${storage.status === "error" ? "text-destructive" : "text-muted-foreground"}`}>{storage.status === "error" ? "Storage capacity unavailable." : "Checking storage…"}</p>;
  }
  const { totalBytes, availableBytes } = storage.data;
  const used = totalBytes - availableBytes;
  const low = availableBytes / totalBytes < 0.1;
  return (
    <div className="max-w-2xl">
      <p className="flex items-baseline gap-2">
        <span className="font-display text-3xl font-extrabold tracking-tight tabular-nums">{formatSize(availableBytes)}</span>
        <span className={`text-sm ${low ? "font-semibold text-warning" : "text-muted-foreground"}`}>free of {formatSize(totalBytes)}</span>
      </p>
      <progress aria-label="Media storage used" max={totalBytes} value={used} className={`${low ? "warning-progress" : "storage-meter"} mt-3 block h-1.5 w-full overflow-hidden rounded-full`} />
      <p className="mt-2 text-[13px] text-muted-foreground">{formatSize(used)} used</p>
    </div>
  );
}

function LibraryScanRow(): React.JSX.Element {
  const library = useLibraryStatus();
  const refresh = useRefreshLibrary();
  const handleRefresh = useCallback(() => refresh.mutate(), [refresh]);
  const scanning = refresh.isPending || library.data?.scanning === true;
  const last = library.data?.lastScannedAt ?? null;
  const detail = library.data === undefined
    ? "Loading…"
    : `${String(library.data.entryCount)} episodes · ${last === null ? "never scanned" : `scanned ${relativeTime(last)}`}`;
  return (
    <MaintenanceRow title="Library scan" detail={detail} busy={scanning} action={scanning ? "Scanning…" : "Rescan"} onAction={handleRefresh} error={refresh.error?.message ?? null} />
  );
}

function metadataDetail(status: ReturnType<typeof useMetadataRefreshStatus>["data"]): string {
  if (status === undefined) {
    return "Loading…";
  }
  if (status.state === "running") {
    return `Refreshing ${String(status.completed)} of ${String(status.total)} shows`;
  }
  const failed = status.failed > 0 ? ` · ${String(status.failed)} failed` : "";
  return status.completedAt === null ? "Never refreshed" : `Refreshed ${relativeTime(status.completedAt)}${failed}`;
}

function MetadataRow(): React.JSX.Element {
  const metadata = useMetadataRefreshStatus();
  const refresh = useRefreshMetadata();
  const handleRefresh = useCallback(() => refresh.mutate(), [refresh]);
  const status = metadata.data;
  const running = status?.state === "running";
  return (
    <MaintenanceRow
      title="Show metadata"
      detail={metadataDetail(status)}
      busy={refresh.isPending || running}
      action={running ? "Refreshing…" : "Refresh all"}
      onAction={handleRefresh}
      error={refresh.error?.message ?? status?.error ?? null}
      progress={running && status.total > 0 ? status.completed / status.total : null}
    />
  );
}

export function AdminSystem(): React.JSX.Element {
  return (
    <AdminPage title="System">
      <section aria-labelledby="system-storage">
        <h2 id="system-storage" className="mb-3 font-display text-lg font-bold tracking-tight">Storage</h2>
        <StorageSection />
      </section>
      <section aria-labelledby="system-library" className="mt-10">
        <h2 id="system-library" className="mb-1 font-display text-lg font-bold tracking-tight">Library</h2>
        <ul>
          <LibraryScanRow />
          <MetadataRow />
        </ul>
        <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
          <RefreshCw aria-hidden="true" className="size-3" />
          Metadata refreshes run slowly to stay inside AniList and TVmaze rate limits.
        </p>
      </section>
    </AdminPage>
  );
}
