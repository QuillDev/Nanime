import { randomUUID } from "node:crypto";
import { chmod, link, open, readdir, realpath, unlink } from "node:fs/promises";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import { invalidateMediaScan, scannedTrackSizes } from "./scanCache.ts";
import { probeStreams } from "./ffprobe.ts";
import { jsonObject, type JsonObject } from "./json.ts";
import { fileSystemErrorCode } from "./fileSystemError.ts";

export { audioTracksResponse, hlsPlaylistResponse, hlsSegmentResponse } from "./hls.ts";
export { probeDuration } from "./mediaInfo.ts";

export interface SubtitleTrack {
  readonly index: number;
  readonly codec: string;
  readonly language: string;
  readonly label: string;
}

const TEXT_SUBTITLE_CODECS = new Set([
  "ass",
  "ssa",
  "subrip",
  "webvtt",
  "mov_text",
  "text",
]);
const trackCache = new Map<string, Promise<readonly SubtitleTrack[]>>();
const subtitleCache = new Map<string, Promise<string | null>>();
const SIDECAR_EXTENSIONS = new Map(Object.entries({
  ".ass": "ass",
  ".srt": "subrip",
} as const));
const MAX_SUBTITLE_BYTES = 5 * 1024 * 1024;
const MAX_OFFSET_SECONDS = 3600;

interface SidecarSubtitleTrack extends SubtitleTrack {
  readonly path: string;
}

export async function sidecarSubtitlePaths(
  abs: string,
  indexes: ReadonlySet<number>,
): Promise<readonly string[]> {
  const tracks = await sidecarSubtitleTracks(abs);
  return tracks.flatMap((track) => indexes.has(track.index) ? [track.path] : []);
}

function subtitleTrack(stream: JsonObject): SubtitleTrack | null {
  const { index, codec_name: codec } = stream;
  if (typeof index !== "number" || typeof codec !== "string") {
    return null;
  }
  if (!TEXT_SUBTITLE_CODECS.has(codec)) {
    return null;
  }
  const tags = jsonObject(stream["tags"]);
  const language = typeof tags?.["language"] === "string" ? tags["language"] : "und";
  const label = typeof tags?.["title"] === "string"
    ? tags["title"]
    : `${language.toUpperCase()} subtitles`;
  return { index, codec, language, label };
}

async function probeSubtitleTracks(abs: string): Promise<readonly SubtitleTrack[]> {
  const streams = await probeStreams({
    input: abs,
    selectStreams: "s",
    showEntries: "stream=index,codec_name:stream_tags=language,title",
  });
  return streams.flatMap((stream) => {
    const track = subtitleTrack(stream);
    return track === null ? [] : [track];
  });
}

function sidecarLanguage(suffix: string): string {
  const candidate = suffix.split(/[._ -]/u).at(-1) ?? "";
  return /^[a-z]{2,3}(?:-[a-z0-9]{2,8})?$/iu.test(candidate)
    ? candidate.toLowerCase()
    : "und";
}

function sidecarLabel(suffix: string, language: string): string {
  if (suffix === "") {
    return "External subtitles";
  }
  const readable = suffix.replaceAll(/[._-]+/gu, " ").trim();
  return language === "und" ? readable : `${language.toUpperCase()} subtitles`;
}

async function sidecarSubtitleTracks(abs: string): Promise<readonly SidecarSubtitleTrack[]> {
  const directory = dirname(abs);
  const extension = extname(abs);
  const stem = basename(abs, extension);
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const candidates: { readonly name: string; readonly extension: string }[] = [];
  for (const entry of entries) {
    const sidecarExtension = extname(entry.name).toLowerCase();
    if (
      entry.isFile() && SIDECAR_EXTENSIONS.has(sidecarExtension) &&
      (entry.name === `${stem}${sidecarExtension}` || entry.name.startsWith(`${stem}.`))
    ) {
      candidates.push({ name: entry.name, extension: sidecarExtension });
    }
  }
  candidates.sort((left, right) => left.name.localeCompare(right.name));
  const tracks: SidecarSubtitleTrack[] = [];
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    if (candidate !== undefined) {
      const suffix = candidate.name.slice(stem.length, -candidate.extension.length).replace(/^\./u, "");
      const language = sidecarLanguage(suffix);
      tracks.push({
        index: -(index + 1),
        codec: SIDECAR_EXTENSIONS.get(candidate.extension) ?? "text",
        language,
        label: sidecarLabel(suffix, language),
        path: join(directory, candidate.name),
      });
    }
  }
  return tracks;
}

export async function subtitleTracks(abs: string): Promise<readonly SubtitleTrack[]> {
  const pending = trackCache.get(abs) ?? probeSubtitleTracks(abs);
  trackCache.set(abs, pending);
  const [embedded, sidecars] = await Promise.all([pending, sidecarSubtitleTracks(abs)]);
  return [
    ...embedded,
    ...sidecars.map((track) => ({
      index: track.index,
      codec: track.codec,
      language: track.language,
      label: track.label,
    })),
  ];
}

export async function subtitleTracksResponse(abs: string, rel: string): Promise<Response> {
  const [tracks, sizes] = await Promise.all([subtitleTracks(abs), scannedTrackSizes(rel, abs, "subtitle")]);
  return Response.json(tracks.map((track) => ({
    index: track.index,
    codec: track.codec,
    language: track.language,
    label: track.label,
    sizeBytes: sizes.get(track.index) ?? null,
  })));
}

export function invalidateSubtitleTracks(abs: string): void {
  trackCache.delete(abs);
  for (const key of subtitleCache.keys()) {
    if (key.startsWith(`${abs}:`)) {
      subtitleCache.delete(key);
    }
  }
}

async function convertSubtitle(abs: string, index: number): Promise<string | null> {
  const proc = Bun.spawn([
    "ffmpeg", "-hide_banner", "-loglevel", "error", "-i", abs,
    "-map", `0:${String(index)}`, "-f", "webvtt", "pipe:1",
  ], { stdout: "pipe", stderr: "ignore" });
  const text = await new Response(proc.stdout).text();
  return await proc.exited === 0 && text.startsWith("WEBVTT") ? text : null;
}

async function convertSidecar(abs: string): Promise<string | null> {
  const proc = Bun.spawn([
    "ffmpeg", "-hide_banner", "-loglevel", "error", "-i", abs,
    "-f", "webvtt", "pipe:1",
  ], { stdout: "pipe", stderr: "ignore" });
  const text = await new Response(proc.stdout).text();
  return await proc.exited === 0 && text.startsWith("WEBVTT") ? text : null;
}

function timestampSeconds(value: string): number {
  const parts = value.split(":").map(Number);
  const seconds = parts.pop() ?? 0;
  const minutes = parts.pop() ?? 0;
  const hours = parts.pop() ?? 0;
  return hours * 3600 + minutes * 60 + seconds;
}

function webVttTimestamp(seconds: number): string {
  const milliseconds = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor(milliseconds % 3_600_000 / 60_000);
  const remainder = milliseconds % 60_000 / 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${remainder.toFixed(3).padStart(6, "0")}`;
}

function shiftCueBlock(block: string, offset: number): string | null {
  const lines = block.split("\n");
  const timingIndex = lines.findIndex((line) => line.includes(" --> "));
  if (timingIndex === -1) {
    return block;
  }
  const timing = /^(?<start>(?:\d{2}:)?\d{2}:\d{2}\.\d{3}) --> (?<end>(?:\d{2}:)?\d{2}:\d{2}\.\d{3})(?<settings>.*)$/u.exec(lines[timingIndex] ?? "");
  if (timing?.groups === undefined) {
    return block;
  }
  const end = timestampSeconds(timing.groups["end"] ?? "0:00.000");
  if (end <= offset) {
    return null;
  }
  const start = timestampSeconds(timing.groups["start"] ?? "0:00.000");
  lines[timingIndex] = `${webVttTimestamp(start - offset)} --> ${webVttTimestamp(end - offset)}${timing.groups["settings"] ?? ""}`;
  return lines.join("\n");
}

export function shiftWebVtt(text: string, offset: number): string {
  if (offset <= 0) {
    return text;
  }
  return text.split("\n\n")
    .flatMap((block) => {
      const shifted = shiftCueBlock(block, offset);
      return shifted === null ? [] : [shifted];
    })
    .join("\n\n");
}

export async function subtitleResponse(abs: string, index: number, offset: number): Promise<Response> {
  const sidecars = await sidecarSubtitleTracks(abs);
  const sidecar = sidecars.find((track) => track.index === index);
  const tracks = sidecar === undefined ? await subtitleTracks(abs) : [];
  if (sidecar === undefined && !tracks.some((track) => track.index === index)) {
    return new Response("Subtitle track not found", { status: 404 });
  }
  const safeOffset = Number.isFinite(offset) && offset >= 0 ? offset : 0;
  const key = `${abs}:${String(index)}:${String(safeOffset)}`;
  const pending = subtitleCache.get(key) ?? (async (): Promise<string | null> => {
    const text = await (
      sidecar === undefined ? convertSubtitle(abs, index) : convertSidecar(sidecar.path)
    );
    return text === null ? null : shiftWebVtt(text, safeOffset);
  })();
  subtitleCache.set(key, pending);
  const text = await pending;
  if (text === null) {
    subtitleCache.delete(key);
    return new Response("Subtitle conversion failed", { status: 500 });
  }
  return new Response(text, {
    headers: {
      "content-type": "text/vtt; charset=utf-8",
      "cache-control": "private, max-age=604800",
    },
  });
}

function safeSubtitleName(value: string): boolean {
  return value !== "" && value !== "." && value !== ".." &&
    !value.includes("/") && !value.includes("\\") && !value.includes("\0") &&
    value.length <= 255;
}

function destinationName(video: string, subtitle: string): string {
  const videoStem = basename(video, extname(video));
  const subtitleExtension = extname(subtitle).toLowerCase();
  const subtitleStem = basename(subtitle, extname(subtitle));
  if (subtitleStem.toLowerCase() === videoStem.toLowerCase()) {
    return `${videoStem}${subtitleExtension}`;
  }
  return subtitleStem.toLowerCase().startsWith(`${videoStem.toLowerCase()}.`)
    ? `${subtitleStem}${subtitleExtension}`
    : `${videoStem}.${subtitleStem}${subtitleExtension}`;
}

async function writeTemporarySubtitle(path: string, subtitle: File): Promise<boolean> {
  const file = await open(path, "wx", 0o600).catch(() => null);
  if (file === null) {
    return false;
  }
  try {
    await file.writeFile(new Uint8Array(await subtitle.arrayBuffer()));
  } finally {
    await file.close();
  }
  return true;
}

interface SubtitleSynchronization {
  readonly source: string;
  readonly destination: string;
  readonly extension: string;
  readonly offsetSeconds: number;
}

async function synchronizeSubtitle(
  synchronization: SubtitleSynchronization,
): Promise<boolean> {
  const { source, destination, extension, offsetSeconds } = synchronization;
  const codec = extension === ".ass" ? "ass" : "srt";
  const proc = Bun.spawn([
    "ffmpeg", "-hide_banner", "-loglevel", "error",
    "-itsoffset", String(offsetSeconds), "-i", source,
    "-map", "0:0", "-c:s", codec, destination,
  ], { stdout: "ignore", stderr: "ignore" });
  if (await proc.exited !== 0) {
    return false;
  }
  await chmod(destination, 0o600).catch(() => undefined);
  return true;
}

function clearSubtitleCache(abs: string): void {
  for (const key of subtitleCache.keys()) {
    if (key.startsWith(`${abs}:`)) {
      subtitleCache.delete(key);
    }
  }
}

export async function subtitleUploadResponse(
  req: Request,
  mediaRoot: string,
  videoExtensions: ReadonlySet<string>,
): Promise<Response> {
  const form = await req.formData().catch(() => null);
  const rel = form?.get("path");
  const subtitle = form?.get("subtitle");
  const offsetValue = form?.get("offsetSeconds");
  const offsetSeconds = typeof offsetValue === "string" ? Number(offsetValue) : Number.NaN;
  const extension = subtitle instanceof File ? extname(subtitle.name).toLowerCase() : "";
  if (
    typeof rel !== "string" || rel === "" ||
    !(subtitle instanceof File) || !safeSubtitleName(subtitle.name) ||
    subtitle.size <= 0 || subtitle.size > MAX_SUBTITLE_BYTES ||
    !Number.isFinite(offsetSeconds) || Math.abs(offsetSeconds) > MAX_OFFSET_SECONDS ||
    !SIDECAR_EXTENSIONS.has(extension)
  ) {
    return new Response("Choose a valid SRT or ASS subtitle file", { status: 400 });
  }
  const candidate = resolve(mediaRoot, rel);
  const media = candidate !== mediaRoot && candidate.startsWith(mediaRoot + sep)
    ? await realpath(candidate).catch(() => null)
    : null;
  if (
    media === null || !media.startsWith(mediaRoot + sep) ||
    !videoExtensions.has(extname(media).toLowerCase())
  ) {
    return new Response("Episode not found", { status: 404 });
  }
  const destination = join(dirname(media), destinationName(media, subtitle.name));
  const temporary = join(dirname(media), `.nanime-subtitle-${randomUUID()}${extension}`);
  const synchronized = join(dirname(media), `.nanime-subtitle-${randomUUID()}${extension}`);
  if (!(await writeTemporarySubtitle(temporary, subtitle))) {
    return new Response("Could not prepare subtitle upload", { status: 500 });
  }
  try {
    if (await convertSidecar(temporary) === null) {
      return new Response("Subtitle file could not be read", { status: 400 });
    }
    if (
      offsetSeconds !== 0 &&
      !(await synchronizeSubtitle({
        source: temporary,
        destination: synchronized,
        extension,
        offsetSeconds,
      }))
    ) {
      return new Response("Subtitle timing could not be adjusted", { status: 400 });
    }
    await link(offsetSeconds === 0 ? temporary : synchronized, destination);
  } catch (error) {
    const code = fileSystemErrorCode(error);
    return new Response(
      code === "EEXIST" ? "That subtitle already exists" : "Could not save subtitle",
      { status: code === "EEXIST" ? 409 : 500 },
    );
  } finally {
    await unlink(temporary).catch(() => undefined);
    await unlink(synchronized).catch(() => undefined);
  }
  clearSubtitleCache(media);
  invalidateMediaScan(rel);
  return Response.json({ uploaded: true });
}
