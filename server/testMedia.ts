/** Generated media and ffprobe readers for tests that run the real encoders. */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

interface ClipOptions {
  readonly seconds: number;
  readonly size?: string;
  /** Language tag of each audio track, in stream order. */
  readonly audio?: readonly string[];
  /** Extra video filter, e.g. noise to make the clip expensive to encode. */
  readonly filter?: string;
}

/** A synthetic test-pattern clip with one sine tone per audio track. */
export async function makeClip(output: string, options: ClipOptions): Promise<string> {
  const audio = options.audio ?? [];
  const inputs = audio.flatMap((_channels, index) => [
    "-f", "lavfi", "-i", `sine=frequency=${String(440 + index * 220)}:duration=${String(options.seconds)}`,
  ]);
  const layouts = audio.flatMap((language, index) => [
    "-map", `${String(index + 1)}:a`, `-metadata:s:a:${String(index)}`, `language=${language}`,
  ]);
  await run([
    "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", [`testsrc2=size=${options.size ?? "320x180"}:rate=24:duration=${String(options.seconds)}`, ...(options.filter === undefined ? [] : [options.filter])].join(","),
    ...inputs,
    "-map", "0:v", ...layouts,
    "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
    ...(audio.length > 0 ? ["-c:a", "aac"] : []),
    output,
  ]);
  return output;
}

export interface ProbedStream {
  readonly codec_type: string;
  readonly codec_name: string;
  readonly width?: number;
  readonly height?: number;
  readonly channels?: number;
  readonly tags?: { readonly language?: string };
}

export async function probeStreams(path: string): Promise<readonly ProbedStream[]> {
  const out = await runText(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type,codec_name,width,height,channels:stream_tags=language", "-of", "json", path]);
  const parsed = JSON.parse(out) as { readonly streams: readonly ProbedStream[] };
  return parsed.streams;
}

export async function withTemporaryDirectory<T>(prefix: string, body: (directory: string) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  try {
    return await body(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
