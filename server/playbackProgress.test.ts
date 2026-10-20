import { afterAll, beforeAll, expect, test } from "bun:test";
import type { PlaybackProgress } from "../shared/types.ts";
import { getJson, startLibraryTestServer, statusOf, viewerCookie, type LibraryTestServer } from "./libraryFilesTestServer.ts";

const EPISODE = "Example Show/Season 1/Example Show - 01.mkv";
let server: LibraryTestServer | null = null;

beforeAll(async () => {
  server = await startLibraryTestServer();
});

afterAll(async () => {
  await server?.close();
});

function target(): LibraryTestServer {
  if (server === null) {
    throw new Error("Test server is not running");
  }
  return server;
}

interface Save {
  readonly duration?: number;
  /** The player reached the end of the video. */
  readonly ended?: boolean;
  /** Save as the user signed in with this cookie instead of the admin. */
  readonly cookie?: string;
}

/** Saves a playback position; returns the HTTP status. */
function save(rel: string, position: number, options: Save = {}): Promise<number> {
  const body = JSON.stringify({ rel, position, duration: options.duration ?? 1440, completed: options.ended ?? false });
  return statusOf(target().request("/api/progress", { method: "PUT", body, cookie: options.cookie }));
}

function markWatched(rel: string, watched: boolean): Promise<number> {
  return statusOf(target().request("/api/progress/watched", { method: "POST", json: { rel, watched } }));
}

async function progressOf(rel: string): Promise<PlaybackProgress | undefined> {
  const progress = await progressFor();
  return progress.find((entry) => entry.rel === rel);
}

function dismiss(rel: string, cookie?: string): Promise<number> {
  return statusOf(target().request("/api/progress/dismiss", { method: "POST", json: { rel }, cookie }));
}

function progressFor(cookie?: string): Promise<readonly PlaybackProgress[]> {
  return getJson<readonly PlaybackProgress[]>(target(), "/api/progress", cookie);
}

test("saved progress belongs to the user who watched, and dismissing it from home keeps the position", async () => {
  const viewer = await viewerCookie(target());

  expect(await save(EPISODE, 300)).toBe(200);
  expect(await progressFor()).toEqual([expect.objectContaining({ rel: EPISODE, position: 300, completed: false, dismissedAt: null })]);
  expect(await progressFor(viewer)).toEqual([]);

  expect(await dismiss(EPISODE, viewer)).toBe(404);
  expect(await dismiss(EPISODE)).toBe(200);
  const [dismissed] = await progressFor();
  expect(dismissed).toMatchObject({ rel: EPISODE, position: 300 });
  expect(dismissed?.dismissedAt).toBeNumber();

  // Watching again brings the episode back to the home screen.
  expect(await save(EPISODE, 420)).toBe(200);
  expect(await progressFor()).toEqual([expect.objectContaining({ rel: EPISODE, position: 420, dismissedAt: null })]);
});

test("the last stretch of an episode or reaching its end counts as watched; missing media is refused without a write", async () => {
  const before = await progressFor();
  expect(await save("Example Show/Season 1/Missing.mkv", 10)).toBe(404);
  expect(await progressFor()).toEqual(before);

  expect(await save("Other Show/Episode 1.mp4", 1310, { duration: 1420 })).toBe(200);
  expect(await progressOf("Other Show/Episode 1.mp4")).toMatchObject({ position: 1310, completed: true });
  expect(await save("Example Show/Season 2/Example Show - 03.mkv", 900, { duration: 1420, ended: true })).toBe(200);
  expect(await progressOf("Example Show/Season 2/Example Show - 03.mkv")).toMatchObject({ position: 900, completed: true });
});

test("marking watched and unwatched by hand, and rewatching a finished episode", async () => {
  const unplayed = "Seeding Show/Seeding Show - 01.mkv";
  const rewatched = "Example Show/Season 1/Example Show - 02.mkv";

  // Marked watched without playing: no invented playback time.
  expect(await markWatched(unplayed, true)).toBe(200);
  expect(await progressOf(unplayed)).toMatchObject({ position: 0, duration: 0, completed: true });

  expect(await save(rewatched, 800, { duration: 1400 })).toBe(200);
  expect(await markWatched(rewatched, true)).toBe(200);
  expect(await progressOf(rewatched)).toMatchObject({ position: 800, completed: true });
  // Starting it again makes it resumable instead of staying finished.
  expect(await save(rewatched, 947, { duration: 1420 })).toBe(200);
  expect(await progressOf(rewatched)).toMatchObject({ position: 947, completed: false });

  // Unwatched clears the resume point but keeps the known length.
  expect(await markWatched(rewatched, true)).toBe(200);
  expect(await markWatched(rewatched, false)).toBe(200);
  expect(await progressOf(rewatched)).toMatchObject({ position: 0, duration: 1420, completed: false });
});
