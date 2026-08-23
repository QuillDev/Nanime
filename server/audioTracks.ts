import { randomUUID } from "node:crypto";
import { chmod, lstat, realpath, rename, unlink } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { detachTorrentsForFiles } from "./torrents.ts";
import { scannedTrackSizes } from "./scanCache.ts";

interface ProbeAudioStream {
  readonly index?: unknown;
  readonly codec_name?: unknown;
  readonly channels?: unknown;
  readonly disposition?: {
    readonly default?: unknown;
  };
  readonly tags?: {
    readonly language?: unknown;
    readonly title?: unknown;
  };
}

interface ProbeResult {
  readonly streams?: readonly ProbeAudioStream[];
}

export interface AudioTrack {
  readonly index: number;
  readonly codec: string;
  readonly language: string;
  readonly label: string;
  readonly channels: number;
  readonly isDefault: boolean;
}

const trackCache = new Map<string, Promise<readonly AudioTrack[]>>();

interface DeleteAudioTrackRequest {
  readonly path?: unknown;
  readonly index?: unknown;
}

interface DeleteAudioTrackOptions {
  readonly mediaDir: string;
  readonly mediaRoot: string;
  readonly videoExtensions: ReadonlySet<string>;
  readonly invalidateSubtitles: (abs: string) => void;
}

function parseProbeResult(text: string): ProbeResult {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null ? value as ProbeResult : {};
  } catch {
    return {};
  }
}

function channelLabel(channels: number): string {
  if (channels === 1) {
    return "Mono";
  }
  if (channels === 2) {
    return "Stereo";
  }
  return channels > 0 ? `${String(channels)} channels` : "Audio";
}

function trackLabel(stream: ProbeAudioStream, language: string, channels: number): string {
  const title = typeof stream.tags?.title === "string" ? stream.tags.title.trim() : "";
  const languageLabel = language === "und" ? "Unknown language" : language.toUpperCase();
  const base = title === "" ? languageLabel : title;
  return `${base} · ${channelLabel(channels)}`;
}

function audioTrack(stream: ProbeAudioStream): AudioTrack | null {
  if (typeof stream.index !== "number" || typeof stream.codec_name !== "string") {
    return null;
  }
  const language = typeof stream.tags?.language === "string"
    ? stream.tags.language.toLowerCase()
    : "und";
  const channels = typeof stream.channels === "number" ? stream.channels : 0;
  return {
    index: stream.index,
    codec: stream.codec_name,
    language,
    label: trackLabel(stream, language, channels),
    channels,
    isDefault: stream.disposition?.default === 1,
  };
}

async function probeAudioTracks(abs: string): Promise<readonly AudioTrack[]> {
  const proc = Bun.spawn([
    "ffprobe", "-v", "error", "-select_streams", "a",
    "-show_entries", "stream=index,codec_name,channels:stream_disposition=default:stream_tags=language,title",
    "-of", "json", abs,
  ], { stdout: "pipe", stderr: "ignore" });
  const [text, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    proc.exited,
  ]);
  return exitCode === 0
    ? (parseProbeResult(text).streams ?? []).flatMap((stream) => {
        const track = audioTrack(stream);
        return track === null ? [] : [track];
      })
    : [];
}

export function audioTracks(abs: string): Promise<readonly AudioTrack[]> {
  const pending = trackCache.get(abs) ?? probeAudioTracks(abs);
  trackCache.set(abs, pending);
  return pending;
}

export async function audioTracksResponse(abs: string, rel: string): Promise<Response> {
  const [tracks, sizes] = await Promise.all([audioTracks(abs), scannedTrackSizes(rel, abs, "audio")]);
  return Response.json(tracks.map((track) => ({
    index: track.index,
    codec: track.codec,
    language: track.language,
    label: track.label,
    channels: track.channels,
    isDefault: track.isDefault,
    sizeBytes: sizes.get(track.index) ?? null,
  })));
}

export function invalidateAudioTracks(abs: string): void {
  trackCache.delete(abs);
}

async function requestedMedia(
  value: unknown,
  options: DeleteAudioTrackOptions,
): Promise<string | null> {
  if (typeof value !== "string" || value === "") {
    return null;
  }
  const candidate = resolve(options.mediaDir, value);
  if (
    candidate === options.mediaDir ||
    !candidate.startsWith(options.mediaDir + sep) ||
    !options.videoExtensions.has(extname(candidate).toLowerCase())
  ) {
    return null;
  }
  const canonical = await realpath(candidate).catch(() => null);
  return canonical !== null && canonical.startsWith(options.mediaRoot + sep)
    ? canonical
    : null;
}

async function remuxWithoutTrack(abs: string, index: number, temporary: string): Promise<boolean> {
  const proc = Bun.spawn([
    "ffmpeg", "-hide_banner", "-loglevel", "error",
    "-i", abs,
    "-map", "0", "-map", `-0:${String(index)}`,
    "-map_metadata", "0", "-map_chapters", "0",
    "-c", "copy", temporary,
  ], { stdout: "ignore", stderr: "pipe" });
  const errorText = new Response(proc.stderr).text();
  const [error, exitCode] = await Promise.all([errorText, proc.exited]);
  return exitCode === 0 && error === "";
}

export async function deleteAudioTrackResponse(
  req: Request,
  options: DeleteAudioTrackOptions,
): Promise<Response> {
  const body = (await req.json().catch(() => null)) as DeleteAudioTrackRequest | null;
  const abs = await requestedMedia(body?.path, options);
  const index = body?.index;
  if (abs === null || typeof index !== "number" || !Number.isInteger(index) || index < 0) {
    return new Response("Choose a valid audio track", { status: 400 });
  }
  const tracks = await audioTracks(abs);
  const selected = tracks.find((track) => track.index === index);
  if (selected === undefined) {
    return new Response("Audio track not found", { status: 404 });
  }
  if (tracks.length < 2) {
    return new Response("The only audio track cannot be deleted", { status: 409 });
  }

  const extension = extname(abs);
  const temporary = `${abs}.nanime-audio-${randomUUID()}${extension}`;
  try {
    if (!(await remuxWithoutTrack(abs, index, temporary))) {
      return new Response("Could not rewrite the video without that audio track", { status: 500 });
    }
    const [original, output] = await Promise.all([lstat(abs), lstat(temporary)]);
    if (!output.isFile() || output.size <= 0) {
      return new Response("The rewritten video was invalid", { status: 500 });
    }
    if (!(await detachTorrentsForFiles([abs]))) {
      return new Response("Could not safely detach the associated qBittorrent task", { status: 502 });
    }
    await chmod(temporary, original.mode);
    await rename(temporary, abs);
    trackCache.delete(abs);
    options.invalidateSubtitles(abs);
    return Response.json({ deleted: true });
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}
