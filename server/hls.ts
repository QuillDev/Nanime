import { audioTracks, type AudioTrack } from "./audioTracks.ts";

export { audioTracksResponse } from "./audioTracks.ts";

const SEGMENT_SECONDS = 6;

interface HlsOptions {
  readonly hardwareAcceleration: string;
  readonly vaapiDevice: string;
}

interface SegmentOptions extends HlsOptions {
  readonly abs: string;
  readonly index: number;
  readonly audioIndex: number | null;
  readonly duration: number;
  readonly request: Request;
}

interface SegmentMonitor {
  readonly exitCode: Promise<number>;
  readonly errorText: Promise<string>;
  readonly options: SegmentOptions;
}

interface SegmentCommand {
  readonly options: SegmentOptions;
  readonly start: number;
  readonly length: number;
  readonly audioTrack: AudioTrack | undefined;
}

export function hlsPlaylist(
  rel: string,
  duration: number,
  audioIndex: number | null,
): Response {
  const count = Math.ceil(duration / SEGMENT_SECONDS);
  const lines = [
    "#EXTM3U",
    "#EXT-X-VERSION:3",
    "#EXT-X-PLAYLIST-TYPE:VOD",
    "#EXT-X-INDEPENDENT-SEGMENTS",
    `#EXT-X-TARGETDURATION:${String(SEGMENT_SECONDS + 1)}`,
    "#EXT-X-MEDIA-SEQUENCE:0",
  ];
  const encoded = encodeURIComponent(rel);
  const audio = audioIndex === null ? "" : `&audio=${String(audioIndex)}`;
  for (let index = 0; index < count; index += 1) {
    const remaining = duration - index * SEGMENT_SECONDS;
    const length = remaining < SEGMENT_SECONDS ? remaining : SEGMENT_SECONDS;
    if (index > 0) {
      // Every segment is produced by a fresh ffmpeg process. Tell HLS clients to
      // reset their decode timeline before appending output from the new encoder.
      lines.push("#EXT-X-DISCONTINUITY");
    }
    lines.push(
      `#EXTINF:${length.toFixed(6)},`,
      `/hls/seg?path=${encoded}&i=${String(index)}${audio}`,
    );
  }
  lines.push("#EXT-X-ENDLIST");
  return new Response(lines.join("\n"), {
    headers: {
      "content-type": "application/vnd.apple.mpegurl",
      "cache-control": "no-store",
    },
  });
}

function segmentInput(command: SegmentCommand): readonly string[] {
  if (command.audioTrack?.codec !== "aac" || command.start === 0) {
    return ["-ss", String(command.start), "-i", command.options.abs];
  }
  const inputStart = Math.max(0, command.start - 2);
  return [
    "-ss", String(inputStart),
    "-i", command.options.abs,
    "-ss", String(command.start - inputStart),
  ];
}

function segmentAudio(command: SegmentCommand): readonly string[] {
  const { audioTrack: track, start } = command;
  if (track === undefined) {
    return [];
  }
  return track.codec === "aac" && start > 0
    ? ["-c:a", "copy"]
    : ["-c:a", "aac", "-ac", "2", "-b:a", "160k"];
}

function segmentArgs(command: SegmentCommand): readonly string[] {
  const { options, start, length, audioTrack } = command;
  const seek = [...segmentInput(command), "-t", String(length)];
  const streams = audioTrack === undefined
    ? ["-map", "0:v:0"]
    : ["-map", "0:v:0", "-map", `0:${String(audioTrack.index)}`];
  const audio = segmentAudio(command);
  const mux = [
    "-output_ts_offset", String(start),
    "-muxdelay", "0",
    "-f", "mpegts", "pipe:1",
  ];

  if (options.hardwareAcceleration === "vaapi") {
    return [
      "-hide_banner", "-loglevel", "error",
      "-hwaccel", "vaapi",
      "-hwaccel_device", options.vaapiDevice,
      "-hwaccel_output_format", "vaapi",
      ...seek,
      ...streams,
      "-vf", "scale_vaapi=format=nv12",
      "-c:v", "h264_vaapi", "-b:v", "6M", "-maxrate", "8M", "-bufsize", "12M",
      ...audio,
      ...mux,
    ];
  }
  return [
    "-hide_banner", "-loglevel", "error",
    ...seek,
    ...streams,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
    ...audio,
    ...mux,
  ];
}

async function reportSegmentFailure(monitor: SegmentMonitor): Promise<void> {
  const [exitCode, errorText] = await Promise.all([
    monitor.exitCode,
    monitor.errorText,
  ]);
  if (exitCode !== 0 && !monitor.options.request.signal.aborted) {
    const detail = errorText.trim() || "ffmpeg produced no error output";
    // eslint-disable-next-line no-console
    console.error(
      `HLS segment failed: path=${monitor.options.abs} index=${String(monitor.options.index)} ` +
      `audio=${String(monitor.options.audioIndex)} exit=${String(exitCode)}\n${detail}`,
    );
  }
}

export async function hlsSegment(options: SegmentOptions): Promise<Response> {
  const start = options.index * SEGMENT_SECONDS;
  if (start >= options.duration && options.duration > 0) {
    return new Response("Not found", { status: 404 });
  }
  const tracks = await audioTracks(options.abs);
  const audioTrack = options.audioIndex === null
    ? tracks.find((track) => track.isDefault) ?? tracks[0]
    : tracks.find((track) => track.index === options.audioIndex);
  if (options.audioIndex !== null && audioTrack === undefined) {
    return new Response("Audio track not found", { status: 404 });
  }
  const remaining = options.duration - start;
  const length = remaining > 0 && remaining < SEGMENT_SECONDS
    ? remaining
    : SEGMENT_SECONDS;
  const proc = Bun.spawn(["ffmpeg", ...segmentArgs({ options, start, length, audioTrack })], {
    stdout: "pipe",
    stderr: "pipe",
  });
  void reportSegmentFailure({
    exitCode: proc.exited,
    errorText: new Response(proc.stderr).text(),
    options,
  });
  options.request.signal.addEventListener("abort", () => {
    proc.kill();
  });
  return new Response(proc.stdout, {
    headers: { "content-type": "video/mp2t", "cache-control": "no-store" },
  });
}
