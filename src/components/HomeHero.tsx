import { useCallback } from "react";
import { Play, X } from "lucide-react";
import type { MediaEntry } from "../types.ts";
import type { ShowGroup } from "../lib/library.ts";
import type { ContinueWatchingItem } from "../lib/continueWatching.ts";
import { mediaTitle } from "../lib/anilist.ts";
import { preloadPlayer } from "../lib/playback.ts";
import { episodeLabel, percentWatched, showFacts, timeLeft, type HomeFeature } from "../lib/libraryHome.ts";
import { thumbnailUrl } from "../api.ts";
import { HomeQueue } from "./HomeQueue.tsx";

interface HomeHeroProps {
  readonly feature: HomeFeature;
  readonly queue: readonly ContinueWatchingItem[];
  readonly onEpisodeSelect: (entry: MediaEntry) => void;
  readonly onShowSelect: (show: ShowGroup) => void;
  readonly onDismiss: (rel: string) => void;
}

function HeroBackdrop({ feature }: { readonly feature: HomeFeature }): React.JSX.Element {
  const banner = feature.media?.bannerImage ?? null;
  const [first] = feature.show.entries;
  const frame = feature.kind === "continue" ? feature.item.thumbnail ?? thumbnailUrl(feature.item.entry.rel) : null;
  const fallback = frame ?? feature.media?.coverImage.extraLarge ?? (first === undefined ? null : thumbnailUrl(first.rel));
  const source = banner ?? fallback;
  return (
    <>
      {source !== null && (
        <img src={source} alt="" className={`absolute inset-0 size-full object-cover object-[50%_25%] ${banner === null && frame === null ? "scale-110 blur-md" : ""}`} />
      )}
      <span aria-hidden="true" className="absolute inset-0 bg-[linear-gradient(90deg,rgb(0_0_0)_0%,rgb(0_0_0/0.85)_32%,rgb(0_0_0/0.3)_52%,rgb(0_0_0/0.75)_72%,rgb(0_0_0/0.9)_100%),linear-gradient(0deg,rgb(0_0_0)_0%,transparent_38%)]" />
    </>
  );
}

function FeatureCopy({ feature, onEpisodeSelect, onShowSelect, onDismiss }: Omit<HomeHeroProps, "queue">): React.JSX.Element {
  const continuing = feature.kind === "continue" ? feature.item : null;
  const [firstEntry] = feature.show.entries;
  const playEntry = continuing?.entry ?? firstEntry;
  const handlePlay = useCallback(() => {
    if (playEntry !== undefined) {
      onEpisodeSelect(playEntry);
    }
  }, [onEpisodeSelect, playEntry]);
  const handleEpisodes = useCallback(() => {
    onShowSelect(feature.show);
  }, [feature.show, onShowSelect]);
  const handleDismiss = useCallback(() => {
    if (continuing !== null) {
      onDismiss(continuing.dismissRel);
    }
  }, [continuing, onDismiss]);
  const title = feature.media === undefined ? feature.show.name : mediaTitle(feature.media);
  const percent = continuing === null ? 0 : percentWatched(continuing);
  return (
    <div className="max-w-xl">
      <p className="mb-2.5 text-[13px] font-semibold text-primary">{continuing === null ? "Recently added" : "Continue watching"}</p>
      <h1 className="font-display text-4xl font-extrabold leading-[0.98] tracking-[-0.04em] text-balance sm:text-6xl">{title}</h1>
      {continuing === null
        ? <p className="mt-4 text-[15px] text-muted-foreground">{showFacts(feature.media) ?? `${String(feature.show.entries.length)} episodes`}</p>
        : <p className="mt-4 text-[15px] font-semibold">{episodeLabel(continuing)}</p>}
      {percent > 0 && (
        <>
          <progress aria-label="Playback progress" max={100} value={percent} className="playback-progress mt-4 block h-1 w-72 max-w-full overflow-hidden rounded-full" />
          <p className="mt-1.5 text-[13px] text-muted-foreground">{continuing !== null && timeLeft(continuing)}</p>
        </>
      )}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        {playEntry !== undefined && (
          <button type="button" onClick={handlePlay} onFocus={preloadPlayer} onPointerEnter={preloadPlayer} className="inline-flex h-11 items-center gap-2 rounded-full bg-foreground px-5 text-sm font-semibold text-background hover:bg-foreground/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Play className="size-4 fill-current" />
            {continuing === null || continuing.kind === "next" ? "Play" : "Resume"}
          </button>
        )}
        <button type="button" onClick={handleEpisodes} className="inline-flex h-11 items-center rounded-full bg-white/12 px-5 text-sm font-semibold hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          Episodes
        </button>
        {continuing !== null && (
          <button type="button" onClick={handleDismiss} aria-label="Remove from Continue Watching" title="Remove from Continue Watching" className="rounded-full p-2.5 text-muted-foreground hover:bg-white/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <X className="size-4" />
          </button>
        )}
      </div>
    </div>
  );
}

/** Full-bleed banner under the transparent header: what you're watching, with the rest of your queue beside it. */
export function HomeHero({ feature, queue, onEpisodeSelect, onShowSelect, onDismiss }: HomeHeroProps): React.JSX.Element {
  return (
    <section className="relative mx-[calc(50%-50vw)] -mt-[calc(var(--header-height)+1.5rem)] flex min-h-[480px] items-end overflow-hidden sm:min-h-[560px]">
      <HeroBackdrop feature={feature} />
      <div className="relative mx-auto flex w-full max-w-7xl flex-col gap-8 px-6 pb-14 pt-32 lg:flex-row lg:items-end lg:justify-between">
        <FeatureCopy feature={feature} onEpisodeSelect={onEpisodeSelect} onShowSelect={onShowSelect} onDismiss={onDismiss} />
        {queue.length > 0 && <HomeQueue items={queue} onSelect={onEpisodeSelect} onDismiss={onDismiss} />}
      </div>
    </section>
  );
}
