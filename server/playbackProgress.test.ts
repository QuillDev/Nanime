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

/** Saves a position as the admin, or as the user signed in with `cookie`; returns the HTTP status. */
function save(rel: string, position: number, cookie?: string): Promise<number> {
  const body = JSON.stringify({ rel, position, duration: 1440, completed: false });
  return statusOf(target().request("/api/progress", { method: "PUT", body, cookie }));
}

function dismiss(rel: string, cookie?: string): Promise<number> {
  return statusOf(target().request("/api/progress/dismiss", { method: "POST", body: JSON.stringify({ rel }), cookie }));
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

test("progress near the end of an episode counts as watched, and missing media is refused without a write", async () => {
  const before = await progressFor();
  expect(await save("Example Show/Season 1/Missing.mkv", 10)).toBe(404);
  expect(await progressFor()).toEqual(before);

  expect(await save("Other Show/Episode 1.mp4", 1400)).toBe(200);
  const progress = await progressFor();
  expect(progress.find((entry) => entry.rel === "Other Show/Episode 1.mp4")).toMatchObject({ position: 1400, completed: true });
});
