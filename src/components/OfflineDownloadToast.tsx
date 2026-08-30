import { Download, X } from "lucide-react";
import { useCallback, useSyncExternalStore } from "react";
import { navigateToDownloads } from "../hooks/useMediaRoute.ts";
import {
  dismissOfflineDownloadNotice,
  offlineDownloadNoticeSnapshot,
  subscribeToOfflineDownloadNotices,
} from "../offline/notifications.ts";

export function OfflineDownloadToast(): React.JSX.Element | null {
  const notice = useSyncExternalStore(
    subscribeToOfflineDownloadNotices,
    offlineDownloadNoticeSnapshot,
    () => null,
  );
  const viewDownloads = useCallback(() => {
    dismissOfflineDownloadNotice();
    navigateToDownloads();
  }, []);
  if (notice === null) {
    return null;
  }
  return (
    <output
      aria-live="polite"
      className="fixed inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-[70] mx-auto flex max-w-md items-start gap-3 rounded-lg border border-border bg-popover p-4 text-popover-foreground shadow-2xl"
    >
      <Download aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-primary" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">Download started</p>
        <p className="mt-1 truncate text-sm text-muted-foreground" title={notice.name}>{notice.name}</p>
        <p className="mt-1 text-xs text-muted-foreground">You can keep browsing while it downloads.</p>
        <button type="button" onClick={viewDownloads} className="mt-3 text-sm font-semibold text-primary hover:underline">
          View download progress
        </button>
      </div>
      <button
        aria-label="Dismiss download notification"
        className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        onClick={dismissOfflineDownloadNotice}
        type="button"
      >
        <X aria-hidden="true" className="size-4" />
      </button>
    </output>
  );
}
