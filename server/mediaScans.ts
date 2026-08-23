import { lstat, realpath } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { database } from "./database.ts";
import { audioTracks } from "./audioTracks.ts";
import { sidecarSubtitlePaths, subtitleTracks } from "./subtitles.ts";
import type { TrackKind } from "./scanCache.ts";
import type { MediaLibraryOptions } from "./mediaLibraryOptions.ts";

type ScanStatus = "queued" | "scanning" | "complete" | "failed";

interface ScanRow {
  readonly source_rel: string;
  readonly status: ScanStatus;
  readonly file_size: number;
  readonly modified_at: number;
  readonly duration: number | null;
  readonly format_name: string | null;
  readonly video_codec: string | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly audio_bytes: number;
  readonly subtitle_bytes: number;
  readonly scanned_at: number | null;
  readonly error: string | null;
  readonly created_at: number;
  readonly updated_at: number;
}

interface ProbeStream {
  readonly index?: unknown;
  readonly codec_type?: unknown;
  readonly codec_name?: unknown;
  readonly width?: unknown;
  readonly height?: unknown;
}

interface ProbeOutput {
  readonly streams?: readonly ProbeStream[];
  readonly format?: { readonly duration?: unknown; readonly format_name?: unknown };
}

interface TrackSize {
  readonly index: number;
  readonly kind: TrackKind;
  readonly bytes: number;
}

const scans = database.query<ScanRow, []>("SELECT * FROM media_scans ORDER BY updated_at DESC");
const scanByPath = database.query<ScanRow, [string]>("SELECT * FROM media_scans WHERE source_rel = ?");
const queuedScans = database.query<ScanRow, []>("SELECT * FROM media_scans WHERE status = 'queued' ORDER BY created_at ASC");
const queueScan = database.query<void, [string, number, number, number, number]>(`
  INSERT INTO media_scans (source_rel, status, file_size, modified_at, created_at, updated_at)
  VALUES (?, 'queued', ?, ?, ?, ?)
  ON CONFLICT(source_rel) DO UPDATE SET
    status = 'queued', file_size = excluded.file_size, modified_at = excluded.modified_at,
    duration = NULL, format_name = NULL, video_codec = NULL, width = NULL, height = NULL,
    audio_bytes = 0, subtitle_bytes = 0, scanned_at = NULL, error = NULL,
    updated_at = excluded.updated_at
  WHERE media_scans.status != 'scanning'
`);
const startScan = database.query<void, [number, string]>(`
  UPDATE media_scans SET status = 'scanning', error = NULL, updated_at = ? WHERE source_rel = ?
`);
const failScan = database.query<void, [string, number, string]>(`
  UPDATE media_scans SET status = 'failed', error = ?, updated_at = ? WHERE source_rel = ?
`);
const finishScan = database.query<void, [number | null, string | null, string | null, number | null, number | null, number, number, number, number, string]>(`
  UPDATE media_scans SET status = 'complete', duration = ?, format_name = ?, video_codec = ?,
    width = ?, height = ?, audio_bytes = ?, subtitle_bytes = ?, scanned_at = ?, updated_at = ?, error = NULL
  WHERE source_rel = ?
`);
const deleteTracks = database.query<void, [string]>("DELETE FROM media_scan_tracks WHERE source_rel = ?");
const insertTrack = database.query<void, [string, number, TrackKind, number]>(`
  INSERT INTO media_scan_tracks (source_rel, stream_index, kind, size_bytes) VALUES (?, ?, ?, ?)
`);

database.run("UPDATE media_scans SET status = 'queued' WHERE status = 'scanning'");
let active = false;

function publicScan(row: ScanRow) {
  return {
    sourcePath: row.source_rel,
    status: row.status,
    fileSize: row.file_size,
    duration: row.duration,
    formatName: row.format_name,
    videoCodec: row.video_codec,
    width: row.width,
    height: row.height,
    audioBytes: row.audio_bytes,
    subtitleBytes: row.subtitle_bytes,
    scannedAt: row.scanned_at,
    error: row.error,
    updatedAt: row.updated_at,
  };
}

async function safeSource(path: string, options: MediaLibraryOptions): Promise<{ readonly abs: string; readonly size: number; readonly modifiedAt: number } | null> {
  const candidate = resolve(options.mediaDir, path);
  if (candidate === options.mediaDir || !candidate.startsWith(options.mediaDir + sep)) {
    return null;
  }
  const abs = await realpath(candidate).catch(() => null);
  const stats = abs === null ? null : await lstat(abs).catch(() => null);
  return abs !== null && abs.startsWith(options.mediaRoot + sep) && stats?.isFile() === true &&
    options.videoExtensions.has(extname(abs).toLowerCase())
    ? { abs, size: stats.size, modifiedAt: Math.trunc(stats.mtimeMs) }
    : null;
}

async function probeMetadata(abs: string): Promise<ProbeOutput> {
  const proc = Bun.spawn([
    "ffprobe", "-v", "error", "-show_entries",
    "format=duration,format_name:stream=index,codec_type,codec_name,width,height",
    "-of", "json", abs,
  ], { stdout: "pipe", stderr: "pipe" });
  const [text, error, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) {
    throw new Error(error.trim() || "ffprobe could not inspect the video");
  }
  const parsed: unknown = JSON.parse(text);
  return typeof parsed === "object" && parsed !== null ? parsed as ProbeOutput : {};
}

function addPacketSize(line: string, sizes: Map<number, number>): void {
  const [indexText, sizeText] = line.trim().split(",");
  const index = Number(indexText);
  const size = Number(sizeText);
  if (Number.isInteger(index) && Number.isFinite(size) && size >= 0) {
    sizes.set(index, (sizes.get(index) ?? 0) + size);
  }
}

async function readPacketSizes(stream: ReadableStream<Uint8Array>): Promise<ReadonlyMap<number, number>> {
  const sizes = new Map<number, number>();
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let remaining = "";
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) {
      break;
    }
    const lines = `${remaining}${decoder.decode(chunk.value, { stream: true })}`.split("\n");
    remaining = lines.pop() ?? "";
    for (const line of lines) {
      addPacketSize(line, sizes);
    }
  }
  remaining += decoder.decode();
  if (remaining !== "") {
    addPacketSize(remaining, sizes);
  }
  return sizes;
}

async function embeddedPacketSizes(abs: string): Promise<ReadonlyMap<number, number>> {
  const proc = Bun.spawn([
    "ffprobe", "-v", "error", "-show_packets", "-show_entries",
    "packet=stream_index,size", "-of", "csv=p=0", abs,
  ], { stdout: "pipe", stderr: "pipe" });
  const [sizes, error, code] = await Promise.all([
    readPacketSizes(proc.stdout),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) {
    throw new Error(error.trim() || "ffprobe could not measure media streams");
  }
  return sizes;
}

async function measuredTracks(abs: string): Promise<readonly TrackSize[]> {
  const [packets, audio, subtitles] = await Promise.all([
    embeddedPacketSizes(abs), audioTracks(abs), subtitleTracks(abs),
  ]);
  const measured: TrackSize[] = audio.map((track) => ({
    index: track.index, kind: "audio", bytes: packets.get(track.index) ?? 0,
  }));
  for (const track of subtitles) {
    if (track.index >= 0) {
      measured.push({ index: track.index, kind: "subtitle", bytes: packets.get(track.index) ?? 0 });
    } else {
      const [path] = await sidecarSubtitlePaths(abs, new Set([track.index]));
      const stats = path === undefined ? null : await lstat(path).catch(() => null);
      measured.push({ index: track.index, kind: "subtitle", bytes: stats?.size ?? 0 });
    }
  }
  return measured;
}

function saveScan(row: ScanRow, probe: ProbeOutput, tracks: readonly TrackSize[]): void {
  const video = probe.streams?.find((stream) => stream.codec_type === "video");
  const duration = Number(probe.format?.duration);
  const audioBytes = tracks.filter((track) => track.kind === "audio").reduce((sum, track) => sum + track.bytes, 0);
  const subtitleBytes = tracks.filter((track) => track.kind === "subtitle").reduce((sum, track) => sum + track.bytes, 0);
  const now = Date.now();
  database.transaction(() => {
    deleteTracks.run(row.source_rel);
    for (const track of tracks) {insertTrack.run(row.source_rel, track.index, track.kind, track.bytes);}
    finishScan.run(
      Number.isFinite(duration) ? duration : null,
      typeof probe.format?.format_name === "string" ? probe.format.format_name : null,
      typeof video?.codec_name === "string" ? video.codec_name : null,
      typeof video?.width === "number" ? video.width : null,
      typeof video?.height === "number" ? video.height : null,
      audioBytes, subtitleBytes, now, now, row.source_rel,
    );
  })();
}

async function executeScan(row: ScanRow, options: MediaLibraryOptions): Promise<void> {
  startScan.run(Date.now(), row.source_rel);
  try {
    const source = await safeSource(row.source_rel, options);
    if (source === null) {
      throw new Error("Video no longer exists");
    }
    const [probe, tracks] = await Promise.all([probeMetadata(source.abs), measuredTracks(source.abs)]);
    saveScan(row, probe, tracks);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Media scan failed";
    failScan.run(message.slice(0, 500), Date.now(), row.source_rel);
  }
}

async function runQueue(options: MediaLibraryOptions): Promise<void> {
  if (active) {
    return;
  }
  const [next] = queuedScans.all();
  if (next === undefined) {
    return;
  }
  active = true;
  await executeScan(next, options);
  active = false;
  void runQueue(options);
}

async function queueScans(req: Request, options: MediaLibraryOptions): Promise<Response> {
  const body = (await req.json().catch(() => null)) as { readonly paths?: unknown } | null;
  if (!Array.isArray(body?.paths) || body.paths.length === 0 || body.paths.length > 500 ||
    !body.paths.every((path) => typeof path === "string")) {
    return new Response("Choose up to 500 videos to scan", { status: 400 });
  }
  const unique = [...new Set(body.paths as string[])];
  const sources = await Promise.all(unique.map(async (path) => ({ path, source: await safeSource(path, options) })));
  if (sources.some(({ source }) => source === null)) {
    return new Response("One or more videos no longer exist", { status: 404 });
  }
  const now = Date.now();
  for (const { path, source } of sources) {
    if (source !== null) {queueScan.run(path, source.size, source.modifiedAt, now, now);}
  }
  void runQueue(options);
  return Response.json(unique.map((path) => publicScan(scanByPath.get(path) as ScanRow)), { status: 201 });
}

export function mediaScanResponse(req: Request, options: MediaLibraryOptions): Response | Promise<Response> {
  void runQueue(options);
  return req.method === "GET"
    ? Response.json(scans.all().map((row) => publicScan(row)))
    : queueScans(req, options);
}
