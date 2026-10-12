import type { PlaybackAuditEvent } from "../shared/types.ts";
import type { AniListPlaybackTarget } from "./anilistAccountTypes.ts";
import { isPlaybackComplete, playbackWatchedState } from "../shared/playback.ts";
import {
  mutatePlayback,
  playbackAuditEvent,
  playbackAuditForUser,
  playbackProgressForUser,
  removePlaybackForMedia,
  restorePlaybackAuditEvent,
  type PlaybackActor,
} from "./playbackAudit.ts";
import { hasInternalSegment } from "./libraryPaths.ts";
import { currentMediaPath, currentMediaPathForAudit, departedMediaPaths } from "./mediaPathHistory.ts";
import { admittedPlaybackMutation, playbackCandidatePaths } from "./playbackConcurrency.ts";

interface PlaybackUpdate {
  readonly mediaIdentity?: unknown;
  readonly rel?: unknown;
  readonly position?: unknown;
  readonly duration?: unknown;
  readonly completed?: unknown;
  readonly anilistMediaId?: unknown;
  readonly episode?: unknown;
  readonly totalEpisodes?: unknown;
  readonly event?: unknown;
  readonly sessionSeconds?: unknown;
}

type PlaybackSaveEvent = "completed" | "heartbeat" | "seeked" | "started" | "stopped";

type WatchedOrigin = "episode-menu" | "season-menu" | "series-menu";

export function forgetPlaybackProgress(
  rels: readonly string[],
  actor: PlaybackActor | null = null,
): void {
  removePlaybackForMedia(rels, actor);
}

interface PlaybackUpdateOptions {
  readonly mediaIdentity?: (rel: string) => Promise<string | null>;
  readonly mediaExists: (rel: string) => Promise<boolean>;
  readonly sync?: (target: AniListPlaybackTarget) => Promise<void>;
}

interface PlaybackSyncFields {
  readonly anilistMediaId?: unknown;
  readonly episode?: unknown;
  readonly totalEpisodes?: unknown;
}

/** A playable library path: present, and not inside Nanime's own folders such as the trash. */
async function playablePath(rel: string | null, options: PlaybackUpdateOptions): Promise<string | null> {
  return rel !== null && !hasInternalSegment(rel) && await options.mediaExists(rel) ? rel : null;
}

async function identifiedPlaybackPath(
  candidate: string | null,
  identity: string,
  options: PlaybackUpdateOptions,
): Promise<string | null> {
  const path = await playablePath(candidate, options);
  if (path === null || options.mediaIdentity === undefined) {
    return null;
  }
  return await options.mediaIdentity(path) === identity ? path : null;
}

/**
 * The media's current path. A client that queued progress before an admin
 * renamed or moved the file still reaches the same media through path
 * history, unless that history is ambiguous or leads to the trash.
 */
async function existingMediaPath(request: { readonly rel: string; readonly mediaIdentity?: unknown }, options: PlaybackUpdateOptions): Promise<string | null> {
  const { rel, mediaIdentity } = request;
  const departures = departedMediaPaths(rel);
  if (mediaIdentity !== undefined) {
    if (typeof mediaIdentity !== "string" || options.mediaIdentity === undefined) {
      return null;
    }
    const candidates = [...new Set([rel, ...departures])];
    const resolved = await Promise.all(candidates.map((candidate) => identifiedPlaybackPath(candidate, mediaIdentity, options)));
    const matches = resolved.filter((path): path is string => path !== null);
    return matches.length === 1 ? matches[0] ?? null : null;
  }
  const present = await playablePath(rel, options);
  // Once something left an occupied path, a legacy request could mean either
  // occupant. Never prefer the present file over the departed one.
  if (present !== null) {
    return departures.length === 0 ? present : null;
  }
  return await playablePath(currentMediaPath(rel), options);
}

/**
 * Where a history restore applies: the event's media wherever it lives now.
 * Restoring saved progress needs the media present; clearing progress may
 * target missing media, but never trashed media, whose progress Undo restores.
 */
async function restoreTarget(event: PlaybackAuditEvent, options: PlaybackUpdateOptions): Promise<string | null> {
  const rel = currentMediaPathForAudit(event.rel, event.id);
  if (rel === null || hasInternalSegment(rel)) {
    return null;
  }
  return event.previous === null ? rel : await playablePath(rel, options);
}

export function playbackProgressResponse(userId: number): Response {
  return Response.json(playbackProgressForUser(userId));
}

export async function dismissPlaybackProgress(req: Request, actor: PlaybackActor): Promise<Response> {
  const body = (await req.json().catch(() => null)) as { readonly rel?: unknown } | null;
  if (body === null || typeof body.rel !== "string" || body.rel === "") {
    return new Response("Invalid playback progress", { status: 400 });
  }
  const progress = mutatePlayback({
    userId: actor.id,
    actor,
    rel: body.rel,
    action: "playback-stopped",
    origin: "home",
    recordAudit: false,
    next: (previous) => previous === null
      ? null
      : { ...previous, dismissedAt: Date.now(), updatedAt: Date.now() },
  });
  return progress === null
    ? new Response("Playback progress not found", { status: 404 })
    : Response.json(progress);
}

export async function setPlaybackWatchedState(
  req: Request,
  actor: PlaybackActor,
  options: PlaybackUpdateOptions,
): Promise<Response> {
  const body = (await req.json().catch(() => null)) as {
    readonly rel?: unknown;
    readonly watched?: unknown;
    readonly mediaIdentity?: unknown;
    readonly anilistMediaId?: unknown;
    readonly episode?: unknown;
    readonly totalEpisodes?: unknown;
    readonly origin?: unknown;
  } | null;
  if (
    body === null ||
    typeof body.rel !== "string" ||
    body.rel === "" ||
    typeof body.watched !== "boolean"
  ) {
    return new Response("Invalid watched state", { status: 400 });
  }
  const { rel: requestedRel, watched } = body;
  const progress = await admittedPlaybackMutation(playbackCandidatePaths(requestedRel), async () => {
    const rel = await existingMediaPath({ rel: requestedRel, mediaIdentity: body.mediaIdentity }, options);
    if (rel === null) {
      return new Response("Media not found", { status: 404 });
    }
    return mutatePlayback({
      userId: actor.id,
      actor,
      rel,
      action: watched ? "watched" : "unwatched",
      origin: watchedOrigin(body.origin),
      anilistTarget: playbackTargetIdentity(body),
      next: (existing) => playbackWatchedState({ rel, watched, existing, updatedAt: Date.now() }),
    });
  });
  if (progress instanceof Response) {
    return progress;
  }
  if (progress === null) {
    return new Response("Could not update watched state", { status: 500 });
  }
  await syncPlayback(options, playbackSyncTarget(body, progress.completed, true));
  return Response.json(progress);
}

function validNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export async function updatePlaybackProgress(
  req: Request,
  actor: PlaybackActor,
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
  const { rel: requestedRel, duration, completed } = body;
  const position = duration > 0 ? Math.min(body.position, duration) : body.position;
  const saveEvent = playbackSaveEvent(body.event, completed);
  const sessionSeconds = validNumber(body.sessionSeconds) ? body.sessionSeconds : null;
  const progress = await admittedPlaybackMutation(playbackCandidatePaths(requestedRel), async () => {
    const rel = await existingMediaPath({ rel: requestedRel, mediaIdentity: body.mediaIdentity }, options);
    if (rel === null) {
      return new Response("Media not found", { status: 404 });
    }
    return mutatePlayback({
      userId: actor.id,
      actor,
      rel,
      action: playbackAuditAction(saveEvent),
      origin: "player",
      anilistTarget: playbackTargetIdentity(body),
      sessionSeconds,
      recordAudit: saveEvent === "started" || saveEvent === "completed" ||
        saveEvent === "stopped" && sessionSeconds !== null,
      next: () => ({
        rel, position, duration,
        completed: isPlaybackComplete(position, duration, completed),
        updatedAt: Date.now(),
        dismissedAt: null,
      }),
    });
  });
  if (progress instanceof Response) {
    return progress;
  }
  if (progress === null) {
    return new Response("Could not save playback progress", { status: 500 });
  }
  await syncPlayback(options, playbackSyncTarget(body, progress.completed, false));
  return Response.json(progress);
}

function playbackSaveEvent(value: unknown, completed: boolean): PlaybackSaveEvent {
  if (completed) {
    return "completed";
  }
  if (value === "started" || value === "stopped" || value === "seeked") {
    return value;
  }
  return "heartbeat";
}

function playbackAuditAction(event: PlaybackSaveEvent) {
  if (event === "started") {
    return "playback-started" as const;
  }
  if (event === "stopped") {
    return "playback-stopped" as const;
  }
  return event === "completed" ? "completed" as const : "playback-stopped" as const;
}

function watchedOrigin(value: unknown): WatchedOrigin {
  return value === "season-menu" || value === "series-menu" ? value : "episode-menu";
}

export function playbackAuditResponse(url: URL, actor: PlaybackActor): Response {
  const requestedLimit = Number(url.searchParams.get("limit") ?? "50");
  const limit = Number.isInteger(requestedLimit) ? Math.min(100, Math.max(1, requestedLimit)) : 50;
  const rel = url.searchParams.get("rel");
  return Response.json(playbackAuditForUser(actor.id, limit, rel));
}

export async function restorePlaybackAuditResponse(options: PlaybackUpdateOptions & {
  readonly req: Request;
  readonly eventId: number;
  readonly actor: PlaybackActor;
}): Promise<Response> {
  const { req, eventId, actor } = options;
  if (req.method !== "POST" || !Number.isInteger(eventId) || eventId <= 0) {
    return new Response("Invalid playback history event", { status: 400 });
  }
  const event = playbackAuditEvent(actor.id, eventId);
  if (event === null) {
    return new Response("Playback history event not found", { status: 404 });
  }
  const currentPath = currentMediaPathForAudit(event.rel, event.id);
  const progress = await admittedPlaybackMutation(playbackCandidatePaths(event.rel, currentPath), async () => {
    const rel = await restoreTarget(event, options);
    return rel === null
      ? new Response("Media no longer exists", { status: 404 })
      : restorePlaybackAuditEvent(event, actor, rel);
  });
  if (progress instanceof Response) {
    return progress;
  }
  if (event.anilistMediaId !== null && event.episode !== null) {
    await syncPlayback(options, {
      mediaId: event.anilistMediaId,
      episode: event.episode,
      totalEpisodes: event.totalEpisodes,
      completed: progress?.completed ?? false,
      allowDecrease: true,
    });
  }
  return Response.json(progress);
}

function playbackTargetIdentity(fields: PlaybackSyncFields): {
  readonly mediaId: number;
  readonly episode: number;
  readonly totalEpisodes: number | null;
} | null {
  if (!Number.isInteger(fields.anilistMediaId) || (fields.anilistMediaId as number) <= 0 ||
    !Number.isInteger(fields.episode) || (fields.episode as number) <= 0 ||
    fields.totalEpisodes !== null && (
      !Number.isInteger(fields.totalEpisodes) || (fields.totalEpisodes as number) <= 0
    )) {
    return null;
  }
  return {
    mediaId: fields.anilistMediaId as number,
    episode: fields.episode as number,
    totalEpisodes: fields.totalEpisodes as number | null,
  };
}

function playbackSyncTarget(
  fields: PlaybackSyncFields,
  completed: boolean,
  allowDecrease: boolean,
): AniListPlaybackTarget | null {
  const identity = playbackTargetIdentity(fields);
  return identity === null ? null : {
    ...identity,
    completed,
    allowDecrease,
  };
}

async function syncPlayback(
  options: PlaybackUpdateOptions,
  target: AniListPlaybackTarget | null,
): Promise<void> {
  if (options.sync !== undefined && target !== null) {
    await options.sync(target).catch(() => undefined);
  }
}
