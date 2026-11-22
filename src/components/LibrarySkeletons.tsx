import { librarySkeletonPage, type LibrarySkeletonPage } from "../lib/skeletonPage.ts";
import { BannerBone, Bone, TextBone } from "./Skeleton.tsx";
import { cn } from "../lib/utils.ts";

// Widths of the real filter labels: All shows, Watching, Not started, Finished, Movies.
const FILTER_WIDTHS = ["w-20", "w-[5.25rem]", "w-24", "w-[4.5rem]", "w-16"] as const;
// Widths of the real sort labels: Recently added, A–Z, Release year, Score.
const SORT_WIDTHS = ["w-24", "w-6", "w-[4.75rem]", "w-9"] as const;
const GENRE_KEYS = ["one", "two", "three"] as const;
const POSTER_KEYS = Array.from({ length: 24 }, (_, index) => `poster-${String(index)}`);
const EPISODE_KEYS = Array.from({ length: 8 }, (_, index) => `episode-${String(index)}`);

// Same gradients as HomeHero and ShowHero, so text placeholders sit where the real copy will.
const HOME_GRADIENT = "bg-[linear-gradient(90deg,rgb(0_0_0/0.88)_0%,rgb(0_0_0/0.7)_26%,rgb(0_0_0/0.12)_58%,transparent_100%),linear-gradient(0deg,rgb(0_0_0)_0%,transparent_38%)]";
const SHOW_GRADIENT = "bg-[linear-gradient(90deg,rgb(0_0_0/0.96)_0%,rgb(0_0_0/0.78)_42%,rgb(0_0_0/0.15)_80%),linear-gradient(0deg,rgb(0_0_0)_0%,transparent_55%)]";

function HomeHeroSkeleton(): React.JSX.Element {
  return (
    <section className="relative mx-[calc(50%-50vw)] -mt-[calc(var(--header-height)+1.5rem)] flex min-h-[600px] items-end overflow-hidden sm:min-h-[560px]">
      <BannerBone gradient={HOME_GRADIENT} />
      <div className="relative mx-auto w-full max-w-7xl px-6 pb-10 pt-32 sm:pb-14">
        <div className="w-full max-w-xl">
          <TextBone type="font-display text-4xl leading-[0.98] sm:text-6xl" width="w-4/5" />
          <TextBone type="font-display text-4xl leading-[0.98] sm:text-6xl" width="w-3/5" />
          <TextBone type="mt-4 text-[15px]" width="w-56" />
          <Bone className="mt-3 h-[3px] w-72 max-w-full rounded-full" />
          <div className="mt-6 flex gap-3">
            <Bone className="h-11 w-[7.25rem] rounded-full" />
            <Bone className="h-11 w-[6.5rem] rounded-full" />
          </div>
        </div>
      </div>
    </section>
  );
}

function ShowFiltersSkeleton(): React.JSX.Element {
  return (
    <div className="mb-5 flex gap-x-6 overflow-hidden lg:mb-0 lg:flex-col lg:gap-y-0.5">
      {FILTER_WIDTHS.map((width) => <span key={width} className="flex h-10 shrink-0 items-center"><TextBone type="font-display text-[17px]" width={width} /></span>)}
    </div>
  );
}

function ShowGridSkeleton({ beside = false }: { readonly beside?: boolean }): React.JSX.Element {
  return (
    <section className="min-w-0">
      <div className="mb-5 flex flex-wrap items-end gap-x-6 gap-y-2">
        <TextBone type="font-display text-2xl" width="w-32" />
        <span className="flex-1" />
        <span className="flex gap-x-5 pb-1">
          {SORT_WIDTHS.map((width) => <TextBone key={width} type="text-[13px]" width={width} />)}
        </span>
      </div>
      <ul className={cn("grid grid-cols-3 gap-x-4 gap-y-6 sm:grid-cols-4 md:grid-cols-5", beside ? "xl:grid-cols-6" : "lg:grid-cols-6 xl:grid-cols-8")}>
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
    <section className="relative mx-[calc(50%-50vw)] -mt-[calc(var(--header-height)+1.5rem)] mb-6 flex min-h-[600px] items-end overflow-hidden sm:mb-8 sm:min-h-[calc(420px+var(--header-height))]">
      <BannerBone gradient={SHOW_GRADIENT} />
      <div className="relative mx-auto w-full max-w-7xl px-6 pb-8 pt-[calc(var(--header-height)+4rem)]">
        <Bone className="absolute left-6 top-[calc(var(--header-height)+1.25rem)] h-4 w-20" />
        <Bone className="h-9 w-3/4 max-w-xl sm:h-14" />
        <Bone className="mt-4 h-4 w-56" />
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

function EpisodeListSkeleton(): React.JSX.Element {
  return (
    <section>
      <Bone className="mb-5 h-7 w-40" />
      <ul>
        {EPISODE_KEYS.map((key) => (
          <li key={key} className="flex items-center gap-3 border-t border-white/[0.07] py-2 first:border-t-0 sm:gap-4">
            <Bone className="aspect-video w-24 shrink-0 rounded-lg sm:w-28" />
            <Bone className="h-3.5 w-1/3" />
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
        <EpisodeListSkeleton />
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
        <div className="lg:grid lg:grid-cols-[10.5rem_minmax(0,1fr)] lg:gap-10">
          <ShowFiltersSkeleton />
          <ShowGridSkeleton beside />
        </div>
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
