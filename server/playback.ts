import { database } from "./database.ts";
import type { PlaybackProgress } from "../shared/types.ts";
import type { AniListPlaybackTarget } from "./anilistAccountTypes.ts";
import { isPlaybackComplete, playbackWatchedState } from "../shared/playback.ts";

interface PlaybackRow {
  readonly rel: string;
  readonly position: number;
  readonly duration: number;
  readonly completed: number;
  readonly updated_at: number;
  readonly dismissed_at: number | null;
}

interface PlaybackUpdate {
  readonly rel?: unknown;
  readonly position?: unknown;
  readonly duration?: unknown;
  readonly completed?: unknown;
  readonly anilistMediaId?: unknown;
  readonly episode?: unknown;
  readonly totalEpisodes?: unknown;
}

interface PlaybackUpdateOptions {
  readonly mediaExists: (rel: string) => Promise<boolean>;
  readonly sync?: (target: AniListPlaybackTarget) => Promise<void>;
}

const listProgress = database.query<PlaybackRow, [number]>(`
  SELECT rel, position, duration, completed, updated_at, dismissed_at
  FROM playback_progress
  WHERE user_id = ?
  ORDER BY updated_at DESC
`);

const getProgress = database.query<PlaybackRow, [number, string]>(`
  SELECT rel, position, duration, completed, updated_at, dismissed_at
  FROM playback_progress
  WHERE user_id = ? AND rel = ?
`);

const upsertProgress = database.query<void, [number, string, number, number, number, number]>(`
  INSERT INTO playback_progress (user_id, rel, position, duration, completed, updated_at)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(user_id, rel) DO UPDATE SET
    position = excluded.position,
    duration = excluded.duration,
    completed = excluded.completed,
    updated_at = excluded.updated_at,
    dismissed_at = NULL
`);
const dismissProgress = database.query<void, [number, number, string]>(`
  UPDATE playback_progress SET dismissed_at = ?
  WHERE user_id = ? AND rel = ?
`);
const deleteProgress = database.query<void, [string]>(`
  DELETE FROM playback_progress WHERE rel = ?
`);
const deleteProgressTransaction = database.transaction((rels: readonly string[]) => {
  for (const rel of rels) {
    deleteProgress.run(rel);
  }
});

export function forgetPlaybackProgress(rels: readonly string[]): void {
  deleteProgressTransaction(rels);
}

function progressFromRow(row: PlaybackRow): PlaybackProgress {
  return {
    rel: row.rel,
    position: row.position,
    duration: row.duration,
    completed: row.completed === 1,
    updatedAt: row.updated_at,
    dismissedAt: row.dismissed_at,
  };
}

export function playbackProgressResponse(userId: number): Response {
  return Response.json(listProgress.all(userId).map((row) => progressFromRow(row)));
}

export async function dismissPlaybackProgress(req: Request, userId: number): Promise<Response> {
  const body = (await req.json().catch(() => null)) as { readonly rel?: unknown } | null;
  if (body === null || typeof body.rel !== "string" || body.rel === "") {
    return new Response("Invalid playback progress", { status: 400 });
  }
  dismissProgress.run(Date.now(), userId, body.rel);
  const progress = getProgress.get(userId, body.rel);
  return progress === null
    ? new Response("Playback progress not found", { status: 404 })
    : Response.json(progressFromRow(progress));
}

export async function setPlaybackWatchedState(
  req: Request,
  userId: number,
  options: Pick<PlaybackUpdateOptions, "mediaExists">,
): Promise<Response> {
  const body = (await req.json().catch(() => null)) as {
    readonly rel?: unknown;
    readonly watched?: unknown;
  } | null;
  if (
    body === null ||
    typeof body.rel !== "string" ||
    body.rel === "" ||
    typeof body.watched !== "boolean"
  ) {
    return new Response("Invalid watched state", { status: 400 });
  }
  if (!(await options.mediaExists(body.rel))) {
    return new Response("Media not found", { status: 404 });
  }
  const existing = getProgress.get(userId, body.rel);
  const progress = playbackWatchedState({
    rel: body.rel,
    watched: body.watched,
    existing: existing === null ? null : progressFromRow(existing),
    updatedAt: Date.now(),
  });
  upsertProgress.run(
    userId,
    progress.rel,
    progress.position,
    progress.duration,
    progress.completed ? 1 : 0,
    progress.updatedAt,
  );
  return Response.json(progress);
}

function validNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export async function updatePlaybackProgress(
  req: Request,
  userId: number,
  options: PlaybackUpdateOptions,
): Promise<Response> {
  const body = (await req.json().catch(() => null)) as PlaybackUpdate | null;
  if (
    body === null ||
    typeof body.rel !== "string" ||
    body.rel === "" ||
    !validNumber(body.position) ||
    !validNumber(body.duration) ||
    typeof body.completed !== "boolean"
  ) {
    return new Response("Invalid playback progress", { status: 400 });
  }
  if (!(await options.mediaExists(body.rel))) {
    return new Response("Media not found", { status: 404 });
  }

  const position = body.duration > 0 ? Math.min(body.position, body.duration) : body.position;
  const progress: PlaybackProgress = {
    rel: body.rel,
    position,
    duration: body.duration,
    completed: isPlaybackComplete(position, body.duration, body.completed),
    updatedAt: Date.now(),
    dismissedAt: null,
  };
  upsertProgress.run(
    userId,
    progress.rel,
    progress.position,
    progress.duration,
    progress.completed ? 1 : 0,
    progress.updatedAt,
  );
  if (
    options.sync !== undefined &&
    Number.isInteger(body.anilistMediaId) && (body.anilistMediaId as number) > 0 &&
    Number.isInteger(body.episode) && (body.episode as number) > 0 &&
    (body.totalEpisodes === null ||
      Number.isInteger(body.totalEpisodes) && (body.totalEpisodes as number) > 0)
  ) {
    await options.sync({
      mediaId: body.anilistMediaId as number,
      episode: body.episode as number,
      totalEpisodes: body.totalEpisodes as number | null,
      completed: progress.completed,
    }).catch(() => undefined);
  }
  return Response.json(progress);
}
