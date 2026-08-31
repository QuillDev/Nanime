import { FolderSync, Upload } from "lucide-react";
import { formatSize } from "../format.ts";
import { useLibraryActivity } from "../hooks/useLibraryActivity.ts";
import type { LibraryActivityEvent, MappingActivityState } from "../types.ts";
import { ProfileEmptyState, ProfileSection } from "./ProfileSection.tsx";

function mappingDescription(event: LibraryActivityEvent): string {
  const next = event.next as MappingActivityState;
  const previous = event.previous?.kind === "mapping" ? event.previous.title : "Unmapped";
  return `${previous} → ${next.title}`;
}

function ActivityItem({ event }: { readonly event: LibraryActivityEvent }): React.JSX.Element {
  const upload = event.next.kind === "upload";
  return (
    <li className="flex items-start gap-3 px-4 py-4 sm:px-5">
      {upload
        ? <Upload className="mt-0.5 size-4 shrink-0 text-primary" />
        : <FolderSync className="mt-0.5 size-4 shrink-0 text-primary" />}
      <div className="min-w-0">
        <p className="font-medium">{upload ? "Uploaded media" : "Updated mapping"}</p>
        <p className="mt-1 truncate text-sm text-muted-foreground" title={event.subject}>
          {upload ? event.next.path : event.subject}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {upload ? formatSize(event.next.size) : mappingDescription(event)}
        </p>
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
      description="Uploads and mapping changes."
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
