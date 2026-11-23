import { MediaHeader } from "../components/MediaHeader.tsx";
import { ShowPage } from "../components/ShowPage.tsx";
import type { ShowGroup } from "../lib/library.ts";
import type { PlaybackProgressMap } from "../types.ts";
import { previewMedia, previewUser } from "./fixtures.ts";
import { showPageMetadata } from "./seasonsFixtures.ts";

const noop = (): void => undefined;
const NO_SHOWS: readonly ShowGroup[] = [];

/** The real show page over fixture data, as an admin sees it. */
export function ShowPreview({ show, progress }: { readonly show: ShowGroup; readonly progress: PlaybackProgressMap }): React.JSX.Element {
  return (
    <>
      <MediaHeader user={previewUser} view="library" query="" shows={NO_SHOWS} metadata={showPageMetadata} onQueryChange={noop} onShowSelect={noop} overlay />
      <main className="mx-auto max-w-7xl px-6 py-6">
        <ShowPage
          show={show}
          media={previewMedia}
          metadata={showPageMetadata}
          progress={progress}
          canTranscode
          onBack={noop}
          onEpisodeSelect={noop}
        />
      </main>
    </>
  );
}
