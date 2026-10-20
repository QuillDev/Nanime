import { useCallback } from "react";
import { ChevronRight } from "lucide-react";
import { useProfileEpisodes } from "../hooks/useProfileEpisodes.ts";
import { useShowMetadata } from "../hooks/useShowMetadata.ts";
import { seasonDisplayName, type ShowGroup } from "../lib/library.ts";
import type { Notifications } from "../lib/notifications.ts";
import type { ShowMetadata } from "../types.ts";
import { DownloadRow, TranscodeRow } from "./NotificationRows.tsx";

const NO_METADATA: ShowMetadata = {};

function seasonLabel(show: ShowGroup): string {
  const [season] = show.seasons;
  if (show.seasons.length !== 1 || season === undefined) {
    return `${String(show.seasons.length)} seasons`;
  }
  return season.name === "Episodes" ? "" : seasonDisplayName(season);
}

function UnmappedRow({ show, onMatch }: { readonly show: ShowGroup; readonly onMatch: (show: ShowGroup) => void }): React.JSX.Element {
  const handleMatch = useCallback(() => {
    onMatch(show);
  }, [onMatch, show]);
  const season = seasonLabel(show);
  return (
    <li>
      <button type="button" onClick={handleMatch} title={`Match ${show.name}`} className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span aria-hidden="true" className="mx-0.5 size-2 shrink-0 rounded-full bg-warning" />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{show.name}</span>
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">{season === "" ? "Not matched yet" : `${season} · not matched yet`}</span>
        </span>
        <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      </button>
    </li>
  );
}

function Section({ title, children }: { readonly title: string; readonly children: React.ReactNode }): React.JSX.Element {
  return (
    <section className="border-t border-border pt-2 first:border-t-0 first:pt-0">
      <h3 className="px-2 pb-1 pt-1 text-xs font-semibold text-muted-foreground">{title}</h3>
      <ul>{children}</ul>
    </section>
  );
}

interface NotificationListProps {
  readonly notifications: Notifications;
  readonly onMatch: (show: ShowGroup) => void;
  readonly onNavigate: () => void;
}

export function NotificationList({ notifications, onMatch, onNavigate }: NotificationListProps): React.JSX.Element {
  const metadata = useShowMetadata().data ?? NO_METADATA;
  const episodes = useProfileEpisodes();
  const { unmapped, downloads, transcodes } = notifications;
  if (notifications.tone === "idle") {
    return <p className="px-2 py-6 text-center text-muted-foreground">All caught up.</p>;
  }
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
      {unmapped.length > 0 && (
        <Section title="Needs a match">
          {unmapped.map((show) => <UnmappedRow key={show.name} show={show} onMatch={onMatch} />)}
        </Section>
      )}
      {downloads.length > 0 && (
        <Section title="Downloads">
          {downloads.map((download) => <DownloadRow key={download.id} download={download} metadata={metadata} onNavigate={onNavigate} />)}
        </Section>
      )}
      {transcodes.length > 0 && (
        <Section title="Transcodes">
          {transcodes.map((job) => <TranscodeRow key={job.id} job={job} episodes={episodes} onNavigate={onNavigate} />)}
        </Section>
      )}
    </div>
  );
}
