/** Generated media and ffprobe readers for tests that run the real encoders. */

export async function run(command: readonly string[]): Promise<Uint8Array> {
  const proc = Bun.spawn([...command], { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [code, out, err] = await Promise.all([
    proc.exited, new Response(proc.stdout).bytes(), new Response(proc.stderr).text(),
  ]);
  if (code !== 0) {
    throw new Error(`${command[0] ?? ""} failed: ${err}`);
  }
  return out;
}

export async function runText(command: readonly string[]): Promise<string> {
  return new TextDecoder().decode(await run(command));
}

const H264 = ["-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p"] as const;

interface ClipOptions {
  readonly seconds: number;
  readonly size?: string;
  /** Frame rate as ffmpeg accepts it, e.g. `24000/1001`. */
  readonly rate?: string;
  /** Language tag of each audio track, in stream order. */
  readonly audio?: readonly string[];
  /** Audio encoder and channel count; defaults to mono AAC. */
  readonly audioCodec?: string;
  readonly channels?: number;
  /** Extra video filter, e.g. noise to make the clip expensive to encode. */
  readonly filter?: string;
  /** Video encoder arguments; defaults to fast 8-bit H.264. */
  readonly video?: readonly string[];
}

function audioArgs(options: ClipOptions): readonly string[] {
  if ((options.audio ?? []).length === 0) {
    return [];
  }
  const channels = options.channels === undefined ? [] : ["-ac", String(options.channels)];
  return ["-c:a", options.audioCodec ?? "aac", ...channels];
}

/** A synthetic test-pattern clip with one sine tone per audio track. */
export async function makeClip(output: string, options: ClipOptions): Promise<string> {
  const audio = options.audio ?? [];
  const seconds = String(options.seconds);
  const inputs = audio.flatMap((_language, index) => [
    "-f", "lavfi", "-i", `sine=frequency=${String(440 + index * 220)}:duration=${seconds}`,
  ]);
  const layouts = audio.flatMap((language, index) => [
    "-map", `${String(index + 1)}:a`, `-metadata:s:a:${String(index)}`, `language=${language}`,
  ]);
  const pattern = `testsrc2=size=${options.size ?? "320x180"}:rate=${options.rate ?? "24"}:duration=${seconds}`;
  await run([
    "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", [pattern, ...(options.filter === undefined ? [] : [options.filter])].join(","),
    ...inputs,
    "-map", "0:v", ...layouts,
    ...(options.video ?? H264),
    ...audioArgs(options),
    output,
  ]);
  return output;
}

export interface ProbedStream {
  readonly codec_type: string;
  readonly codec_name: string;
  readonly codec_tag_string?: string;
  readonly width?: number;
  readonly height?: number;
  readonly channels?: number;
  readonly tags?: { readonly language?: string };
}

export async function probeStreams(path: string): Promise<readonly ProbedStream[]> {
  const out = await runText([
    "ffprobe", "-v", "error", "-show_entries",
    "stream=codec_type,codec_name,codec_tag_string,width,height,channels:stream_tags=language", "-of", "json", path,
  ]);
  const parsed = JSON.parse(out) as { readonly streams: readonly ProbedStream[] };
  return parsed.streams;
}

export interface FirstPacket {
  readonly time: number;
  readonly keyframe: boolean;
}

/** Presentation time of the first video packet in decode order, and whether it is a keyframe. */
export async function firstVideoPacket(path: string): Promise<FirstPacket> {
  const out = await runText([
    "ffprobe", "-v", "error", "-select_streams", "v:0", "-read_intervals", "%+#1",
    "-show_entries", "packet=pts_time,flags", "-of", "csv=p=0", path,
  ]);
  const [time = "", flags = ""] = out.trim().split(",");
  return { time: Number(time), keyframe: flags.includes("K") };
}
