import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { selectedAudioTrack } from "./audioTracks.ts";
import { SingleFlight } from "./singleFlight.ts";
import {
  HlsStoppingCapacity,
  hlsCapacityAvailable,
  reserveHlsPlaybackCapacity,
} from "./hlsCapacity.ts";
import { HLS_SEGMENT_SECONDS, hlsSessionKey, transcodeArgs, type HlsOptions } from "./hlsTranscode.ts";
import { stopHlsProcess } from "./hlsProcess.ts";
import { hlsOwnershipKey, supersedeHlsLease } from "./hlsLeaseOwnership.ts";

export { audioTracksResponse } from "./audioTracks.ts";
export { transcodeArgs } from "./hlsTranscode.ts";

const SESSION_IDLE_MS = 60 * 1000;
const PROCESS_STOP_GRACE_MS = 2 * 1000;
const MAX_ACTIVE_SESSIONS = 4;
const MAX_ACTIVE_SESSIONS_PER_USER = 2;
const PLAYLIST_WAIT_MS = 20 * 1000;
const cacheRoot = mkdtemp(join(tmpdir(), "nanime-hls-"));

export interface HlsPlaylistOptions extends HlsOptions {
  readonly abs: string;
  readonly audioIndex: number | null;
  readonly duration: number;
  readonly requestedStart: number;
  readonly userId: number;
  readonly leaseId: string | null;
  readonly playerId: string | null;
}

interface HlsSession {
  readonly id: string;
  readonly key: string;
  readonly directory: string;
  readonly playlistPath: string;
  readonly process: Bun.Subprocess<"ignore", "ignore", "pipe">;
  readonly userId: number;
  readonly leases: Set<string>;
  readonly legacyAccess: boolean;
  error: string | null;
  lastAccess: number;
  pendingClaims: number;
  removal: Promise<void> | null;
  stopping: boolean;
}

interface HlsLease {
  readonly id: string;
  readonly playerId: string;
  readonly sessionId: string;
  readonly userId: number;
  lastAccess: number;
}

interface HlsSessionPlan {
  readonly segmentIndex: number;
  readonly start: number;
}

const sessionsById = new Map<string, HlsSession>();
const sessionsByKey = new Map<string, HlsSession>();
const leasesById = new Map<string, HlsLease>();
const activeLeaseByPlayer = new Map<string, string>();
const releasedLeases = new Map<string, number>();
const pendingSessions = new SingleFlight<string, HlsSession | null | undefined>();
let pendingSessionCount = 0;
const pendingSessionsByUser = new Map<number, number>();
const stoppingSessions = new HlsStoppingCapacity();

export function hlsSessionPlan(duration: number, requestedStart: number): HlsSessionPlan {
  const safeDuration = Number.isFinite(duration) ? Math.max(0, duration) : 0;
  const maximumStart = Math.max(0, safeDuration - HLS_SEGMENT_SECONDS);
  const requested = Number.isFinite(requestedStart) ? requestedStart : 0;
  const safeStart = Math.min(Math.max(0, requested), maximumStart);
  const segmentIndex = Math.floor(safeStart / HLS_SEGMENT_SECONDS);
  return { segmentIndex, start: segmentIndex * HLS_SEGMENT_SECONDS };
}

async function monitorSession(session: HlsSession): Promise<void> {
  const errorText = await new Response(session.process.stderr).text();
  const exitCode = await session.process.exited;
  if (exitCode !== 0 && !session.stopping) {
    session.error = errorText.trim() || `FFmpeg exited with code ${String(exitCode)}`;
    // eslint-disable-next-line no-console
    console.error(`HLS session failed: id=${session.id} ${session.error}`);
  }
}

async function spawnHlsProcess(command: string[], directory: string) {
  try {
    return Bun.spawn(command, { stdout: "ignore", stderr: "pipe" });
  } catch (error: unknown) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

async function createSession(
  options: HlsPlaylistOptions,
  segmentIndex: number,
  key: string,
): Promise<HlsSession | undefined> {
  const audioTrack = await selectedAudioTrack(options.abs, options.audioIndex);
  if (audioTrack === null) {
    return undefined;
  }
  const root = await cacheRoot;
  const id = randomUUID();
  const directory = join(root, id);
  await mkdir(directory, { mode: 0o700 });
  const process = await spawnHlsProcess([
      "ffmpeg",
      ...transcodeArgs({
        ...options,
        audioTrack,
        directory,
        segmentIndex,
        start: segmentIndex * HLS_SEGMENT_SECONDS,
      }),
    ], directory);
  const session: HlsSession = {
    id,
    key,
    directory,
    playlistPath: join(directory, "index.m3u8"),
    process,
    userId: options.userId,
    leases: new Set(),
    legacyAccess: options.leaseId === null,
    error: null,
    lastAccess: Date.now(),
    pendingClaims: 0,
    removal: null,
    stopping: false,
  };
  void monitorSession(session);
  return session;
}

function activeProcessCount(userId?: number): number {
  const active = [...sessionsById.values()].filter((session) => (
    session.process.exitCode === null && (userId === undefined || session.userId === userId)
  )).length;
  return active + stoppingSessions.count(userId);
}

function reserveSession(userId: number): boolean {
  const userPending = pendingSessionsByUser.get(userId) ?? 0;
  if (!hlsCapacityAvailable({
    activeGlobal: activeProcessCount(),
    activeUser: activeProcessCount(userId),
    maxGlobal: MAX_ACTIVE_SESSIONS,
    maxUser: MAX_ACTIVE_SESSIONS_PER_USER,
    pendingGlobal: pendingSessionCount,
    pendingUser: userPending,
  })) {
    return false;
  }
  pendingSessionCount += 1;
  pendingSessionsByUser.set(userId, userPending + 1);
  return true;
}

function releaseReservation(userId: number): void {
  pendingSessionCount = Math.max(0, pendingSessionCount - 1);
  const remaining = Math.max(0, (pendingSessionsByUser.get(userId) ?? 1) - 1);
  if (remaining === 0) {
    pendingSessionsByUser.delete(userId);
  } else {
    pendingSessionsByUser.set(userId, remaining);
  }
}

function reservePlaybackSession(options: HlsPlaylistOptions): Promise<boolean> {
  return reserveHlsPlaybackCapacity({
    managed: options.leaseId !== null,
    reclaim: removeSession,
    sessions: () => [...sessionsById.values()].filter((session) => (
      session.process.exitCode === null
    )),
    tryReserve: () => reserveSession(options.userId),
    userId: options.userId,
    waitForStopping: () => stoppingSessions.waitForChange(),
  });
}

function registerSession(session: HlsSession): HlsSession {
  sessionsById.set(session.id, session);
  sessionsByKey.set(session.key, session);
  return session;
}

async function createReservedSession(
  options: HlsPlaylistOptions,
  segmentIndex: number,
  key: string,
): Promise<HlsSession | null | undefined> {
  if (!await reservePlaybackSession(options)) {
    return null;
  }
  try {
    const session = await createSession(options, segmentIndex, key);
    return session === undefined ? undefined : registerSession(session);
  } finally {
    releaseReservation(options.userId);
  }
}

function activeSession(options: HlsPlaylistOptions): Promise<HlsSession | null | undefined> {
  const { segmentIndex } = hlsSessionPlan(options.duration, options.requestedStart);
  const key = hlsSessionKey(options, segmentIndex);
  const existing = sessionsByKey.get(key);
  if (existing !== undefined && existing.error === null) {
    existing.lastAccess = Date.now();
    return Promise.resolve(existing);
  }
  return pendingSessions.run(key, () => createReservedSession(options, segmentIndex, key));
}

async function waitForPlaylist(session: HlsSession): Promise<string | null> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < PLAYLIST_WAIT_MS) {
    const playlist = await readFile(session.playlistPath, "utf8").catch(() => null);
    if (playlist !== null) {
      return playlist;
    }
    if (session.error !== null || session.stopping) {
      return null;
    }
    await Bun.sleep(25);
  }
  return null;
}

export function rewritePlaylist(
  playlist: string,
  sessionId: string,
  leaseId: string | null = null,
): string {
  return playlist.split("\n").map((line) => {
    if (line === "" || line.startsWith("#")) {
      return line;
    }
    const name = basename(line);
    const lease = leaseId === null ? "" : `&lease=${encodeURIComponent(leaseId)}`;
    return `/hls/seg?session=${encodeURIComponent(sessionId)}${lease}&name=${encodeURIComponent(name)}`;
  }).join("\n");
}

function prepareLease(options: HlsPlaylistOptions): Promise<boolean> {
  const { leaseId, playerId, userId } = options;
  if (leaseId === null || playerId === null) {
    return Promise.resolve(leaseId === null && playerId === null);
  }
  const key = hlsOwnershipKey(userId, leaseId);
  if (releasedLeases.has(key)) {
    return Promise.resolve(false);
  }
  const owner = hlsOwnershipKey(userId, playerId);
  return supersedeHlsLease({
    owners: activeLeaseByPlayer,
    owner,
    leaseId,
    release: async (previous) => {
      await releaseHlsPlayback(userId, playerId, previous);
    },
  });
}

function bindLease(session: HlsSession, options: HlsPlaylistOptions): boolean {
  const { leaseId, playerId, userId } = options;
  if (leaseId === null || playerId === null) {
    session.lastAccess = Date.now();
    return session.legacyAccess;
  }
  const key = hlsOwnershipKey(userId, leaseId);
  const owner = hlsOwnershipKey(userId, playerId);
  if (releasedLeases.has(key) || activeLeaseByPlayer.get(owner) !== leaseId) {
    return false;
  }
  const lease: HlsLease = {
    id: leaseId,
    playerId,
    sessionId: session.id,
    userId,
    lastAccess: Date.now(),
  };
  leasesById.set(key, lease);
  session.leases.add(key);
  session.lastAccess = lease.lastAccess;
  return true;
}

function abandonUnboundLease(options: HlsPlaylistOptions): void {
  const { leaseId, playerId, userId } = options;
  if (leaseId === null || playerId === null) {
    return;
  }
  const owner = hlsOwnershipKey(userId, playerId);
  if (activeLeaseByPlayer.get(owner) === leaseId) {
    activeLeaseByPlayer.delete(owner);
  }
}

export async function hlsPlaylistResponse(options: HlsPlaylistOptions): Promise<Response> {
  if (!await prepareLease(options)) {
    return new Response("Playback lease has ended", { status: 410 });
  }
  let session: HlsSession | null | undefined = null;
  try {
    session = await activeSession(options);
  } catch {
    abandonUnboundLease(options);
    return new Response("Stream could not start", { status: 503 });
  }
  if (session === undefined) {
    abandonUnboundLease(options);
    return new Response("Audio track not found", { status: 404 });
  }
  if (session === null) {
    abandonUnboundLease(options);
    return new Response("No HLS encoder is currently available", {
      status: 429,
      headers: { "retry-after": "2" },
    });
  }
  session.pendingClaims += 1;
  const bound = bindLease(session, options);
  let ready = false;
  try {
    if (!bound) {
      return new Response("Playback lease has ended", { status: 410 });
    }
    const playlist = await waitForPlaylist(session);
    if (playlist === null) {
      return new Response("Stream could not start", { status: 503 });
    }
    ready = true;
    session.lastAccess = Date.now();
    return new Response(rewritePlaylist(playlist, session.id, options.leaseId), {
      headers: {
        "content-type": "application/vnd.apple.mpegurl",
        "cache-control": "no-store",
        "x-nanime-hls-session": session.id,
      },
    });
  } finally {
    if (bound && !ready && options.leaseId !== null && options.playerId !== null) {
      await releaseHlsPlayback(options.userId, options.playerId, options.leaseId);
    }
    session.pendingClaims = Math.max(0, session.pendingClaims - 1);
    if (!ready && session.pendingClaims === 0 && session.leases.size === 0) {
      abandonUnboundLease(options);
      await removeSession(session);
    }
  }
}

export function safeSegmentName(value: string | null): value is string {
  return value !== null && /^segment-\d{6}\.ts$/u.test(value);
}

export async function hlsSegmentResponse(options: {
  readonly leaseId: string | null;
  readonly name: string | null;
  readonly sessionId: string | null;
  readonly userId: number;
}): Promise<Response> {
  const { leaseId, name, sessionId, userId } = options;
  const session = sessionId === null ? undefined : sessionsById.get(sessionId);
  if (
    session === undefined || session.userId !== userId || !safeSegmentName(name) ||
    !touchSessionLease(session, leaseId, userId)
  ) {
    return new Response("Not found", { status: 404 });
  }
  session.lastAccess = Date.now();
  const file = Bun.file(join(session.directory, name));
  if (!(await file.exists())) {
    return new Response(session.error === null ? "Segment not ready" : "Stream failed", {
      status: session.error === null ? 425 : 503,
    });
  }
  return new Response(file, {
    headers: {
      "content-type": "video/mp2t",
      "cache-control": "private, max-age=3600, immutable",
    },
  });
}

function touchSessionLease(session: HlsSession, leaseId: string | null, userId: number): boolean {
  if (leaseId === null) {
    return session.legacyAccess;
  }
  const lease = leasesById.get(hlsOwnershipKey(userId, leaseId));
  if (lease === undefined || lease.sessionId !== session.id) {
    return false;
  }
  lease.lastAccess = Date.now();
  session.lastAccess = lease.lastAccess;
  return true;
}

async function performRemoveSession(session: HlsSession): Promise<void> {
  const countedAsStopping = session.process.exitCode === null;
  session.stopping = true;
  const finishStopping = countedAsStopping ? stoppingSessions.begin(session.userId) : undefined;
  sessionsById.delete(session.id);
  if (sessionsByKey.get(session.key) === session) {
    sessionsByKey.delete(session.key);
  }
  for (const key of session.leases) {
    const lease = leasesById.get(key);
    if (lease !== undefined && lease.sessionId === session.id) {
      leasesById.delete(key);
      const owner = hlsOwnershipKey(lease.userId, lease.playerId);
      if (activeLeaseByPlayer.get(owner) === lease.id) {
        activeLeaseByPlayer.delete(owner);
      }
    }
  }
  session.leases.clear();
  try {
    await stopHlsProcess(session.process, PROCESS_STOP_GRACE_MS);
    await rm(session.directory, { recursive: true, force: true });
  } finally {
    finishStopping?.();
  }
}

function removeSession(session: HlsSession): Promise<void> {
  if (session.removal !== null) {
    return session.removal;
  }
  session.removal = performRemoveSession(session);
  return session.removal;
}

export async function releaseHlsPlayback(
  userId: number,
  playerId: string,
  leaseId: string,
): Promise<boolean> {
  const key = hlsOwnershipKey(userId, leaseId);
  const owner = hlsOwnershipKey(userId, playerId);
  const lease = leasesById.get(key);
  const claimedOwner = [...activeLeaseByPlayer].find((entry) => entry[1] === leaseId)?.[0];
  if (
    lease !== undefined && (lease.userId !== userId || lease.playerId !== playerId) ||
    lease === undefined && claimedOwner !== undefined && claimedOwner !== owner
  ) {
    return false;
  }
  releasedLeases.set(key, Date.now());
  if (activeLeaseByPlayer.get(owner) === leaseId) {
    activeLeaseByPlayer.delete(owner);
  }
  if (lease === undefined) {
    return false;
  }
  leasesById.delete(key);
  const session = sessionsById.get(lease.sessionId);
  session?.leases.delete(key);
  if (session !== undefined && session.leases.size === 0 && session.pendingClaims === 0 &&
    !session.legacyAccess) {
    await removeSession(session);
  }
  return true;
}

async function cleanupSessions(): Promise<void> {
  const now = Date.now();
  const cutoff = now - SESSION_IDLE_MS;
  const expiredLeases = [...leasesById.values()].filter((lease) => lease.lastAccess <= cutoff);
  await Promise.all(expiredLeases.map((lease) => (
    releaseHlsPlayback(lease.userId, lease.playerId, lease.id)
  )));
  const expired = [...sessionsById.values()].filter((session) => (
    session.leases.size === 0 && session.lastAccess <= cutoff
  ));
  await Promise.all(expired.map((session) => removeSession(session)));
  for (const [key, releasedAt] of releasedLeases) {
    if (releasedAt <= cutoff) {
      releasedLeases.delete(key);
    }
  }
}

setInterval(() => {
  void cleanupSessions();
}, 60 * 1000).unref();
