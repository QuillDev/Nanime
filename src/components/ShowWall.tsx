import { useMemo } from "react";
import type { DownloadStatus, ShowMetadata } from "../types.ts";
import type { ShowGroup } from "../lib/library.ts";
import { sortShows } from "../lib/libraryHome.ts";
import { ShowGrid } from "./ShowGrid.tsx";
import { SortTabs, useShowSort } from "./SortTabs.tsx";

interface ShowWallProps {
  readonly downloads: readonly DownloadStatus[];
  readonly metadata: ShowMetadata;
  readonly onShowSelect: (show: ShowGroup) => void;
  readonly shows: readonly ShowGroup[];
  readonly title: string;
  readonly watched: (show: ShowGroup) => boolean;
  /** Beside the filter rail the wall is narrower, so it holds fewer posters per row. */
  readonly beside: boolean;
  /** The shows arrive in an order of their own (most recently watched), so there is no sort to choose. */
  readonly ordered: boolean;
}

/** A titled wall of show posters with its sort order. */
export function ShowWall({ downloads, metadata, onShowSelect, shows, title, watched, beside, ordered }: ShowWallProps): React.JSX.Element {
  const [sort, setSort] = useShowSort();
  const sorted = useMemo(() => (ordered ? shows : sortShows(shows, metadata, sort)), [metadata, ordered, shows, sort]);
  return (
    <section aria-labelledby="all-shows" className="min-w-0">
      <div className="mb-5 flex flex-wrap items-baseline gap-x-6 gap-y-2">
        <h2 id="all-shows" className="font-display text-2xl font-bold tracking-tight">{title}</h2>
        <span className="flex-1" />
        {!ordered && <SortTabs sort={sort} onSort={setSort} />}
      </div>
      {shows.length === 0
        ? <p className="py-10 text-muted-foreground">Nothing here yet.</p>
        : <ShowGrid shows={sorted} metadata={metadata} downloads={downloads} onSelect={onShowSelect} watched={watched} beside={beside} />}
    </section>
  );
}
