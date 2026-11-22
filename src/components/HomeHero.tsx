import { useCallback, useState } from "react";
import { Play, X } from "lucide-react";
import type { MediaEntry } from "../types.ts";
import type { ShowGroup } from "../lib/library.ts";
import { mediaTitle } from "../lib/anilist.ts";
import { preloadPlayer } from "../lib/playback.ts";
import { HeroArt } from "./HeroArt.tsx";
import { posterArt } from "../lib/art.ts";
import { HomeHeroRotation } from "./HomeHeroRotation.tsx";
import { episodeLabel, heroBackdrop, percentWatched, showFacts, timeLeft, type HomeFeature } from "../lib/libraryHome.ts";

interface FeatureActions {
  readonly onEpisodeSelect: (entry: MediaEntry) => void;
  readonly onShowSelect: (show: ShowGroup) => void;
  readonly onDismiss: (rel: string) => void;
}

const WIDE_FADE = "bg-[linear-gradient(90deg,rgb(0_0_0/0.88)_0%,rgb(0_0_0/0.7)_26%,rgb(0_0_0/0.12)_58%,transparent_100%),linear-gradient(0deg,rgb(0_0_0)_0%,transparent_38%)]";

function FeatureCopy({ feature, onEpisodeSelect, onShowSelect, onDismiss }: FeatureActions & { readonly feature: HomeFeature }): React.JSX.Element {
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
      <h1 className="font-display text-4xl font-extrabold leading-[0.98] tracking-[-0.04em] text-balance sm:text-6xl">{title}</h1>
      {continuing === null
        ? <p className="mt-4 text-[15px] text-muted-foreground">{showFacts(feature.media) ?? `${String(feature.show.entries.length)} episodes`}</p>
        : <p className="mt-4 text-[15px]"><span className="font-semibold">{episodeLabel(continuing)}</span><span className="text-muted-foreground"> · {timeLeft(continuing)}</span></p>}
      {percent > 0 && <progress aria-label="Playback progress" max={100} value={percent} className="playback-progress mt-3 block h-[3px] w-72 max-w-full overflow-hidden rounded-full" />}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        {playEntry !== undefined && (
          <button type="button" data-tv-primary onClick={handlePlay} onFocus={preloadPlayer} onPointerEnter={preloadPlayer} className="inline-flex h-11 items-center gap-2 rounded-full bg-foreground px-5 text-sm font-semibold text-background hover:bg-foreground/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
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

/** Which of the banner's shows is up, stepped by hand and wrapping around. */
function useRotation(count: number) {
  const [position, setPosition] = useState(0);
  const index = Math.min(position, count - 1);
  const handleStep = useCallback((step: number) => {
    setPosition((current) => (Math.min(current, count - 1) + step + count) % count);
  }, [count]);
  return { index, handleStep };
}

/** Full-bleed banner under the transparent header: the shows being watched, or ones to start, one at a time. */
export function HomeHero({ features, onEpisodeSelect, onShowSelect, onDismiss }: FeatureActions & { readonly features: readonly HomeFeature[] }): React.JSX.Element | null {
  const { index, handleStep } = useRotation(features.length);
  const feature = features[index];
  if (feature === undefined) {
    return null;
  }
  const backdrop = heroBackdrop(feature);
  return (
    <section className="relative mx-[calc(50%-50vw)] -mt-[calc(var(--header-height)+1.5rem)] flex min-h-[600px] items-end overflow-hidden sm:min-h-[560px]">
      <HeroArt wide={backdrop} poster={posterArt(feature.media)} blurred={backdrop?.blurred === true} wideFade={WIDE_FADE} />
      <div className="relative mx-auto w-full max-w-7xl px-6 pb-10 pt-32 sm:pb-14">
        <FeatureCopy feature={feature} onEpisodeSelect={onEpisodeSelect} onShowSelect={onShowSelect} onDismiss={onDismiss} />
      </div>
      <HomeHeroRotation count={features.length} onStep={handleStep} />
    </section>
  );
}
