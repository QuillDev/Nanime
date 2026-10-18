import { useCallback } from "react";
import { X } from "lucide-react";
import type { MediaEntry } from "../types.ts";
import type { ContinueWatchingItem } from "../lib/continueWatching.ts";
import { preloadPlayer } from "../lib/playback.ts";
import { episodeLabel, percentWatched, timeLeft } from "../lib/libraryHome.ts";
import { MediaThumbnail } from "./MediaThumbnail.tsx";

interface QueueProps {
  readonly onSelect: (entry: MediaEntry) => void;
  readonly onDismiss: (rel: string) => void;
}

function QueueRow({ item, onSelect, onDismiss }: QueueProps & { readonly item: ContinueWatchingItem }): React.JSX.Element {
  const handleSelect = useCallback(() => {
    onSelect(item.entry);
  }, [item.entry, onSelect]);
  const handleDismiss = useCallback(() => {
    onDismiss(item.dismissRel);
  }, [item.dismissRel, onDismiss]);
  const percent = percentWatched(item);
  return (
    <li className="group relative">
      <button
        type="button"
        onClick={handleSelect}
        onFocus={preloadPlayer}
        onPointerEnter={preloadPlayer}
        className="grid w-full grid-cols-[8rem_1fr] items-center gap-3 rounded-lg pr-8 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="relative block overflow-hidden rounded-md">
          <MediaThumbnail rel={item.entry.rel} source={item.thumbnail} className="w-full" />
          {percent > 0 && <progress aria-label="Playback progress" max={100} value={percent} className="playback-progress absolute inset-x-0 bottom-0 block h-1 w-full" />}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold group-hover:text-primary">{item.showTitle}</span>
          <span className="block truncate text-[13px] text-muted-foreground">{episodeLabel(item)} · {timeLeft(item)}</span>
        </span>
      </button>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label={`Remove ${item.showTitle} from Continue Watching`}
        title="Remove from Continue Watching"
        className="absolute right-0 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-muted-foreground opacity-0 hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100"
      >
        <X className="size-4" />
      </button>
    </li>
  );
}

/** The rest of Continue Watching, beside the banner. */
export function HomeQueue({ items, onSelect, onDismiss }: QueueProps & { readonly items: readonly ContinueWatchingItem[] }): React.JSX.Element {
  return (
    <section aria-labelledby="home-queue" className="w-full rounded-2xl bg-black/80 p-3.5 lg:w-[22.5rem]">
      <h2 id="home-queue" className="mb-2 text-[13px] font-semibold text-muted-foreground">Also in progress</h2>
      <ul className="grid gap-2">
        {items.map((item) => <QueueRow key={item.entry.rel} item={item} onSelect={onSelect} onDismiss={onDismiss} />)}
      </ul>
    </section>
  );
}
