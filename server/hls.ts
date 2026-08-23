import { audioTracks } from "./audioTracks.ts";

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

function segmentArgs(options: SegmentOptions, start: number, length: number): readonly string[] {
  const seek = ["-ss", String(start), "-i", options.abs, "-t", String(length)];
  const streams = options.audioIndex === null
    ? []
    : ["-map", "0:v:0", "-map", `0:${String(options.audioIndex)}`];
  const audio = ["-c:a", "aac", "-ac", "2", "-b:a", "160k"];
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

export async function hlsSegment(options: SegmentOptions): Promise<Response> {
  const start = options.index * SEGMENT_SECONDS;
  if (start >= options.duration && options.duration > 0) {
    return new Response("Not found", { status: 404 });
  }
  const tracks = options.audioIndex === null ? [] : await audioTracks(options.abs);
  if (
    options.audioIndex !== null &&
    !tracks.some((track) => track.index === options.audioIndex)
  ) {
    return new Response("Audio track not found", { status: 404 });
  }
  const remaining = options.duration - start;
  const length = remaining > 0 && remaining < SEGMENT_SECONDS
    ? remaining
    : SEGMENT_SECONDS;
  const proc = Bun.spawn(["ffmpeg", ...segmentArgs(options, start, length)], {
    stdout: "pipe",
    stderr: "ignore",
  });
  options.request.signal.addEventListener("abort", () => {
    proc.kill();
  });
  return new Response(proc.stdout, {
    headers: { "content-type": "video/mp2t", "cache-control": "no-store" },
  });
}
