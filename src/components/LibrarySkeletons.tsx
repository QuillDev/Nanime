import { librarySkeletonPage, type LibrarySkeletonPage } from "../lib/skeletonPage.ts";
import { BannerBone, Bone, TextBone } from "./Skeleton.tsx";

const QUEUE_KEYS = ["one", "two", "three"] as const;
const RECENT_KEYS = ["one", "two", "three", "four"] as const;
// Widths of the real sort labels: Recently added, A–Z, Release year, Score.
const SORT_WIDTHS = ["w-24", "w-6", "w-[4.75rem]", "w-9"] as const;
const GENRE_KEYS = ["one", "two", "three"] as const;
const POSTER_KEYS = Array.from({ length: 24 }, (_, index) => `poster-${String(index)}`);
const EPISODE_KEYS = Array.from({ length: 8 }, (_, index) => `episode-${String(index)}`);

// Same gradients as HomeHero and ShowHero, so text placeholders sit where the real copy will.
const HOME_GRADIENT = "bg-[linear-gradient(90deg,rgb(0_0_0)_0%,rgb(0_0_0/0.85)_32%,rgb(0_0_0/0.3)_52%,rgb(0_0_0/0.75)_72%,rgb(0_0_0/0.9)_100%),linear-gradient(0deg,rgb(0_0_0)_0%,transparent_38%)]";
const SHOW_GRADIENT = "bg-[linear-gradient(90deg,rgb(0_0_0/0.96)_0%,rgb(0_0_0/0.78)_42%,rgb(0_0_0/0.15)_80%),linear-gradient(0deg,rgb(0_0_0)_0%,transparent_55%)]";

function HomeQueueSkeleton(): React.JSX.Element {
  return (
    <div className="w-full lg:w-[22.5rem]">
      <TextBone type="mb-2 text-[13px]" width="w-28" />
      <ul className="grid gap-2">
        {QUEUE_KEYS.map((key) => (
          <li key={key} className="grid grid-cols-[8rem_1fr] items-center gap-3">
            <Bone className="aspect-video w-full" />
            <span>
              <TextBone type="text-sm" width="w-4/5" />
              <TextBone type="text-[13px]" width="w-3/5" />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function HomeHeroSkeleton(): React.JSX.Element {
  return (
    <section className="relative mx-[calc(50%-50vw)] -mt-[calc(var(--header-height)+1.5rem)] flex min-h-[480px] items-end overflow-hidden sm:min-h-[560px]">
      <BannerBone gradient={HOME_GRADIENT} />
      <div className="relative mx-auto flex w-full max-w-7xl flex-col gap-8 px-6 pb-14 pt-32 lg:flex-row lg:items-end lg:justify-between">
        <div className="w-full max-w-xl">
          <TextBone type="mb-2.5 text-[13px]" width="w-32" />
          <TextBone type="font-display text-4xl leading-[0.98] sm:text-6xl" width="w-4/5" />
          <TextBone type="font-display text-4xl leading-[0.98] sm:text-6xl" width="w-3/5" />
          <TextBone type="mt-4 text-[15px]" width="w-20" />
          <Bone className="mt-4 h-1 w-72 max-w-full rounded-full" />
          <TextBone type="mt-1.5 text-[13px]" width="w-14" />
          <div className="mt-6 flex gap-3">
            <Bone className="h-11 w-[7.25rem] rounded-full" />
            <Bone className="h-11 w-[6.5rem] rounded-full" />
          </div>
        </div>
        <HomeQueueSkeleton />
      </div>
    </section>
  );
}

function RecentlyAddedSkeleton(): React.JSX.Element {
  return (
    <section className="mb-12">
      <TextBone type="mb-4 font-display text-2xl" width="w-44" />
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {RECENT_KEYS.map((key) => <li key={key}><Bone className="aspect-[2/1] w-full rounded-2xl" /></li>)}
      </ul>
    </section>
  );
}

function ShowGridSkeleton(): React.JSX.Element {
  return (
    <section>
      <div className="mb-5 flex flex-wrap items-end gap-x-6 gap-y-2">
        <TextBone type="font-display text-2xl" width="w-32" />
        <span className="flex-1" />
        <span className="flex gap-x-5 pb-1">
          {SORT_WIDTHS.map((width) => <TextBone key={width} type="text-[13px]" width={width} />)}
        </span>
      </div>
      <ul className="grid grid-cols-3 gap-x-4 gap-y-6 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8">
        {POSTER_KEYS.map((key) => (
          <li key={key}>
            <Bone className="aspect-[2/3] w-full rounded-[10px]" />
            <span className="block pt-2">
              <TextBone type="text-[13px]" width="w-4/5" />
              <TextBone type="text-xs" width="w-1/2" />
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ShowHeroSkeleton(): React.JSX.Element {
  return (
    <section className="relative mx-[calc(50%-50vw)] -mt-6 mb-8 flex min-h-[420px] items-end overflow-hidden">
      <BannerBone gradient={SHOW_GRADIENT} />
      <div className="relative mx-auto w-full max-w-7xl px-6 pb-8 pt-16">
        <Bone className="absolute left-6 top-5 h-4 w-20" />
        <Bone className="h-4 w-56" />
        <Bone className="mt-3 h-9 w-3/4 max-w-xl sm:h-14" />
        <div className="mt-4 flex gap-2">
          {GENRE_KEYS.map((key) => <Bone key={key} className="h-7 w-20 rounded-full" />)}
        </div>
        <Bone className="mt-5 h-3.5 w-full max-w-2xl" />
        <Bone className="mt-2 h-3.5 w-2/3 max-w-xl" />
        <Bone className="mt-7 h-11 w-44 rounded-full" />
      </div>
    </section>
  );
}

function EpisodeGridSkeleton(): React.JSX.Element {
  return (
    <section>
      <Bone className="mb-5 h-7 w-40" />
      <ul className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3 lg:grid-cols-4">
        {EPISODE_KEYS.map((key) => (
          <li key={key}>
            <Bone className="aspect-video w-full rounded-xl" />
            <Bone className="mt-2 h-3.5 w-3/4" />
          </li>
        ))}
      </ul>
    </section>
  );
}

function LibrarySkeletonContent({ page }: { readonly page: LibrarySkeletonPage }): React.JSX.Element {
  if (page === "show") {
    return (
      <>
        <ShowHeroSkeleton />
        <EpisodeGridSkeleton />
      </>
    );
  }
  if (page === "results") {
    return <ShowGridSkeleton />;
  }
  return (
    <>
      <HomeHeroSkeleton />
      <div className="mt-10">
        <RecentlyAddedSkeleton />
        <ShowGridSkeleton />
      </div>
    </>
  );
}

/** Library home, search results or a show page, in the shape the loaded page will take. */
export function LibrarySkeleton({ page }: { readonly page: LibrarySkeletonPage }): React.JSX.Element {
  return (
    <div aria-busy="true" aria-label="Loading library">
      <span className="sr-only">Loading library…</span>
      <LibrarySkeletonContent page={page} />
    </div>
  );
}

/** The library placeholder for the current URL: a show page, search results or the home page. */
export function RouteLibrarySkeleton({ showName, query }: {
  readonly showName: string | null;
  readonly query: string;
}): React.JSX.Element {
  return <LibrarySkeleton page={librarySkeletonPage({ showName, query })} />;
}
