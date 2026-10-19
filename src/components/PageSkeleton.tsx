import type { SkeletonPage } from "../lib/skeletonPage.ts";
import { LibrarySkeleton } from "./LibrarySkeletons.tsx";
import { BannerBone, Bone, HeaderSkeleton, ListSkeleton } from "./Skeleton.tsx";

const RECENT_KEYS = ["one", "two", "three", "four"] as const;
const SECTION_KEYS = ["playback", "anilist", "downloads", "history", "activity"] as const;
const NAV_GROUP_KEYS = ["activity", "library", "server"] as const;
const NAV_ITEM_KEYS = ["first", "second"] as const;
const PROFILE_GRADIENT = "bg-[linear-gradient(0deg,rgb(0_0_0)_4%,rgb(0_0_0/0.55)_55%,rgb(0_0_0/0.25)),linear-gradient(90deg,rgb(0_0_0/0.75),transparent_60%)]";

function ProfileSkeleton(): React.JSX.Element {
  return (
    <div aria-busy="true" aria-label="Loading profile" className="min-h-screen bg-background pb-16 text-foreground">
      <span className="sr-only">Loading profile…</span>
      <HeaderSkeleton search={false} />
      <div className="relative">
        <div className="relative h-44 overflow-hidden sm:h-64">
          <BannerBone gradient={PROFILE_GRADIENT} />
        </div>
        <div className="relative mx-auto -mt-20 flex w-full max-w-5xl items-end gap-4 px-4 sm:-mt-24 sm:gap-5 sm:px-6 lg:px-8">
          <Bone className="size-20 shrink-0 rounded-full border-4 border-background sm:size-24" />
          <div className="min-w-0 flex-1 pb-2">
            <Bone className="h-8 w-40 sm:h-11 sm:w-56" />
            <Bone className="mt-2.5 h-3.5 w-32" />
          </div>
          <Bone className="mb-3 h-4 w-16" />
        </div>
      </div>
      <main className="mx-auto w-full max-w-5xl px-4 sm:px-6 lg:px-8">
        <section className="mt-10">
          <Bone className="h-6 w-44" />
          <ul className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
            {RECENT_KEYS.map((key) => (
              <li key={key}>
                <Bone className="aspect-video w-full rounded-lg" />
                <Bone className="mt-2.5 h-4 w-3/4" />
                <Bone className="mt-1.5 h-3 w-1/2" />
              </li>
            ))}
          </ul>
        </section>
        <div className="mt-10">
          {SECTION_KEYS.map((key) => (
            <div key={key} className="flex items-center gap-3 border-b border-border py-4 first:border-t">
              <Bone className="size-4 shrink-0" />
              <Bone className="h-5 w-36" />
              <span className="flex-1" />
              <Bone className="h-3.5 w-24" />
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}

/** The admin sidebar and page frame, with a list where the tab's content goes. */
export function AdminSkeletonBody(): React.JSX.Element {
  return (
    <main aria-busy="true" aria-label="Loading admin" className="flex flex-col lg:flex-row">
      <span className="sr-only">Loading admin…</span>
      <div className="flex border-b border-border lg:sticky lg:top-[var(--header-height)] lg:h-[calc(100dvh-var(--header-height))] lg:w-60 lg:shrink-0 lg:flex-col lg:border-b-0 lg:border-r lg:px-3 lg:py-5">
        <div className="flex min-w-0 gap-1 overflow-hidden px-3 py-2 lg:flex-col lg:gap-5 lg:p-0">
          {NAV_GROUP_KEYS.map((group) => (
            <div key={group} className="flex shrink-0 gap-1 lg:block">
              <Bone className="mx-3 mb-2.5 hidden h-3 w-14 lg:block" />
              {NAV_ITEM_KEYS.map((item) => (
                <span key={item} className="flex shrink-0 items-center gap-2.5 px-3 py-2.5">
                  <Bone className="size-4 shrink-0" />
                  <Bone className="h-3.5 w-16" />
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
      <section className="min-w-0 flex-1 px-4 py-6 sm:px-8 lg:px-11 lg:py-8">
        <div className="mx-auto max-w-5xl">
          <Bone className="mb-5 h-9 w-48 sm:h-10" />
          <ListSkeleton rows={5} />
        </div>
      </section>
    </main>
  );
}

/** A whole page placeholder for the URL, shown while the session check or the page's code loads. */
export function PageSkeleton({ page }: { readonly page: SkeletonPage }): React.JSX.Element {
  if (page === "profile") {
    return <ProfileSkeleton />;
  }
  if (page === "admin") {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <HeaderSkeleton search={false} />
        <AdminSkeletonBody />
      </div>
    );
  }
  return (
    <div className="min-h-screen overflow-x-clip bg-background text-foreground">
      <HeaderSkeleton overlay={page === "home"} />
      <main className="mx-auto max-w-7xl px-6 py-6">
        <LibrarySkeleton page={page} />
      </main>
    </div>
  );
}
