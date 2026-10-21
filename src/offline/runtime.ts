import type {
  AuthUser,
  MediaEntry,
  PlaybackProgress,
  ShowMetadata,
} from "../types.ts";
import { ApiError } from "../apiError.ts";
import { IndexedDbOfflineStore, offlineMediaUrl } from "./database.ts";
import type { OfflineDownload, OfflineProfile } from "./types.ts";
import type { PlaybackProgressUpdate } from "../playbackApi.ts";

export {
  cancelTrackedOfflineDownload,
  mergeOfflineDownloads,
  preparingOfflineDownload,
  stopTrackingOfflineController,
  stopTrackingOfflineDownload,
  trackedOfflineDownloads,
  trackOfflineController,
  trackOfflineDownload,
  updateOfflineDownloadList,
} from "./activity.ts";
export { announceOfflineDownload } from "./notifications.ts";

const ACTIVE_USER_KEY = "nanime.offline.active-user";
const PLAYBACK_OUTBOX_PREFIX = "nanime.offline.playback-outbox.";
let store: IndexedDbOfflineStore | null | undefined = undefined;

export function offlineStore(): IndexedDbOfflineStore | null {
  if (store !== undefined) {
    return store;
  }
  store = typeof indexedDB === "undefined" ? null : new IndexedDbOfflineStore();
  return store;
}

function activeUserId(): number | null {
  const value = globalThis.localStorage?.getItem(ACTIVE_USER_KEY) ?? null;
  const id = value === null ? Number.NaN : Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** Whether this browser was signed in last time, so boot can fetch the library before the session check returns. */
export function hasRememberedUser(): boolean {
  return activeUserId() !== null;
}

export function clearOfflineIdentity(): void {
  globalThis.localStorage?.removeItem(ACTIVE_USER_KEY);
  void offlineStore()?.setActiveProfile(null);
}

type ProfileUpdate = Partial<Omit<OfflineProfile, "user" | "updatedAt">>;

/**
 * Library, metadata and progress responses arrive together and each updates
 * its own field of the one profile record. Separate read and write
 * transactions let the last writer put back stale copies of the others'
 * fields (a profile could lose its metadata and progress), so the read and
 * the write share one transaction.
 */
async function updateProfile(
  user: AuthUser,
  update: ProfileUpdate | ((existing: OfflineProfile | null) => ProfileUpdate) = {},
): Promise<void> {
  const database = offlineStore();
  if (database === null) {
    return;
  }
  await database.mergeProfile(user.id, (existing) => ({
    ...existing,
    ...(typeof update === "function" ? update(existing) : update),
    user,
    active: activeUserId() === user.id,
    updatedAt: Date.now(),
  }));
}

export async function rememberOfflineUser(user: AuthUser): Promise<void> {
  globalThis.localStorage?.setItem(ACTIVE_USER_KEY, String(user.id));
  await offlineStore()?.setActiveProfile(user.id);
  await updateProfile(user);
}

export function activeOfflineProfile(): Promise<OfflineProfile | null> {
  const database = offlineStore();
  const userId = activeUserId();
  if (database === null || userId === null) {
    return Promise.resolve(null);
  }
  return database.getProfile(userId).then(async (profile) => {
    if (profile !== null && profile.active !== true) {
      await database.setActiveProfile(userId);
      return { ...profile, active: true };
    }
    return profile;
  });
}

/** Updates the signed-in user's saved profile, if one is being kept, in one transaction. */
async function updateActiveProfile(update: ProfileUpdate): Promise<void> {
  const database = offlineStore();
  const userId = activeUserId();
  if (database === null || userId === null) {
    return;
  }
  await database.mergeProfile(userId, (existing) => (
    existing === null ? null : { ...existing, ...update, active: true, updatedAt: Date.now() }
  ));
}

/**
 * Saving the offline copy is best-effort and stays off the response's path:
 * the page renders without waiting for IndexedDB (writes still land in order).
 */
function rememberInBackground(update: ProfileUpdate): void {
  void (async (): Promise<void> => {
    try {
      await updateActiveProfile(update);
    } catch {
      // The next response saves it again; offline use keeps the previous copy.
    }
  })();
}

export function rememberOfflineLibrary(entries: readonly MediaEntry[]): void {
  rememberInBackground({ library: entries });
}

export function rememberOfflineMetadata(metadata: ShowMetadata): void {
  rememberInBackground({ metadata });
}

export function rememberOfflineProgress(playbackProgress: readonly PlaybackProgress[]): void {
  rememberInBackground({ playbackProgress });
}

export function canUseOfflineFallback(error: unknown): boolean {
  return !navigator.onLine || error instanceof ApiError &&
    (error.status === null || error.status === 0 || error.status >= 500);
}

export async function completedOfflineDownloads(): Promise<readonly OfflineDownload[]> {
  const database = offlineStore();
  const profile = await activeOfflineProfile();
  return database === null || profile === null
    ? []
    : database.listDownloads(profile.user.id, true);
}

function offlineLibraryEntry(download: OfflineDownload): MediaEntry {
  return {
    ...download,
    rel: download.rel,
    name: download.name,
    folder: download.folder,
    size: download.size,
    direct: true,
    offlineUrl: offlineMediaUrl(download.id),
  };
}

export async function offlineLibraryFallback(): Promise<readonly MediaEntry[]> {
  const [profile, downloads] = await Promise.all([
    activeOfflineProfile(),
    completedOfflineDownloads(),
  ]);
  if (profile === null) {
    return [];
  }
  return downloads.map((download) => offlineLibraryEntry(download));
}

export async function offlineMetadataFallback(): Promise<ShowMetadata> {
  const profile = await activeOfflineProfile();
  return profile?.metadata ?? {};
}

export async function offlineProgressFallback(): Promise<readonly PlaybackProgress[]> {
  const profile = await activeOfflineProfile();
  return profile?.playbackProgress ?? [];
}

interface QueuedPlaybackUpdate {
  readonly id: string;
  readonly update: PlaybackProgressUpdate;
}

function outboxKey(userId: number): string {
  return `${PLAYBACK_OUTBOX_PREFIX}${String(userId)}`;
}

function playbackOutbox(userId: number): readonly QueuedPlaybackUpdate[] {
  const value = globalThis.localStorage?.getItem(outboxKey(userId));
  if (value === null || value === undefined) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed as readonly QueuedPlaybackUpdate[] : [];
  } catch {
    return [];
  }
}

function storePlaybackOutbox(userId: number, updates: readonly QueuedPlaybackUpdate[]): void {
  globalThis.localStorage?.setItem(outboxKey(userId), JSON.stringify(updates));
}

function appendPlaybackUpdate(
  current: readonly QueuedPlaybackUpdate[],
  next: QueuedPlaybackUpdate,
): readonly QueuedPlaybackUpdate[] {
  if (next.update.event !== "heartbeat") {
    return [...current, next];
  }
  return [
    ...current.filter((item) => (
      item.update.event !== "heartbeat" || item.update.rel !== next.update.rel ||
      item.update.mediaIdentity !== next.update.mediaIdentity
    )),
    next,
  ];
}

export async function saveOfflinePlayback(
  update: PlaybackProgressUpdate,
): Promise<PlaybackProgress> {
  const profile = await activeOfflineProfile();
  if (profile === null) {
    throw new Error("No offline profile is active");
  }
  const saved: PlaybackProgress = {
    rel: update.rel,
    position: update.position,
    duration: update.duration,
    completed: update.completed,
    updatedAt: Date.now(),
    dismissedAt: null,
  };
  await updateProfile(profile.user, (existing) => ({
    playbackProgress: [
      ...(existing?.playbackProgress ?? []).filter((item) => item.rel !== update.rel),
      saved,
    ],
  }));
  const queued = appendPlaybackUpdate(playbackOutbox(profile.user.id), {
    id: crypto.randomUUID(),
    update,
  });
  storePlaybackOutbox(profile.user.id, queued);
  return saved;
}

export async function flushOfflinePlayback(
  send: (update: PlaybackProgressUpdate) => Promise<PlaybackProgress>,
): Promise<void> {
  const profile = await activeOfflineProfile();
  if (profile === null) {
    return;
  }
  const queued = [...playbackOutbox(profile.user.id)];
  for (const item of queued) {
    // Preserve semantic playback event order when reconnecting.
    // eslint-disable-next-line no-await-in-loop, react-doctor/async-await-in-loop
    await send(item.update);
    const remaining = playbackOutbox(profile.user.id).filter((candidate) => candidate.id !== item.id);
    storePlaybackOutbox(profile.user.id, remaining);
  }
}
