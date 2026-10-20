import { useCallback, useState } from "react";
import { Bell } from "lucide-react";
import { useNotifications } from "../hooks/useNotifications.ts";
import { usePartyPopover } from "../hooks/usePartyPopover.ts";
import { showMetadataKey, type ShowGroup } from "../lib/library.ts";
import type { BellTone } from "../lib/notifications.ts";
import { AniListLinkDialog } from "./AniListLinkDialog.tsx";
import { NotificationList } from "./NotificationList.tsx";

const DOT_CLASS = {
  attention: "bg-warning",
  busy: "animate-pulse bg-primary motion-reduce:animate-none",
} as const satisfies Record<Exclude<BellTone, "idle">, string>;

/** Admin bell: shows to match, downloads and transcodes to keep an eye on. */
export function NotificationBell(): React.JSX.Element {
  const notifications = useNotifications();
  const { id, triggerRef, panelRef, open, handleToggle, handleClose } = usePartyPopover();
  const [matching, setMatching] = useState<ShowGroup | null>(null);
  const handleMatch = useCallback((show: ShowGroup) => {
    handleClose();
    setMatching(show);
  }, [handleClose]);
  const handleDialogClose = useCallback(() => {
    setMatching(null);
  }, []);
  const { tone } = notifications;
  return (
    <>
      <button ref={triggerRef} type="button" aria-label="Notifications" aria-expanded={open} aria-controls={id} popoverTarget={id} data-active={open} className="mobile-nav-item relative">
        <Bell className="size-4" />
        {tone !== "idle" && <span aria-hidden="true" className={`absolute right-1.5 top-1.5 size-2 rounded-full ring-2 ring-background ${DOT_CLASS[tone]}`} />}
      </button>
      <div ref={panelRef} id={id} popover="auto" onToggle={handleToggle} aria-label="Notifications" className="fixed m-0 max-h-[75dvh] w-96 max-w-[calc(100vw-1rem)] overflow-y-auto rounded-lg border border-border bg-black p-2 text-sm text-foreground shadow-lg">
        <NotificationList notifications={notifications} onMatch={handleMatch} onNavigate={handleClose} />
      </div>
      {matching !== null && (
        <AniListLinkDialog
          currentMedia={undefined}
          initialProvider="anilist"
          metadataKey={showMetadataKey(matching.name)}
          suggestedSearch={matching.name}
          subject="show"
          onClose={handleDialogClose}
        />
      )}
    </>
  );
}
