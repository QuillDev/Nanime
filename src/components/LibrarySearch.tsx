import {
  useCallback,
  useMemo,
  useState,
  type ChangeEvent,
  type FocusEvent,
  type MouseEvent,
} from "react";
import { Search } from "lucide-react";
import { mediaTitle } from "../lib/anilist.ts";
import { showMetadataKey, type ShowGroup } from "../lib/library.ts";
import type { ShowMetadata } from "../types.ts";
import { Input } from "./ui/input.tsx";
import { MediaThumbnail } from "./MediaThumbnail.tsx";
import { Collapsible, CollapsibleContent } from "./ui/collapsible.tsx";

const SUGGESTION_LIMIT = 5;

interface LibrarySearchProps {
  readonly query: string;
  readonly shows: readonly ShowGroup[];
  readonly metadata: ShowMetadata;
  readonly onQueryChange: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly onShowSelect: (show: ShowGroup) => void;
}

function showTitle(show: ShowGroup, metadata: ShowMetadata): string {
  const media = metadata[showMetadataKey(show.name)];
  return media === undefined ? show.name : mediaTitle(media);
}

function matchScore(show: ShowGroup, metadata: ShowMetadata, needle: string): number {
  const media = metadata[showMetadataKey(show.name)];
  const candidates = [
    showTitle(show, metadata),
    ...show.sourceNames,
    media?.title.romaji ?? "",
    media?.title.english ?? "",
    media?.title.native ?? "",
  ].map((value) => value.toLocaleLowerCase());
  if (candidates.some((value) => value === needle)) {
    return 0;
  }
  if (candidates.some((value) => value.startsWith(needle))) {
    return 1;
  }
  if (candidates.some((value) => value.includes(needle))) {
    return 2;
  }
  const tokens = needle.split(/\s+/u);
  return candidates.some((value) => tokens.every((token) => value.includes(token)))
    ? 3
    : Number.POSITIVE_INFINITY;
}

interface RankedShow {
  readonly show: ShowGroup;
  readonly score: number;
}

function rankShows(
  shows: readonly ShowGroup[],
  metadata: ShowMetadata,
  needle: string,
): readonly RankedShow[] {
  const ranked: RankedShow[] = [];
  for (const show of shows) {
    const score = matchScore(show, metadata, needle);
    if (Number.isFinite(score)) {
      ranked.push({ show, score });
    }
  }
  return ranked.toSorted((left, right) => left.score - right.score);
}

function takeSuggestions(ranked: readonly RankedShow[]): readonly ShowGroup[] {
  const results: ShowGroup[] = [];
  for (const { show } of ranked) {
    results.push(show);
    if (results.length === SUGGESTION_LIMIT) {
      break;
    }
  }
  return results;
}

function searchShows(
  shows: readonly ShowGroup[],
  metadata: ShowMetadata,
  query: string,
): readonly ShowGroup[] {
  const needle = query.trim().toLocaleLowerCase();
  return needle === "" ? [] : takeSuggestions(rankShows(shows, metadata, needle));
}

function SearchResult({
  show,
  metadata,
  index,
  onSelect,
}: {
  readonly show: ShowGroup;
  readonly metadata: ShowMetadata;
  readonly index: number;
  readonly onSelect: (event: MouseEvent<HTMLButtonElement>) => void;
}): React.JSX.Element {
  const media = metadata[showMetadataKey(show.name)];
  const [preview] = show.entries;
  const cover = media?.coverImage.large ?? media?.coverImage.extraLarge;
  return (
    <li className="border-b border-border last:border-b-0">
      <button
        type="button"
        data-index={index}
        onClick={onSelect}
        className="flex w-full items-center gap-3 p-3 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        {preview !== undefined && (
          <MediaThumbnail rel={preview.rel} source={cover} className="aspect-[2/3] w-11 shrink-0" />
        )}
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold">{showTitle(show, metadata)}</span>
          <span className="mt-1 block truncate text-xs text-muted-foreground">
            {show.seasons.length} {show.seasons.length === 1 ? "season" : "seasons"}
          </span>
        </span>
      </button>
    </li>
  );
}

export function LibrarySearch({
  query,
  shows,
  metadata,
  onQueryChange,
  onShowSelect,
}: LibrarySearchProps): React.JSX.Element {
  const [focused, setFocused] = useState(false);
  const suggestions = useMemo(
    () => searchShows(shows, metadata, query),
    [shows, metadata, query],
  );
  const handleFocus = useCallback(() => setFocused(true), []);
  const handleBlur = useCallback((event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget;
    if (!(next instanceof Node) || !event.currentTarget.contains(next)) {
      setFocused(false);
    }
  }, []);
  const handleSelect = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    const index = Number(event.currentTarget.dataset["index"]);
    const show = suggestions[index];
    if (show !== undefined) {
      setFocused(false);
      onShowSelect(show);
    }
  }, [onShowSelect, suggestions]);
  const showSuggestions = focused && query.trim() !== "";
  return (
    <div className="library-search" onFocus={handleFocus} onBlur={handleBlur}>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        placeholder="Search…"
        value={query}
        onChange={onQueryChange}
        aria-label="Search library"
        aria-autocomplete="list"
        aria-controls="library-search-results"
        aria-expanded={showSuggestions}
        className="pl-9 text-base"
      />
      <Collapsible open={showSuggestions}>
        <CollapsibleContent className="absolute inset-x-0 top-full z-50 mt-2 rounded-lg border border-border bg-popover shadow-xl">
          {suggestions.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No matching shows.</p>
          ) : (
            <ul id="library-search-results">
              {suggestions.map((show, index) => (
                <SearchResult
                  key={show.name}
                  show={show}
                  metadata={metadata}
                  index={index}
                  onSelect={handleSelect}
                />
              ))}
            </ul>
          )}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
