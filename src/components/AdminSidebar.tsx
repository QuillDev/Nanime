import { useCallback, type MouseEvent } from "react";
import { Download, Film, FolderTree, Server, Users, Clapperboard, type LucideIcon } from "lucide-react";
import { formatSize } from "../format.ts";
import { adminTabHref, navigateToAdminTab, type AdminTab } from "../hooks/useMediaRoute.ts";
import { useStorageStatus } from "../hooks/useStorageStatus.ts";
import { useTorrents } from "../hooks/useTorrents.ts";
import { useTranscodes } from "../hooks/useTranscodes.ts";
import { downloadsSummary, transcodesSummary, type ActivitySummary } from "../lib/adminActivity.ts";
import { cn } from "../lib/utils.ts";

interface NavItem {
  readonly tab: AdminTab;
  readonly label: string;
  readonly icon: LucideIcon;
}

const GROUPS: readonly { readonly label: string; readonly items: readonly NavItem[] }[] = [
  { label: "Activity", items: [
    { tab: "downloads", label: "Downloads", icon: Download },
    { tab: "transcodes", label: "Transcodes", icon: Clapperboard },
  ] },
  { label: "Library", items: [
    { tab: "files", label: "Files", icon: FolderTree },
    { tab: "videos", label: "Videos", icon: Film },
  ] },
  { label: "Server", items: [
    { tab: "users", label: "Users", icon: Users },
    { tab: "system", label: "System", icon: Server },
  ] },
];

const IDLE: ActivitySummary = { label: "", progress: null };

function useActivity() {
  const torrents = useTorrents(true);
  const transcodes = useTranscodes();
  return {
    downloads: torrents.data === undefined ? IDLE : downloadsSummary(torrents.data),
    transcodes: transcodes.data === undefined ? IDLE : transcodesSummary(transcodes.data),
  };
}

function NavLink({ item, active, activity }: {
  readonly item: NavItem;
  readonly active: boolean;
  readonly activity: ActivitySummary;
}): React.JSX.Element {
  const { tab, label, icon: Icon } = item;
  const handleClick = useCallback((event: MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) {
      return;
    }
    event.preventDefault();
    navigateToAdminTab(tab);
  }, [tab]);
  return (
    <li className="shrink-0">
      <a
        ref={active ? revealActive : undefined}
        href={adminTabHref(tab)}
        onClick={handleClick}
        aria-current={active ? "page" : undefined}
        className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[current=page]:bg-secondary aria-[current=page]:text-foreground"
      >
        <Icon aria-hidden="true" className="size-4 shrink-0" />
        {label}
        {activity.label !== "" && <span className="ml-auto pl-2 text-xs font-semibold tabular-nums text-primary">{activity.label}</span>}
      </a>
      {activity.progress !== null && (
        <progress aria-label={`${label} progress`} max={1} value={activity.progress} className="playback-progress ml-9 mr-3 hidden h-0.5 w-[calc(100%-3rem)] lg:block" />
      )}
    </li>
  );
}

function StorageMeter(): React.JSX.Element | null {
  const storage = useStorageStatus();
  if (storage.data === undefined || storage.data.totalBytes <= 0) {
    return null;
  }
  const { totalBytes, availableBytes } = storage.data;
  return (
    <div className="mt-auto hidden px-3 pt-6 lg:block">
      <p className="text-xs font-semibold text-muted-foreground">Storage</p>
      <progress aria-label="Storage used" max={totalBytes} value={totalBytes - availableBytes} className="storage-meter mt-2 block h-1 w-full" />
      <p className="mt-1.5 text-xs text-muted-foreground">{formatSize(availableBytes)} free of {formatSize(totalBytes)}</p>
    </div>
  );
}

/** Admin navigation: a left column on wide screens, a scrolling strip on narrow ones. */
/** On narrow screens the strip scrolls sideways; keep the current page's link visible. */
function revealActive(link: HTMLAnchorElement | null): void {
  link?.scrollIntoView({ block: "nearest", inline: "nearest" });
}

export function AdminSidebar({ tab }: { readonly tab: AdminTab }): React.JSX.Element {
  const activity = useActivity();
  return (
    <nav
      aria-label="Administration sections"
      className="flex border-b border-border lg:sticky lg:top-[var(--header-height)] lg:h-[calc(100dvh-var(--header-height))] lg:w-60 lg:shrink-0 lg:flex-col lg:border-b-0 lg:border-r lg:px-3 lg:py-5"
    >
      <div className="flex min-w-0 gap-1 overflow-x-auto px-3 py-2 lg:flex-col lg:gap-4 lg:overflow-visible lg:p-0">
        {GROUPS.map((group) => (
          <div key={group.label} className="flex shrink-0 lg:block">
            <p className="hidden px-3 pb-1.5 text-[11px] font-semibold text-muted-foreground lg:block">{group.label}</p>
            <ul className={cn("flex gap-1 lg:flex-col lg:gap-0.5")}>
              {group.items.map((item) => (
                <NavLink key={item.tab} item={item} active={item.tab === tab} activity={item.tab === "downloads" || item.tab === "transcodes" ? activity[item.tab] : IDLE} />
              ))}
            </ul>
          </div>
        ))}
      </div>
      <StorageMeter />
    </nav>
  );
}
