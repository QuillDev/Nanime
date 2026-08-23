import { HardDrive } from "lucide-react";
import { formatSize } from "../api.ts";
import { useStorageStatus } from "../hooks/useStorageStatus.ts";

export function AdminStorageStatus(): React.JSX.Element {
  const storage = useStorageStatus();

  if (storage.status === "pending") {
    return (
      <div className="flex min-w-64 items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
        <HardDrive aria-hidden="true" className="size-5 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Checking media storage…</p>
      </div>
    );
  }

  if (storage.status === "error") {
    return (
      <div className="flex min-w-64 items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
        <HardDrive aria-hidden="true" className="size-5 text-muted-foreground" />
        <div>
          <p className="text-sm font-medium">Media storage</p>
          <p className="text-xs text-destructive">Capacity unavailable</p>
        </div>
      </div>
    );
  }

  const { availableBytes, totalBytes } = storage.data;
  const freePercent = totalBytes > 0 ? availableBytes / totalBytes * 100 : 0;
  const usedPercent = Math.max(0, Math.min(100, 100 - freePercent));
  const lowSpace = freePercent < 10;

  return (
    <div className="min-w-64 rounded-lg border border-border bg-card px-4 py-3">
      <div className="mb-2 flex items-center justify-between gap-4">
        <span className="flex items-center gap-2 text-sm font-medium">
          <HardDrive aria-hidden="true" className="size-4 text-muted-foreground" />
          Media storage
        </span>
        <span className={lowSpace ? "text-xs font-medium text-destructive" : "text-xs text-muted-foreground"}>
          {freePercent.toFixed(0)}% free
        </span>
      </div>
      <progress
        aria-label="Media storage used"
        value={usedPercent}
        max={100}
        className="playback-progress h-1.5 w-full overflow-hidden rounded-full"
      />
      <p className="mt-2 text-xs text-muted-foreground">
        {formatSize(availableBytes)} available of {formatSize(totalBytes)}
      </p>
    </div>
  );
}
