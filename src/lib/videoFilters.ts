import type { MediaEntry, ShowMetadata } from "../types.ts";
import { mediaTitle } from "./anilist.ts";
import { showMetadataKey, type ShowGroup } from "./library.ts";
import type { VideoStatus } from "./videoStatus.ts";

export type VideoFilter = "all" | "needs-transcode" | "unmapped";

export function showTitle(show: ShowGroup, metadata: ShowMetadata): string {
  const media = metadata[showMetadataKey(show.name)];
  return media === undefined ? show.name : mediaTitle(media);
}

function matchesQuery(show: ShowGroup, metadata: ShowMetadata, needle: string): boolean {
  return needle === "" || [showTitle(show, metadata), show.name, ...show.entries.map((entry) => entry.name)]
    .join(" ")
    .toLocaleLowerCase()
    .includes(needle);
}

function keepEntries(show: ShowGroup, keep: (entry: MediaEntry) => boolean): ShowGroup | null {
  const seasons = show.seasons
    .map((season) => ({ ...season, entries: season.entries.filter((entry) => keep(entry)) }))
    .filter((season) => season.entries.length > 0);
  return seasons.length === 0 ? null : { ...show, seasons, entries: seasons.flatMap((season) => season.entries) };
}

interface FilterOptions {
  readonly metadata: ShowMetadata;
  readonly query: string;
  readonly filter: VideoFilter;
  readonly statuses: ReadonlyMap<string, VideoStatus>;
}

/** Shows matching the search; "needs transcode" also narrows each show to the episodes that need one. */
export function filterShows(shows: readonly ShowGroup[], options: FilterOptions): readonly ShowGroup[] {
  const { metadata, query, filter, statuses } = options;
  const needle = query.trim().toLocaleLowerCase();
  return shows.flatMap((show) => {
    if (!matchesQuery(show, metadata, needle)) {
      return [];
    }
    if (filter === "unmapped") {
      return metadata[showMetadataKey(show.name)] === undefined ? [show] : [];
    }
    const kept = filter === "needs-transcode"
      ? keepEntries(show, (entry) => statuses.get(entry.rel)?.needsTranscode === true)
      : show;
    return kept === null ? [] : [kept];
  });
}
