import { MediaHeader } from "../components/MediaHeader.tsx";
import { ShowPage } from "../components/ShowPage.tsx";
import type { ShowGroup } from "../lib/library.ts";
import type { PlaybackProgressMap } from "../types.ts";
import { previewMedia, previewMetadata, previewUser } from "./fixtures.ts";

const noop = (): void => undefined;

/** The real show page over fixture data, as an admin sees it. */
export function ShowPreview({ show, progress }: { readonly show: ShowGroup; readonly progress: PlaybackProgressMap }): React.JSX.Element {
  return (
    <>
      <MediaHeader user={previewUser} view="admin" />
      <main className="mx-auto max-w-7xl px-6 py-6">
        <ShowPage
          show={show}
          media={previewMedia}
          metadata={previewMetadata}
          progress={progress}
          canTranscode
          onBack={noop}
          onEpisodeSelect={noop}
        />
      </main>
    </>
  );
}
