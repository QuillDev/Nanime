import { MediaHeader } from "../components/MediaHeader.tsx";
import { LibraryHome } from "../components/LibraryHome.tsx";
import { buildContinueWatchingItems } from "../lib/continueWatching.ts";
import { homeEntries, homeMetadata, homeProgress, homeShows, type HomeState } from "./homeFixtures.ts";
import { previewUser } from "./fixtures.ts";

export type { HomeState } from "./homeFixtures.ts";

const noop = (): void => undefined;
const NO_DOWNLOADS: readonly [] = [];

export function HomePreview({ home }: { readonly home: HomeState }): React.JSX.Element {
  const progress = homeProgress(home);
  return (
    <>
      <MediaHeader user={previewUser} view="library" query="" shows={homeShows} metadata={homeMetadata} onQueryChange={noop} onShowSelect={noop} overlay />
      <main className="mx-auto max-w-7xl px-6 py-6">
        <LibraryHome
          continueWatching={buildContinueWatchingItems(homeShows, homeMetadata, progress)}
          downloads={NO_DOWNLOADS}
          entries={homeEntries}
          metadata={homeMetadata}
          progress={progress}
          showContinueWatching
          shows={homeShows}
          onEpisodeSelect={noop}
          onShowSelect={noop}
        />
      </main>
    </>
  );
}
