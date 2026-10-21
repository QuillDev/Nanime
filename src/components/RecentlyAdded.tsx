import { useCallback } from "react";
import type { AniListMedia, ShowMetadata } from "../types.ts";
import { primaryShowMetadata, type ShowGroup } from "../lib/library.ts";
import { mediaTitle } from "../lib/anilist.ts";
import { showFacts } from "../lib/libraryHome.ts";
import { thumbnailUrl } from "../api.ts";

function tileSource(show: ShowGroup, media: AniListMedia | undefined): string | null {
  const [first] = show.entries;
  return media?.bannerImage ?? (first === undefined ? null : thumbnailUrl(first.rel));
}

function RecentTile({ show, media, onSelect }: {
  readonly show: ShowGroup;
  readonly media: AniListMedia | undefined;
  readonly onSelect: (show: ShowGroup) => void;
}): React.JSX.Element {
  const handleClick = useCallback(() => {
    onSelect(show);
  }, [onSelect, show]);
  const source = tileSource(show, media);
  const facts = [showFacts(media), media?.genres.slice(0, 2).join(", ")].filter((part) => part !== null && part !== undefined && part !== "");
  return (
    <li>
      <button type="button" onClick={handleClick} className="group relative block aspect-[2/1] w-full overflow-hidden rounded-2xl bg-secondary text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {source !== null && <img src={source} alt="" loading="lazy" decoding="async" className="absolute inset-0 size-full object-cover transition-transform duration-300 group-hover:scale-[1.03] group-focus-visible:scale-[1.03]" />}
        <span aria-hidden="true" className="absolute inset-0 bg-[linear-gradient(0deg,rgb(0_0_0/0.92)_0%,rgb(0_0_0/0.6)_40%,transparent_75%)]" />
        <span className="absolute inset-x-4 bottom-3.5">
          <span className="block font-display text-lg font-bold leading-tight tracking-tight">{media === undefined ? show.name : mediaTitle(media)}</span>
          {facts.length > 0 && <span className="block truncate text-[13px] text-white/75">{facts.join(" · ")}</span>}
        </span>
      </button>
    </li>
  );
}

export function RecentlyAdded({ shows, metadata, onSelect }: {
  readonly shows: readonly ShowGroup[];
  readonly metadata: ShowMetadata;
  readonly onSelect: (show: ShowGroup) => void;
}): React.JSX.Element {
  return (
    <section aria-labelledby="recently-added" className="mb-12">
      <h2 id="recently-added" className="mb-4 font-display text-2xl font-bold tracking-tight">Recently added</h2>
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {shows.map((show) => <RecentTile key={show.name} show={show} media={primaryShowMetadata(show, metadata)} onSelect={onSelect} />)}
      </ul>
    </section>
  );
}
