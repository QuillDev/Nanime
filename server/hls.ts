import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { audioTracks, type AudioTrack } from "./audioTracks.ts";

export { audioTracksResponse } from "./audioTracks.ts";

const SEGMENT_SECONDS = 6;
const SESSION_IDLE_MS = 10 * 60 * 1000;
const PLAYLIST_WAIT_MS = 20 * 1000;
const cacheRoot = mkdtemp(join(tmpdir(), "nanime-hls-"));

interface HlsOptions {
  readonly hardwareAcceleration: string;
  readonly vaapiDevice: string;
}

export interface HlsPlaylistOptions extends HlsOptions {
  readonly abs: string;
  readonly audioIndex: number | null;
  readonly duration: number;
  readonly requestedStart: number;
  readonly userId: number;
}

interface HlsSession {
  readonly id: string;
  readonly key: string;
  readonly directory: string;
  readonly playlistPath: string;
  readonly process: Bun.Subprocess<"ignore", "ignore", "pipe">;
  readonly userId: number;
  error: string | null;
  lastAccess: number;
}

interface TranscodeCommand extends HlsOptions {
  readonly abs: string;
  readonly audioTrack: AudioTrack | undefined;
  readonly directory: string;
  readonly duration: number;
  readonly segmentIndex: number;
  readonly start: number;
}

const sessionsById = new Map<string, HlsSession>();
const sessionsByKey = new Map<string, HlsSession>();

function sessionKey(options: HlsPlaylistOptions, segmentIndex: number): string {
  return createHash("sha256").update([
    String(options.userId),
    options.abs,
    String(options.audioIndex),
    String(segmentIndex),
    options.hardwareAcceleration,
  ].join("\0")).digest("hex");
}

function videoArgs(command: TranscodeCommand): readonly string[] {
  const keyframes = [
    "-flags", "+cgop",
    "-force_key_frames", `expr:gte(t,n_forced*${String(SEGMENT_SECONDS)})`,
  ];
  if (command.hardwareAcceleration === "vaapi") {
    return [
      "-vf", "scale_vaapi=format=nv12",
      "-c:v", "h264_vaapi",
      "-b:v", "6M", "-maxrate", "8M", "-bufsize", "12M",
      ...keyframes,
    ];
  }
  return [
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
    "-sc_threshold", "0",
    ...keyframes,
  ];
}

function inputHardwareArgs(command: TranscodeCommand): readonly string[] {
  return command.hardwareAcceleration === "vaapi"
    ? [
        "-hwaccel", "vaapi",
        "-hwaccel_device", command.vaapiDevice,
        "-hwaccel_output_format", "vaapi",
      ]
    : [];
}

export function transcodeArgs(command: TranscodeCommand): readonly string[] {
  const remaining = Math.max(0, command.duration - command.start);
  const streams = command.audioTrack === undefined
    ? ["-map", "0:v:0"]
    : ["-map", "0:v:0", "-map", `0:${String(command.audioTrack.index)}`];
  const audio = command.audioTrack === undefined
    ? []
    : ["-c:a", "aac", "-ac", "2", "-b:a", "160k"];
  return [
    "-hide_banner", "-loglevel", "error",
    ...inputHardwareArgs(command),
    "-ss", String(command.start), "-i", command.abs,
    "-t", String(remaining),
    ...streams,
    ...videoArgs(command),
    ...audio,
    "-output_ts_offset", String(command.start),
    "-muxdelay", "0",
    "-f", "hls",
    "-hls_time", String(SEGMENT_SECONDS),
    "-hls_list_size", "0",
    "-start_number", String(command.segmentIndex),
    "-hls_flags", "independent_segments+temp_file",
    "-hls_segment_filename", join(command.directory, "segment-%06d.ts"),
    join(command.directory, "index.m3u8"),
  ];
}

async function selectedAudioTrack(
  abs: string,
  audioIndex: number | null,
): Promise<AudioTrack | undefined | null> {
  const tracks = await audioTracks(abs);
  if (audioIndex === null) {
    return tracks.find((track) => track.isDefault) ?? tracks[0];
  }
  return tracks.find((track) => track.index === audioIndex) ?? null;
}

async function monitorSession(session: HlsSession): Promise<void> {
  const errorText = await new Response(session.process.stderr).text();
  const exitCode = await session.process.exited;
  if (exitCode !== 0) {
    session.error = errorText.trim() || `FFmpeg exited with code ${String(exitCode)}`;
    // eslint-disable-next-line no-console
    console.error(`HLS session failed: id=${session.id} ${session.error}`);
  }
}

async function createSession(
  options: HlsPlaylistOptions,
  segmentIndex: number,
  key: string,
): Promise<HlsSession | null> {
  const audioTrack = await selectedAudioTrack(options.abs, options.audioIndex);
  if (audioTrack === null) {
    return null;
  }
  const root = await cacheRoot;
  const id = randomUUID();
  const directory = join(root, id);
  await mkdir(directory, { mode: 0o700 });
  const process = Bun.spawn([
    "ffmpeg",
    ...transcodeArgs({
      ...options,
      audioTrack,
      directory,
      segmentIndex,
      start: segmentIndex * SEGMENT_SECONDS,
    }),
  ], { stdout: "ignore", stderr: "pipe" });
  const session: HlsSession = {
    id,
    key,
    directory,
    playlistPath: join(directory, "index.m3u8"),
    process,
    userId: options.userId,
    error: null,
    lastAccess: Date.now(),
  };
  sessionsById.set(id, session);
  sessionsByKey.set(key, session);
  void monitorSession(session);
  return session;
}

function activeSession(options: HlsPlaylistOptions): Promise<HlsSession | null> {
  const maximumStart = Math.max(0, options.duration - SEGMENT_SECONDS);
  const safeStart = Math.min(Math.max(0, options.requestedStart), maximumStart);
  const segmentIndex = Math.floor(safeStart / SEGMENT_SECONDS);
  const key = sessionKey(options, segmentIndex);
  const existing = sessionsByKey.get(key);
  if (existing !== undefined && existing.error === null) {
    existing.lastAccess = Date.now();
    return Promise.resolve(existing);
  }
  return createSession(options, segmentIndex, key);
}

async function waitForPlaylist(session: HlsSession): Promise<string | null> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < PLAYLIST_WAIT_MS) {
    const playlist = await readFile(session.playlistPath, "utf8").catch(() => null);
    if (playlist !== null) {
      return playlist;
    }
    if (session.error !== null) {
      return null;
    }
    await Bun.sleep(25);
  }
  return null;
}

export function rewritePlaylist(playlist: string, sessionId: string): string {
  return playlist.split("\n").map((line) => {
    if (line === "" || line.startsWith("#")) {
      return line;
    }
    const name = basename(line);
    return `/hls/seg?session=${encodeURIComponent(sessionId)}&name=${encodeURIComponent(name)}`;
  }).join("\n");
}

export async function hlsPlaylistResponse(options: HlsPlaylistOptions): Promise<Response> {
  const session = await activeSession(options);
  if (session === null) {
    return new Response("Audio track not found", { status: 404 });
  }
  const playlist = await waitForPlaylist(session);
  if (playlist === null) {
    return new Response("Stream could not start", { status: 503 });
  }
  session.lastAccess = Date.now();
  return new Response(rewritePlaylist(playlist, session.id), {
    headers: {
      "content-type": "application/vnd.apple.mpegurl",
      "cache-control": "no-store",
    },
  });
}

function safeSegmentName(value: string | null): value is string {
  return value !== null && /^segment-\d{6}\.ts$/u.test(value);
}

export async function hlsSegmentResponse(
  sessionId: string | null,
  name: string | null,
  userId: number,
): Promise<Response> {
  const session = sessionId === null ? undefined : sessionsById.get(sessionId);
  if (session === undefined || session.userId !== userId || !safeSegmentName(name)) {
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

async function removeSession(session: HlsSession): Promise<void> {
  sessionsById.delete(session.id);
  if (sessionsByKey.get(session.key) === session) {
    sessionsByKey.delete(session.key);
  }
  if (session.process.exitCode === null) {
    session.process.kill();
  }
  await rm(session.directory, { recursive: true, force: true });
}

async function cleanupSessions(): Promise<void> {
  const cutoff = Date.now() - SESSION_IDLE_MS;
  const expired = [...sessionsById.values()].filter((session) => session.lastAccess < cutoff);
  await Promise.all(expired.map((session) => removeSession(session)));
}

setInterval(() => {
  void cleanupSessions();
}, 60 * 1000).unref();
