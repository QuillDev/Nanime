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
  return (
    <li className="flex items-start gap-3 px-4 py-4 sm:px-5">
      <Icon className="mt-0.5 size-4 shrink-0 text-primary" />
      <div className="min-w-0">
        <p className="font-medium">{title}</p>
        <p className="mt-1 truncate text-sm text-muted-foreground" title={subject}>{subject}</p>
        <p className="mt-1 truncate text-xs text-muted-foreground" title={detail}>{detail}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {new Date(event.createdAt).toLocaleString()} · {event.actorUsername}
        </p>
      </div>
    </li>
  );
}

export function LibraryActivity({ className }: { readonly className?: string }): React.JSX.Element {
  const activity = useLibraryActivity();
  const events = activity.data ?? [];
  return (
    <ProfileSection
      className={className}
      description="Uploads, mapping changes, and file operations."
      icon={FolderSync}
      id="library-activity-title"
      title="Library activity"
    >
      {activity.isPending && <p className="px-4 py-6 text-sm text-muted-foreground sm:px-5">Loading…</p>}
      {activity.error !== null && (
        <p className="select-text px-4 py-6 text-sm text-destructive sm:px-5">{activity.error.message}</p>
      )}
      {activity.status === "success" && events.length === 0 && (
        <ProfileEmptyState>No library changes yet.</ProfileEmptyState>
      )}
      {events.length > 0 && (
        <ul className="divide-y divide-border">
          {events.map((event) => <ActivityItem key={event.id} event={event} />)}
        </ul>
      )}
    </ProfileSection>
  );
}
