import { afterEach, expect, test } from "bun:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { applyPlaybackHistoryRestore } from "../src/lib/playbackHistoryCache.ts";
import type { PlaybackProgressMap } from "../src/types.ts";
import type { MediaEntry, PlaybackAuditEvent, PlaybackProgress } from "../shared/types.ts";
import { getJson, operationStatus, reference, startLibraryTestServer, type LibraryTestServer } from "./libraryFilesTestServer.ts";

let server: LibraryTestServer | null = null;
afterEach(async () => { await server?.close(); server = null; });

async function movedHistory() {
  server = await startLibraryTestServer(async (media) => {
    await writeFile(join(media, "old.mkv"), "A");
    await writeFile(join(media, "replacement.mkv"), "B");
  });
  const target = server;
  for (const watched of [true, false]) {
    const response = await target.request("/api/progress/watched", { method: "POST", body: JSON.stringify({ rel: "old.mkv", watched }) });
    expect(response.status).toBe(200);
  }
  const history = await getJson<readonly PlaybackAuditEvent[]>(target, "/api/progress/history");
  expect(await operationStatus(target, "rename", { item: await reference(target, "old.mkv"), name: "new.mkv" })).toBe(200);
  expect(await operationStatus(target, "rename", { item: await reference(target, "replacement.mkv"), name: "old.mkv" })).toBe(200);
  const entries = await getJson<readonly MediaEntry[]>(target, "/api/list");
  const replacement = entries.find((entry) => entry.rel === "old.mkv")!;
  const response = await target.request("/api/progress/watched", { method: "POST", body: JSON.stringify({ rel: replacement.rel, mediaIdentity: replacement.mediaIdentity, watched: false }) });
  expect(response.status).toBe(200);
  const replacementProgress = await response.json() as PlaybackProgress;
  return { target, history, replacementProgress };
}

async function restore(target: LibraryTestServer, event: PlaybackAuditEvent): Promise<PlaybackProgress | null> {
  const response = await target.request(`/api/progress/history/${String(event.id)}/restore`, { method: "POST" });
  expect(response.status).toBe(200);
  return await response.json() as PlaybackProgress | null;
}

test("history cache keys restored watched state by the response's current path, not immutable event.rel", async () => {
  const { target, history, replacementProgress } = await movedHistory();
  const client = new QueryClient();
  try {
    client.setQueryData(["playback-history"], history);
    const entries = await getJson<readonly PlaybackProgress[]>(target, "/api/progress");
    client.setQueryData(["playback-progress"], Object.fromEntries(entries.map((entry) => [entry.rel, entry])));
    const event = history.find((item) => item.action === "unwatched")!;
    const saved = await restore(target, event);
    await applyPlaybackHistoryRestore(client, saved);
    expect(client.getQueryData<PlaybackProgressMap>(["playback-progress"])).toEqual({ "new.mkv": expect.objectContaining({ rel: "new.mkv", completed: true }), "old.mkv": replacementProgress });
    expect(client.getQueryState(["playback-progress"])?.isInvalidated).toBe(true);
    expect(client.getQueryState(["playback-history"])?.isInvalidated).toBe(true);
  } finally { client.clear(); }
});

test("null history restoration refetches active progress and clears the visible current file", async () => {
  const { target, history, replacementProgress } = await movedHistory();
  const client = new QueryClient();
  const observer = new QueryObserver(client, {
    queryKey: ["playback-progress"],
    queryFn: async () => {
      const entries = await getJson<readonly PlaybackProgress[]>(target, "/api/progress");
      return Object.fromEntries(entries.map((entry) => [entry.rel, entry]));
    },
    staleTime: Infinity,
  });
  const unsubscribe = observer.subscribe(() => {});
  try {
    client.setQueryData(["playback-history"], history);
    await observer.refetch();
    const unwatched = history.find((item) => item.action === "unwatched")!;
    const watched = history.find((item) => item.action === "watched")!;
    await restore(target, unwatched);
    await observer.refetch();
    expect(observer.getCurrentResult().data?.["new.mkv"]?.completed).toBe(true);
    const cleared = await restore(target, watched);
    expect(cleared).toBeNull();
    await applyPlaybackHistoryRestore(client, cleared);
    expect(observer.getCurrentResult().data).toEqual({ "old.mkv": replacementProgress });
    expect(client.getQueryState(["playback-history"])?.isInvalidated).toBe(true);
  } finally { unsubscribe(); client.clear(); }
});
