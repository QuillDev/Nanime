import { useEffect } from "react";
import type { AuthUser } from "../types.ts";
import { LinkedAccounts } from "./LinkedAccounts.tsx";
import { MediaHeader } from "./MediaHeader.tsx";
import { PlaybackPreferences } from "./PlaybackPreferences.tsx";
import { PlaybackHistory } from "./PlaybackHistory.tsx";
import { LibraryActivity } from "./LibraryActivity.tsx";
import { OFFLINE_DOWNLOADS_ID, OfflineDownloads } from "./OfflineDownloads.tsx";
import { ProfileHero } from "./ProfileHero.tsx";
import { RecentlyWatched, useRecentlyWatched } from "./RecentlyWatched.tsx";

export function ProfileApp({ user }: { readonly user: AuthUser }): React.JSX.Element {
  const recent = useRecentlyWatched();
  const downloadsLinked = globalThis.location.hash === `#${OFFLINE_DOWNLOADS_ID}`;
  useEffect(() => {
    if (downloadsLinked) {
      document.querySelector(`#${OFFLINE_DOWNLOADS_ID}`)?.scrollIntoView({ behavior: "smooth" });
    }
  }, [downloadsLinked]);
  const banner = recent.items.find((item) => item.episode.banner !== null)?.episode.banner ?? null;
  return (
    <div className="min-h-screen bg-background pb-16 text-foreground">
      <MediaHeader user={user} view="profile" />
      <ProfileHero user={user} banner={banner} />
      <main className="mx-auto w-full max-w-5xl px-4 sm:px-6 lg:px-8">
        <RecentlyWatched items={recent.items} pending={recent.pending} />
        <div className="mt-10">
          <PlaybackPreferences user={user} />
          <LinkedAccounts />
          <OfflineDownloads defaultOpen={downloadsLinked} />
          <PlaybackHistory />
          {user.isAdmin && <LibraryActivity />}
        </div>
      </main>
    </div>
  );
}
