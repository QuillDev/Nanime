import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MediaHeader } from "../components/MediaHeader.tsx";
import { ShowPage } from "../components/ShowPage.tsx";
import { SessionProviders } from "../components/SessionProviders.tsx";
import "../styles.css";
import {
  previewJobs, previewMedia, previewMetadata, previewProgress, previewReadiness, previewShow, previewUser,
  type PreviewState,
} from "./fixtures.ts";

/**
 * Design preview: the real show page rendered from fixtures, no backend.
 * Open /preview/?state=needs|partial|transcoding|ready under `bun run dev`.
 */
const STATES = new Set<PreviewState>(["needs", "partial", "transcoding", "ready"]);
const requested = new URL(globalThis.location.href).searchParams.get("state") as PreviewState | null;
const state: PreviewState = requested !== null && STATES.has(requested) ? requested : "needs";

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
client.setQueryData(["playback-readiness", ...streamed], previewReadiness(state));
client.setQueryData(["transcodes"], previewJobs(state));

const noop = (): void => undefined;
const container = document.querySelector("#root");
if (container === null) {
  throw new Error("Root container #root is missing");
}
createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={client}>
      <SessionProviders userId={previewUser.id}>
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
      </SessionProviders>
    </QueryClientProvider>
  </StrictMode>,
);
