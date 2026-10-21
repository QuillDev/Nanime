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

async function updateProfile(
  user: AuthUser,
  update: Partial<Omit<OfflineProfile, "user" | "updatedAt">> = {},
): Promise<void> {
  const database = offlineStore();
  if (database === null) {
    return;
  }
  const existing = await database.getProfile(user.id);
  await database.putProfile({
    ...existing,
    ...update,
    user,
    active: activeUserId() === user.id,
    updatedAt: Date.now(),
  });
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

export async function rememberOfflineLibrary(
  entries: readonly MediaEntry[],
): Promise<void> {
  const profile = await activeOfflineProfile();
  if (profile !== null) {
    await updateProfile(profile.user, { library: entries });
  }
}

export async function rememberOfflineMetadata(metadata: ShowMetadata): Promise<void> {
  const profile = await activeOfflineProfile();
  if (profile !== null) {
    await updateProfile(profile.user, { metadata });
  }
}

export async function rememberOfflineProgress(
  playbackProgress: readonly PlaybackProgress[],
): Promise<void> {
  const profile = await activeOfflineProfile();
  if (profile !== null) {
    await updateProfile(profile.user, { playbackProgress });
  }
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
  const playbackProgress = [
    ...(profile.playbackProgress ?? []).filter((item) => item.rel !== update.rel),
    saved,
  ];
  await updateProfile(profile.user, { playbackProgress });
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
