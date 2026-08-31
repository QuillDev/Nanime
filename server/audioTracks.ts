import { randomUUID } from "node:crypto";
import { chmod, lstat, realpath, rename, unlink } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { detachTorrentsForFiles } from "./torrents.ts";
import { scannedTrackSizes } from "./scanCache.ts";
import { probeStreams } from "./ffprobe.ts";
import { jsonObject, type JsonObject } from "./json.ts";
import { audioLanguageMatches } from "../shared/audioLanguage.ts";

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

function channelLabel(channels: number): string {
  if (channels === 1) {
    return "Mono";
  }
  if (channels === 2) {
    return "Stereo";
  }
  return channels > 0 ? `${String(channels)} channels` : "Audio";
}

function trackLabel(stream: JsonObject, language: string, channels: number): string {
  const titleValue = jsonObject(stream["tags"])?.["title"];
  const title = typeof titleValue === "string" ? titleValue.trim() : "";
  const languageLabel = language === "und" ? "Unknown language" : language.toUpperCase();
  const base = title === "" ? languageLabel : title;
  return `${base} · ${channelLabel(channels)}`;
}

function audioTrack(stream: JsonObject): AudioTrack | null {
  const { index, codec_name: codec } = stream;
  if (typeof index !== "number" || typeof codec !== "string") {
    return null;
  }
  const languageValue = jsonObject(stream["tags"])?.["language"];
  const language = typeof languageValue === "string"
    ? languageValue.toLowerCase()
    : "und";
  const channelsValue = stream["channels"];
  const channels = typeof channelsValue === "number" ? channelsValue : 0;
  return {
    index,
    codec,
    language,
    label: trackLabel(stream, language, channels),
    channels,
    isDefault: jsonObject(stream["disposition"])?.["default"] === 1,
  };
}

async function probeAudioTracks(abs: string): Promise<readonly AudioTrack[]> {
  const streams = await probeStreams({
    input: abs,
    selectStreams: "a",
    showEntries: "stream=index,codec_name,channels:stream_disposition=default:stream_tags=language,title",
  });
  return streams.flatMap((stream) => {
    const track = audioTrack(stream);
    return track === null ? [] : [track];
  });
}

export function audioTracks(abs: string): Promise<readonly AudioTrack[]> {
  const pending = trackCache.get(abs) ?? probeAudioTracks(abs);
  trackCache.set(abs, pending);
  return pending;
}

export function chooseAudioTrack(
  tracks: readonly AudioTrack[],
  audioIndex: number | null,
  preferredLanguage: string | null = null,
): AudioTrack | undefined | null {
  if (audioIndex !== null) {
    return tracks.find((track) => track.index === audioIndex) ?? null;
  }
  const preferred = preferredLanguage === null
    ? undefined
    : tracks.find((track) => audioLanguageMatches(track.language, preferredLanguage));
  return preferred ?? tracks.find((track) => track.isDefault) ?? tracks[0];
}

export async function selectedAudioTrack(
  abs: string,
  audioIndex: number | null,
  preferredLanguage: string | null = null,
): Promise<AudioTrack | undefined | null> {
  const tracks = await audioTracks(abs);
  return chooseAudioTrack(tracks, audioIndex, preferredLanguage);
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
