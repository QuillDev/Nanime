import type {
  AniListMedia,
  AuthUser,
  MediaEntry,
  PlaybackProgress,
  ShowMetadata,
  SubtitleTrack,
  ProvisionedUser,
  TorrentStatus,
} from "./types.ts";

export function streamUrl(rel: string): string {
  return `/stream?path=${encodeURIComponent(rel)}`;
}

export function hlsUrl(rel: string): string {
  return `/hls/index?path=${encodeURIComponent(rel)}`;
}

export function thumbnailUrl(rel: string): string {
  return `/thumbnail?path=${encodeURIComponent(rel)}`;
}

export function subtitleUrl(rel: string, index: number): string {
  return `/subtitle?path=${encodeURIComponent(rel)}&index=${String(index)}`;
}

function isMediaEntry(value: unknown): value is MediaEntry {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record["rel"] === "string" &&
    typeof record["name"] === "string" &&
    typeof record["folder"] === "string" &&
    typeof record["size"] === "number" &&
    typeof record["direct"] === "boolean"
  );
}

export async function fetchLibrary(signal: AbortSignal): Promise<readonly MediaEntry[]> {
  const response = await fetch("/api/list", { signal });
  if (!response.ok) {
    throw new Error(`Library request failed: HTTP ${String(response.status)}`);
  }
  const payload: unknown = await response.json();
  if (!Array.isArray(payload)) {
    throw new TypeError("Library response was not a list");
  }
  return payload.filter((item: unknown) => isMediaEntry(item));
}

async function responseJson(response: Response, label: string): Promise<unknown> {
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`${label} failed: ${detail || `HTTP ${String(response.status)}`}`);
  }
  return response.json();
}

export async function fetchShowMetadata(signal: AbortSignal): Promise<ShowMetadata> {
  const response = await fetch("/api/metadata", { signal });
  return (await responseJson(response, "Metadata request")) as ShowMetadata;
}

export async function fetchSubtitleTracks(
  rel: string,
  signal: AbortSignal,
): Promise<readonly SubtitleTrack[]> {
  const response = await fetch(`/api/subtitles?path=${encodeURIComponent(rel)}`, { signal });
  return (await responseJson(response, "Subtitle tracks request")) as readonly SubtitleTrack[];
}

export async function searchAniList(
  search: string,
  signal: AbortSignal,
): Promise<readonly AniListMedia[]> {
  const response = await fetch(`/api/anilist/search?q=${encodeURIComponent(search)}`, {
    signal,
  });
  return (await responseJson(response, "AniList search")) as readonly AniListMedia[];
}

export async function linkAniList(key: string, id: number): Promise<AniListMedia> {
  const response = await fetch("/api/anilist/link", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ key, id }),
  });
  return (await responseJson(response, "AniList link")) as AniListMedia;
}

export async function fetchPlaybackProgress(
  signal: AbortSignal,
): Promise<readonly PlaybackProgress[]> {
  const response = await fetch("/api/progress", { signal });
  return (await responseJson(response, "Playback progress request")) as readonly PlaybackProgress[];
}

export interface PlaybackProgressUpdate {
  readonly rel: string;
  readonly position: number;
  readonly duration: number;
  readonly completed: boolean;
}

export async function savePlaybackProgress(
  update: PlaybackProgressUpdate,
): Promise<PlaybackProgress> {
  const response = await fetch("/api/progress", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(update),
  });
  return (await responseJson(response, "Saving playback progress")) as PlaybackProgress;
}

export async function fetchCurrentUser(signal: AbortSignal): Promise<AuthUser | null> {
  const response = await fetch("/api/auth/me", { signal });
  return (await responseJson(response, "Session request")) as AuthUser | null;
}

async function authenticate(
  endpoint: "login" | "setup",
  credentials: { readonly username: string; readonly password: string; readonly setupToken?: string },
): Promise<AuthUser> {
  const response = await fetch(`/api/auth/${endpoint}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(credentials),
  });
  return (await responseJson(response, "Authentication")) as AuthUser;
}

export function login(username: string, password: string): Promise<AuthUser> {
  return authenticate("login", { username, password });
}

export function setupPassword(
  username: string,
  password: string,
  setupToken: string,
): Promise<AuthUser> {
  return authenticate("setup", { username, password, setupToken });
}

export async function logout(): Promise<void> {
  const response = await fetch("/api/auth/logout", { method: "POST" });
  if (!response.ok) {
    throw new Error("Logout failed");
  }
}

export async function fetchUsers(signal: AbortSignal): Promise<readonly ProvisionedUser[]> {
  const response = await fetch("/api/users", { signal });
  return (await responseJson(response, "Users request")) as readonly ProvisionedUser[];
}

export async function provisionUser(username: string, isAdmin: boolean): Promise<string> {
  const response = await fetch("/api/users", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, isAdmin }),
  });
  if (!response.ok) {
    throw new Error((await response.text()) || "Provisioning failed");
  }
  const result = (await response.json()) as { setupToken: string };
  return result.setupToken;
}

export async function addTorrent(
  file: File | null,
  magnet: string,
  showFolder: string,
): Promise<void> {
  const body = new FormData();
  if (file !== null) {
    body.append("torrent", file, file.name);
  }
  if (magnet !== "") {
    body.append("magnet", magnet);
  }
  body.append("showFolder", showFolder);
  const response = await fetch("/api/torrents", { method: "POST", body });
  if (!response.ok) {
    throw new Error((await response.text()) || "Adding torrent failed");
  }
}

export async function fetchTorrents(signal: AbortSignal): Promise<readonly TorrentStatus[]> {
  const response = await fetch("/api/torrents", { signal });
  return (await responseJson(response, "Torrent status request")) as readonly TorrentStatus[];
}

export async function deleteMedia(paths: readonly string[]): Promise<number> {
  const response = await fetch("/api/media/delete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ paths }),
  });
  const result = (await responseJson(response, "Deleting media")) as { deleted: number };
  return result.deleted;
}

export function formatDuration(seconds: number): string {
  const wholeMinutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  if (wholeMinutes < 60) {
    return `${String(wholeMinutes)}:${String(remainingSeconds).padStart(2, "0")}`;
  }
  const hours = Math.floor(wholeMinutes / 60);
  const minutes = wholeMinutes % 60;
  return `${String(hours)}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
}

export function formatSize(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"] as const;
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const unit = units[unitIndex] ?? "B";
  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${unit}`;
}
