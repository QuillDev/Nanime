import { treaty } from "@elysiajs/eden";
import type { App } from "../server/app.ts";
import { apiError } from "./apiError.ts";
import type {
  AniListMedia,
  AniListAccountStatus,
  AniListAuthConfig,
  AniListListEntry,
  AniListWatchStatus,
  AuthUser,
  MediaEntry,
  MediaScan,
  NyaaSearchResult,
  PlaybackProgress,
  ShowMetadata,
  SubtitleTrack,
  ProvisionedUser,
  StorageStatus,
  TranscodeJob,
  TranscodePreset,
  TorrentStatus,
} from "./types.ts";

// TVmaze air dates are contractually strings. Eden otherwise revives date-like
// JSON strings into Date objects even when the Elysia response schema says string.
export const api = treaty<App>(globalThis.location.origin, { parseDate: false });

export function streamUrl(rel: string): string {
  return `/stream?path=${encodeURIComponent(rel)}`;
}

export function hlsUrl(rel: string, audioTrack: number | null = null): string {
  const audio = audioTrack === null ? "" : `&audio=${String(audioTrack)}`;
  return `/hls/index?path=${encodeURIComponent(rel)}${audio}`;
}

export function thumbnailUrl(rel: string): string {
  return `/thumbnail?path=${encodeURIComponent(rel)}`;
}

export function subtitleUrl(rel: string, index: number): string {
  return `/subtitle?path=${encodeURIComponent(rel)}&index=${String(index)}`;
}

export function unwrap<T>(
  result: { readonly data: T; readonly error: null } | {
    readonly data: null;
    readonly error: Parameters<typeof apiError>[0];
  },
  label: string,
): T {
  if (result.error !== null) {
    throw apiError(result.error, label);
  }
  return result.data;
}

export async function fetchLibrary(signal: AbortSignal): Promise<readonly MediaEntry[]> {
  return unwrap(await api.api.list.get({ fetch: { signal } }), "Library request");
}

export async function fetchShowMetadata(signal: AbortSignal): Promise<ShowMetadata> {
  return unwrap(await api.api.metadata.get({ fetch: { signal } }), "Metadata request");
}

export async function fetchSubtitleTracks(
  rel: string,
  signal: AbortSignal,
): Promise<readonly SubtitleTrack[]> {
  return unwrap(
    await api.api.subtitles.get({ query: { path: rel }, fetch: { signal } }),
    "Subtitle tracks request",
  );
}

export async function searchAniList(
  search: string,
  signal: AbortSignal,
): Promise<readonly AniListMedia[]> {
  return unwrap(
    await api.api.anilist.search.get({ query: { q: search }, fetch: { signal } }),
    "AniList search",
  );
}

export async function linkAniList(key: string, id: number): Promise<AniListMedia> {
  return unwrap(await api.api.anilist.link.post({ key, id }), "AniList link");
}

export async function fetchPlaybackProgress(
  signal: AbortSignal,
): Promise<readonly PlaybackProgress[]> {
  return unwrap(
    await api.api.progress.get({ fetch: { signal } }),
    "Playback progress request",
  );
}

export interface PlaybackProgressUpdate {
  readonly rel: string;
  readonly position: number;
  readonly duration: number;
  readonly completed: boolean;
  readonly anilistMediaId?: number;
  readonly episode?: number;
  readonly totalEpisodes?: number | null;
}

export async function savePlaybackProgress(
  update: PlaybackProgressUpdate,
): Promise<PlaybackProgress> {
  return unwrap(await api.api.progress.put(update), "Saving playback progress");
}

export async function dismissPlaybackProgress(rel: string): Promise<PlaybackProgress> {
  return unwrap(
    await api.api.progress.dismiss.post({ rel }),
    "Dismissing Continue Watching item",
  );
}

export async function fetchCurrentUser(signal: AbortSignal): Promise<AuthUser | null> {
  return unwrap(await api.api.auth.me.get({ fetch: { signal } }), "Session request");
}

export async function fetchAniListAuthConfig(signal: AbortSignal): Promise<AniListAuthConfig> {
  return unwrap(
    await api.api.auth.anilist.config.get({ fetch: { signal } }),
    "AniList login configuration",
  );
}

export async function fetchAniListAccount(signal: AbortSignal): Promise<AniListAccountStatus> {
  return unwrap(
    await api.api.anilist.account.get({ fetch: { signal } }),
    "AniList account request",
  );
}

export async function disconnectAniList(): Promise<void> {
  unwrap(await api.api.anilist.account.delete(), "Disconnecting AniList");
}

export async function fetchAniListListEntry(
  mediaId: number,
  signal: AbortSignal,
): Promise<AniListListEntry | null> {
  return unwrap(
    await api.api.anilist.list({ id: String(mediaId) }).get({ fetch: { signal } }),
    "AniList list entry request",
  );
}

export interface AniListListUpdate {
  readonly status: AniListWatchStatus;
  readonly progress: number;
  readonly score: number;
}

export async function updateAniListListEntry(
  mediaId: number,
  update: AniListListUpdate,
): Promise<AniListListEntry | null> {
  return unwrap(
    await api.api.anilist.list({ id: String(mediaId) }).put(update),
    "Updating AniList list entry",
  );
}

async function authenticate(
  endpoint: "login" | "setup",
  credentials: { readonly username: string; readonly password: string; readonly setupToken?: string },
): Promise<AuthUser> {
  const result = endpoint === "login"
    ? await api.api.auth.login.post(credentials)
    : await api.api.auth.setup.post({
        username: credentials.username,
        password: credentials.password,
        setupToken: credentials.setupToken ?? "",
      });
  return unwrap(result, "Authentication");
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
  unwrap(await api.api.auth.logout.post(), "Logout");
}

export async function fetchUsers(signal: AbortSignal): Promise<readonly ProvisionedUser[]> {
  return unwrap(await api.api.users.get({ fetch: { signal } }), "Users request");
}

export async function provisionUser(username: string, isAdmin: boolean): Promise<string> {
  return unwrap(await api.api.users.post({ username, isAdmin }), "Provisioning").setupToken;
}

export async function cancelUserProvision(userId: number): Promise<void> {
  unwrap(
    await api.api.users({ id: String(userId) }).delete(),
    "Cancelling user provision",
  );
}

export async function addTorrent(
  file: File | null,
  magnet: string,
  showFolder: string,
): Promise<void> {
  const body = {
    ...(file === null ? {} : { torrent: file }),
    ...(magnet === "" ? {} : { magnet }),
    showFolder,
  };
  unwrap(await api.api.torrents.post(body), "Adding torrent");
}

export async function fetchTorrents(signal: AbortSignal): Promise<readonly TorrentStatus[]> {
  return unwrap(
    await api.api.torrents.get({ fetch: { signal } }),
    "Torrent status request",
  );
}

export async function fetchStorageStatus(signal: AbortSignal): Promise<StorageStatus> {
  return unwrap(
    await api.api.storage.get({ fetch: { signal } }),
    "Storage status request",
  );
}
export async function fetchMediaScans(signal: AbortSignal): Promise<readonly MediaScan[]> {
  return unwrap(await api.api.media.scans.get({ fetch: { signal } }), "Media scans request") as readonly MediaScan[];
}

export async function startMediaScans(paths: readonly string[]): Promise<readonly MediaScan[]> {
  return unwrap(
    await api.api.media.scans.post({ paths: [...paths] }),
    "Starting media scans",
  ) as readonly MediaScan[];
}
export async function fetchTranscodes(signal: AbortSignal): Promise<readonly TranscodeJob[]> {
  return unwrap(await api.api.transcodes.get({ fetch: { signal } }), "Transcode jobs request") as readonly TranscodeJob[];
}
export async function startTranscodes(
  paths: readonly string[],
  preset: TranscodePreset,
): Promise<readonly TranscodeJob[]> {
  return unwrap(
    await api.api.transcodes.bulk.post({ paths: [...paths], preset }),
    "Starting transcodes",
  ) as readonly TranscodeJob[];
}

export async function deleteTranscode(id: string): Promise<void> { unwrap(await api.api.transcodes({ id }).delete(), "Deleting optimized copy"); }

export async function deleteTranscodeOriginal(id: string): Promise<TranscodeJob> {
  return unwrap(await api.api.transcodes({ id }).original.delete(), "Deleting original") as TranscodeJob;
}
export async function cancelTranscode(id: string): Promise<TranscodeJob> { return unwrap(await api.api.transcodes({ id }).cancel.post(), "Cancelling transcode") as TranscodeJob; }
export async function searchNyaa(
  options: { readonly search: string; readonly category: string; readonly trusted: boolean },
  signal: AbortSignal,
): Promise<readonly NyaaSearchResult[]> {
  return unwrap(
    await api.api.torrents.search.get({
      query: { q: options.search, category: options.category, trusted: options.trusted },
      fetch: { signal },
    }),
    "Nyaa search",
  );
}

export async function deleteMedia(paths: readonly string[]): Promise<number> {
  return unwrap(
    await api.api.media.delete.post({ paths: [...paths] }),
    "Deleting media",
  ).deleted;
}

export { formatDuration, formatSize } from "./format.ts";
