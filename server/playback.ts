import { database } from "./database.ts";

const MINIMUM_PROGRESS_SECONDS = 30;

interface PlaybackRow {
  readonly rel: string;
  readonly position: number;
  readonly duration: number;
  readonly completed: number;
  readonly updated_at: number;
}

interface PlaybackUpdate {
  readonly rel?: unknown;
  readonly position?: unknown;
  readonly duration?: unknown;
  readonly completed?: unknown;
}

export interface PlaybackProgress {
  readonly rel: string;
  readonly position: number;
  readonly duration: number;
  readonly completed: boolean;
  readonly updatedAt: number;
}

const listProgress = database.query<PlaybackRow, [number]>(`
  SELECT rel, position, duration, completed, updated_at
  FROM playback_progress
  WHERE user_id = ?
  ORDER BY updated_at DESC
`);

const getProgress = database.query<PlaybackRow, [number, string]>(`
  SELECT rel, position, duration, completed, updated_at
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
    updated_at = excluded.updated_at
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
  };
}

export function playbackProgressResponse(userId: number): Response {
  return Response.json(listProgress.all(userId).map((row) => progressFromRow(row)));
}

function validNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export async function updatePlaybackProgress(
  req: Request,
  userId: number,
  mediaExists: (rel: string) => Promise<boolean>,
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
  if (!(await mediaExists(body.rel))) {
    return new Response("Media not found", { status: 404 });
  }

  const position = body.duration > 0 ? Math.min(body.position, body.duration) : body.position;
  const isMeaningful = position > MINIMUM_PROGRESS_SECONDS;
  const nearEnd = isMeaningful &&
    body.duration > 0 &&
    position >= Math.max(body.duration * 0.9, body.duration - 120);
  const wasCompleted = getProgress.get(userId, body.rel)?.completed === 1;
  const progress: PlaybackProgress = {
    rel: body.rel,
    position,
    duration: body.duration,
    completed: wasCompleted || isMeaningful && (body.completed || nearEnd),
    updatedAt: Date.now(),
  };
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
