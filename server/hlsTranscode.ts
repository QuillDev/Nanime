import { createHash } from "node:crypto";
import { join } from "node:path";
import { HLS_SEGMENT_SECONDS } from "../shared/playback.ts";
import type { AudioTrack } from "./audioTracks.ts";

export { HLS_SEGMENT_SECONDS } from "../shared/playback.ts";

export interface HlsOptions {
  readonly hardwareAcceleration: string;
  readonly vaapiDevice: string;
}

interface HlsSessionKeyOptions extends HlsOptions {
  readonly abs: string;
  readonly audioIndex: number | null;
  readonly leaseId: string | null;
  readonly userId: number;
}

export function hlsSessionKey(options: HlsSessionKeyOptions, segmentIndex: number): string {
  return createHash("sha256").update([
    String(options.userId), options.abs, String(options.audioIndex), String(segmentIndex),
    options.hardwareAcceleration, options.leaseId === null ? "legacy" : "managed",
  ].join("\0")).digest("hex");
}

interface TranscodeCommand extends HlsOptions {
  readonly abs: string;
  readonly audioTrack: AudioTrack | undefined;
  readonly directory: string;
  readonly duration: number;
  readonly segmentIndex: number;
  readonly start: number;
}

function videoArgs(command: TranscodeCommand): readonly string[] {
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
    "-hls_time", String(HLS_SEGMENT_SECONDS),
    "-hls_list_size", "0",
    "-hls_playlist_type", "event",
    "-start_number", String(command.segmentIndex),
    "-hls_flags", "independent_segments+temp_file",
    "-hls_segment_filename", join(command.directory, "segment-%06d.ts"),
    join(command.directory, "index.m3u8"),
  ];
}
