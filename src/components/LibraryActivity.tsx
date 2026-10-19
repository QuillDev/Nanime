import { FolderInput, FolderSync, Upload, type LucideIcon } from "lucide-react";
import type { FileOperationActivityState } from "../../shared/libraryFiles.ts";
import { formatSize } from "../format.ts";
import { useLibraryActivity } from "../hooks/useLibraryActivity.ts";
import type { LibraryActivityEvent, MappingActivityState } from "../types.ts";
import { ProfileEmptyState, ProfileSection } from "./ProfileSection.tsx";

interface ActivityPresentation {
  readonly icon: LucideIcon;
  readonly title: string;
  readonly subject: string;
  readonly detail: string;
}

const FILE_TITLES = {
  "create-folder": "Created folder",
  move: "Moved files",
  rename: "Renamed",
  revert: "Undid a file change",
  trash: "Moved to trash",
} as const satisfies Readonly<Record<FileOperationActivityState["operation"], string>>;

function mappingDescription(next: MappingActivityState, previous: LibraryActivityEvent["previous"]): string {
  const before = previous?.kind === "mapping" ? previous.title : "Unmapped";
  return `${before} → ${next.title}`;
}

function fileDescription(next: FileOperationActivityState): string {
  const [first] = next.entries;
  const destination = first === undefined || next.entries.length > 1 ? `${String(next.entries.length)} items` : first.to;
  const mappings = next.mappings.length === 0 ? "" : ` · ${String(next.mappings.length)} mapping${next.mappings.length === 1 ? "" : "s"} followed`;
  return next.operation === "trash" ? `${String(next.entries.length)} item${next.entries.length === 1 ? "" : "s"}${mappings}` : `→ ${destination}${mappings}`;
}

function presentation(event: LibraryActivityEvent): ActivityPresentation {
  const { next } = event;
  if (next.kind === "upload") {
    return { icon: Upload, title: "Uploaded media", subject: next.path, detail: formatSize(next.size) };
  }
  if (next.kind === "files") {
    return { icon: FolderInput, title: FILE_TITLES[next.operation], subject: event.subject, detail: fileDescription(next) };
  }
  return { icon: FolderSync, title: "Updated mapping", subject: event.subject, detail: mappingDescription(next, event.previous) };
}

function ActivityItem({ event }: { readonly event: LibraryActivityEvent }): React.JSX.Element {
  const { icon: Icon, title, subject, detail } = presentation(event);
  const when = new Date(event.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return (
    <li className="flex items-start gap-3 py-2">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm" title={subject}>
          <span className="font-medium">{title}</span>
          <span className="text-muted-foreground"> · {subject}</span>
        </p>
        <p className="truncate text-[13px] text-muted-foreground" title={detail}>
          {detail} · {when} · {event.actorUsername}
        </p>
      </div>
    </li>
  );
}

export function LibraryActivity(): React.JSX.Element {
  const activity = useLibraryActivity();
  const events = activity.data ?? [];
  return (
    <ProfileSection id="library-activity" title="Library activity">
      {activity.isPending && <ProfileEmptyState>Loading…</ProfileEmptyState>}
      {activity.error !== null && (
        <p className="select-text py-2 text-sm text-destructive">{activity.error.message}</p>
      )}
      {activity.status === "success" && events.length === 0 && (
        <ProfileEmptyState>No library changes yet.</ProfileEmptyState>
      )}
      {events.length > 0 && (
        <ul>
          {events.map((event) => <ActivityItem key={event.id} event={event} />)}
        </ul>
      )}
    </ProfileSection>
  );
}
