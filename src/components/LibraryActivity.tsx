import { FolderSync, Upload } from "lucide-react";
import { formatSize } from "../format.ts";
import { useLibraryActivity } from "../hooks/useLibraryActivity.ts";
import type { LibraryActivityEvent, MappingActivityState } from "../types.ts";

function mappingDescription(event: LibraryActivityEvent): string {
  const next = event.next as MappingActivityState;
  const previous = event.previous?.kind === "mapping" ? event.previous.title : "Unmapped";
  return `${previous} → ${next.title}`;
}

function ActivityItem({ event }: { readonly event: LibraryActivityEvent }): React.JSX.Element {
  const upload = event.next.kind === "upload";
  return (
    <li className="flex items-start gap-3 border-b border-border py-4 last:border-b-0">
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

export function LibraryActivity(): React.JSX.Element {
  const activity = useLibraryActivity();
  const events = activity.data ?? [];
  return (
    <section className="border-b border-border py-6" aria-labelledby="library-activity-title">
      <div className="flex items-center gap-2">
        <FolderSync className="size-5 text-primary" />
        <h2 id="library-activity-title" className="text-lg font-semibold">Library activity</h2>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        Successful uploads and metadata mapping changes are retained permanently.
      </p>
      {activity.isPending && <p className="py-5 text-sm text-muted-foreground">Loading activity…</p>}
      {activity.error !== null && (
        <p className="py-5 select-text text-sm text-destructive">{activity.error.message}</p>
      )}
      {activity.status === "success" && events.length === 0 && (
        <p className="py-5 text-sm text-muted-foreground">No library activity recorded yet.</p>
      )}
      {events.length > 0 && (
        <ul className="mt-3">
          {events.map((event) => <ActivityItem key={event.id} event={event} />)}
        </ul>
      )}
    </section>
  );
}
