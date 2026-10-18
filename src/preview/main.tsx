import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MediaHeader } from "../components/MediaHeader.tsx";
import { ShowPage } from "../components/ShowPage.tsx";
import { SessionProviders } from "../components/SessionProviders.tsx";
import { LibraryHome } from "../components/LibraryHome.tsx";
import { buildContinueWatchingItems } from "../lib/continueWatching.ts";
import { homeEntries, homeMetadata, homeProgress, homeShows, type HomeState } from "./homeFixtures.ts";
import "../styles.css";
import {
  previewJobs, previewMedia, previewMetadata, previewProgress, previewReadiness, previewShow, previewUser,
  type PreviewState,
} from "./fixtures.ts";

/**
 * Design preview: the real show page rendered from fixtures, no backend.
 * Open /preview/?state=loading|needs|partial|transcoding|ready (show page)
 * or ?state=home-watching|home-fresh (library home) under `bun run dev`.
 */
const STATES = new Set<PreviewState>(["loading", "needs", "partial", "transcoding", "ready"]);
const HOME_STATES = new Set<HomeState>(["watching", "fresh"]);
const requested = new URL(globalThis.location.href).searchParams.get("state") ?? "";
const homeState = HOME_STATES.has(requested.replace(/^home-/u, "") as HomeState) && requested.startsWith("home-")
  ? requested.replace(/^home-/u, "") as HomeState
  : null;
const state: PreviewState = STATES.has(requested as PreviewState) ? requested as PreviewState : "needs";

// API calls never settle, so seeded data stays on screen and nothing polls a server.
const realFetch = globalThis.fetch.bind(globalThis);
const pending = Promise.withResolvers<Response>().promise;
globalThis.fetch = Object.assign(
  (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => (
    String(input instanceof Request ? input.url : input).includes("/api/") ? pending : realFetch(input, init)
  ),
  { preconnect: globalThis.fetch.preconnect },
);

const client = new QueryClient({ defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY, retry: false } } });
const streamed = previewShow.entries.map((entry) => entry.rel);
// "loading" leaves readiness unanswered, the moment before the server replies.
if (state !== "loading") {
  client.setQueryData(["playback-readiness", ...streamed], previewReadiness(state));
}
client.setQueryData(["transcodes"], previewJobs(state));

const noop = (): void => undefined;
const NO_DOWNLOADS: readonly [] = [];
const container = document.querySelector("#root");
if (container === null) {
  throw new Error("Root container #root is missing");
}
function HomePreview({ home }: { readonly home: HomeState }): React.JSX.Element {
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

function ShowPreview(): React.JSX.Element {
  return (
    <>
      <MediaHeader user={previewUser} view="admin" />
      <main className="mx-auto max-w-7xl px-6 py-6">
        <ShowPage
          show={previewShow}
          media={previewMedia}
          metadata={previewMetadata}
          progress={previewProgress(state)}
          canTranscode
          onBack={noop}
          onEpisodeSelect={noop}
        />
      </main>
    </>
  );
}

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={client}>
      <SessionProviders userId={previewUser.id}>
        {homeState === null ? <ShowPreview /> : <HomePreview home={homeState} />}
      </SessionProviders>
    </QueryClientProvider>
  </StrictMode>,
);
