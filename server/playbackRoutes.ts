import { watchTogetherRoute } from "./watchTogetherRoutes.ts";
import type { AuthUser } from "../shared/types.ts";
import type { AniListPlaybackTarget } from "./anilistAccountTypes.ts";
import {
  dismissPlaybackProgress,
  playbackAuditResponse,
  playbackProgressResponse,
  restorePlaybackAuditResponse,
  setPlaybackWatchedState,
  updatePlaybackProgress,
} from "./playback.ts";

interface PlaybackRouteContext {
  readonly pathname: string;
  readonly url: URL;
  readonly req: Request;
  readonly user: AuthUser;
}

interface PlaybackRouteOptions {
  readonly mediaExists: (rel: string) => Promise<boolean>;
  readonly sync: (userId: number, target: AniListPlaybackTarget) => Promise<void>;
}

function updateOptions(userId: number, options: PlaybackRouteOptions) {
  return {
    mediaExists: options.mediaExists,
    sync: (target: AniListPlaybackTarget) => options.sync(userId, target),
  };
}

export function playbackRoute(
  context: PlaybackRouteContext,
  options: PlaybackRouteOptions,
): Response | Promise<Response> | null {
  const { pathname, url, req, user } = context;
  const updates = updateOptions(user.id, options);
  if (pathname === "/api/progress" && req.method === "GET") {
    return playbackProgressResponse(user.id);
  }
  if (pathname === "/api/progress" && req.method === "PUT") {
    return updatePlaybackProgress(req, user, updates);
  }
  if (pathname === "/api/progress/dismiss" && req.method === "POST") {
    return dismissPlaybackProgress(req, user);
  }
  if (pathname === "/api/progress/watched" && req.method === "POST") {
    return setPlaybackWatchedState(req, user, updates);
  }
  if (pathname === "/api/progress/history" && req.method === "GET") {
    return playbackAuditResponse(url, user);
  }
  const restoreMatch = /^\/api\/progress\/history\/(?<id>\d+)\/restore$/u.exec(pathname);
  const eventId = restoreMatch?.groups?.["id"];
  return eventId === undefined
    ? watchTogetherRoute(context, options.mediaExists)
    : restorePlaybackAuditResponse({ req, eventId: Number(eventId), actor: user, ...updates });
}
