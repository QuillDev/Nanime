import { createHash } from "node:crypto";
import { join } from "node:path";
import { HLS_SEGMENT_SECONDS } from "../shared/playback.ts";
import { audioTracks, selectedAudioTrack, type AudioTrack } from "./audioTracks.ts";

export { HLS_SEGMENT_SECONDS } from "../shared/playback.ts";
export { HLS_SESSION_IDLE_MS } from "../shared/playback.ts";

export interface HlsOptions {
  readonly hardwareAcceleration: string;
  readonly vaapiDevice: string;
}

/**
 * Where a live HLS session reads video from. `copy` streams a stored transcode
 * whose keyframes sit on every segment boundary; `encode` re-encodes the video.
 */
export interface HlsStreamSource {
  readonly input: string;
  readonly videoMode: "copy" | "encode";
  /** Output-relative audio map for a stored transcode; absent maps the source index. */
  readonly audioMap?: string;
}

export interface HlsSourceOptions extends HlsOptions {
  readonly abs: string;
  readonly audioIndex: number | null;
  readonly preferredAudioLanguage: string | null;
  readonly source: HlsStreamSource;
}

/**
 * Stored keyframes land on the first frame at or after each boundary, so a
 * copy session seeks a quarter segment past the boundary and lets the demuxer
 * snap back to that keyframe. Audio follows the same demuxer position.
 */
const COPY_SEEK_LEAD_SECONDS = HLS_SEGMENT_SECONDS / 4;

/**
 * Hls.js treats an event playlist as live and only learns about new segments on
 * its next reload (one target duration later). Handing out a one-segment
 * playlist therefore stalls startup after the first segment, so the first
 * response waits until several segments exist or the encode has finished.
 */
const STARTUP_PLAYLIST_SEGMENTS = 3;

export function playlistReadyToServe(playlist: string): boolean {
  const segments = playlist.split("\n").filter((line) => line !== "" && !line.startsWith("#")).length;
  return segments >= STARTUP_PLAYLIST_SEGMENTS || playlist.includes("#EXT-X-ENDLIST");
}

interface HlsSessionKeyOptions extends HlsOptions {
  readonly abs: string;
  readonly source?: HlsStreamSource;
  readonly audioIndex: number | null;
  readonly leaseId: string | null;
  readonly preferredAudioLanguage: string | null;
  readonly userId: number;
}

export function hlsSessionKey(options: HlsSessionKeyOptions, segmentIndex: number): string {
  return createHash("sha256").update([
    String(options.userId), options.abs, String(options.audioIndex),
    String(options.preferredAudioLanguage), String(segmentIndex),
    options.hardwareAcceleration, options.leaseId === null ? "legacy" : "managed",
    options.source?.input ?? options.abs, options.source?.videoMode ?? "encode",
  ].join("\0")).digest("hex");
}

interface TranscodeCommand extends HlsOptions {
  readonly abs: string;
  readonly audioTrack: AudioTrack | undefined;
  readonly directory: string;
  readonly duration: number;
  readonly segmentIndex: number;
  readonly start: number;
  readonly source?: HlsStreamSource;
}

function videoArgs(command: TranscodeCommand): readonly string[] {
  if (command.source?.videoMode === "copy") {
    return ["-c:v", "copy"];
  }
  const keyframes = [
    "-flags", "+cgop",
    "-force_key_frames", `expr:gte(t,n_forced*${String(HLS_SEGMENT_SECONDS)})`,
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

function audioMap(command: TranscodeCommand): readonly string[] {
  if (command.audioTrack === undefined) {
    return [];
  }
  return ["-map", command.source?.audioMap ?? `0:${String(command.audioTrack.index)}`];
}

function inputArgs(command: TranscodeCommand): readonly string[] {
  const input = command.source?.input ?? command.abs;
  return command.source?.videoMode === "copy"
    ? ["-noaccurate_seek", "-ss", String(command.start + COPY_SEEK_LEAD_SECONDS), "-i", input]
    : ["-ss", String(command.start), "-i", input];
}

function outputOffset(command: TranscodeCommand): number {
  return command.source?.videoMode === "copy" ? command.start + COPY_SEEK_LEAD_SECONDS : command.start;
}

export function transcodeArgs(command: TranscodeCommand): readonly string[] {
  const remaining = Math.max(0, command.duration - command.start);
  const streams = ["-map", "0:v:0", ...audioMap(command)];
  const audio = command.audioTrack === undefined
    ? []
    : ["-c:a", "aac", "-ac", "2", "-b:a", "160k"];
  return [
    "-hide_banner", "-loglevel", "error",
    ...inputHardwareArgs(command),
    ...inputArgs(command),
    "-t", String(remaining),
    ...streams,
    ...videoArgs(command),
    ...audio,
    "-output_ts_offset", String(outputOffset(command)),
    "-muxdelay", "0",
    "-f", "hls",
    "-hls_time", String(HLS_SEGMENT_SECONDS),
    "-hls_list_size", "0",
    "-hls_playlist_type", "event",
    "-start_number", String(command.segmentIndex),
    "-hls_flags", "independent_segments+temp_file",
    "-hls_segment_filename", join(command.directory, "segment-%06d.ts"),
    join(command.directory, "index.m3u8"),
  ];
}

/**
 * A stored transcode keeps every source audio stream in source order, so the
 * selected source track maps to the same position among the output's audio.
 */
async function storedAudioSource(
  abs: string,
  source: HlsStreamSource,
  audioTrack: AudioTrack | undefined,
): Promise<HlsStreamSource> {
  if (audioTrack === undefined || source.input === abs) {
    return source;
  }
  const tracks = await audioTracks(abs);
  const position = tracks.findIndex((track) => track.index === audioTrack.index);
  if (position === -1) {
    throw new Error("Selected audio track is missing from the stored transcode");
  }
  return { ...source, audioMap: `0:a:${String(position)}` };
}

/** The selected source audio track (null: requested track missing) and where to read streams. */
export async function sessionStreams(options: HlsSourceOptions): Promise<{
  readonly audioTrack: AudioTrack | undefined | null;
  readonly source: HlsStreamSource;
}> {
  const audioTrack = await selectedAudioTrack(options.abs, options.audioIndex, options.preferredAudioLanguage);
  const source = audioTrack === null
    ? options.source
    : await storedAudioSource(options.abs, options.source, audioTrack);
  return { audioTrack, source };
}
