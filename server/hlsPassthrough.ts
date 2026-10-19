import { lstat, mkdir, readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AudioTrack } from "./audioTracks.ts";
import { PASSTHROUGH_TIMESTAMP_OFFSET, passthroughRunArgs } from "./hlsTranscode.ts";
import { stopHlsProcess, type HlsProducer } from "./hlsProcess.ts";
import { readStoredKeyframes, storeKeyframes } from "./keyframeStore.ts";
import { captureProbe } from "./transcodeProgress.ts";

/**
 * HEVC passthrough as on-demand VOD. The playlist lists one segment per source
 * keyframe up front, so players see the whole episode and seek locally. ffmpeg
 * "runs" repackage segments on request: a run started at a keyframe cuts a new
 * segment at every keyframe and keeps absolute fragment times, so segments from
 * different runs share one init segment and line up on the same timeline.
 */

/** Segments a running run is expected to reach soon; further requests start a new run. */
const RUN_LOOKAHEAD_SEGMENTS = 40;
/** Live runs per session: a seek can overlap an in-flight load elsewhere in the episode. */
const MAX_LIVE_RUNS = 2;
/** Under hls.js's 10 s time-to-first-byte limit, so a slow segment retries instead of failing. */
const SEGMENT_WAIT_MS = 8000;
const POLL_MS = 40;
const RUN_STOP_GRACE_MS = 2000;

interface PassthroughRun {
  readonly directory: string;
  readonly requested: number;
  readonly process: Bun.Subprocess<"ignore", "ignore", "pipe">;
  readonly stderr: Promise<string>;
  /** Keyframe index of the run's first segment; demuxers may land before the requested keyframe. */
  base: number | null;
  stopped: boolean;
}

export interface PassthroughOptions {
  readonly input: string;
  readonly audioTrack: AudioTrack | undefined;
  readonly directory: string;
  readonly duration: number;
}

const keyframeCache = new Map<string, { readonly signature: string; readonly keyframes: Promise<readonly number[]> }>();

async function probeKeyframes(abs: string): Promise<readonly number[]> {
  const proc = Bun.spawn([
    "ffprobe", "-v", "error", "-select_streams", "v:0",
    "-show_entries", "packet=pts_time,flags", "-of", "csv=p=0", abs,
  ], { stdin: "ignore", stdout: "pipe", stderr: "ignore" });
  const { code, text } = await captureProbe(proc, new Response(proc.stdout).text());
  if (code !== 0) {
    throw new Error("Could not read the video's keyframes");
  }
  const keyframeLines = text.split("\n").filter((line) => line.split(",")[1]?.includes("K") === true);
  const times = keyframeLines.map((line) => Number(line.split(",")[0])).filter((time) => Number.isFinite(time));
  return times.toSorted((left, right) => left - right);
}

async function storedOrProbedKeyframes(abs: string, signature: string): Promise<readonly number[]> {
  const stored = await readStoredKeyframes(abs, signature);
  if (stored !== null) {
    return stored;
  }
  const keyframes = await probeKeyframes(abs);
  await storeKeyframes(abs, { signature, keyframes }).catch(() => undefined);
  return keyframes;
}

/** Source keyframe times, probed once per file version (several seconds for a cold episode). */
export async function sourceKeyframes(abs: string): Promise<readonly number[]> {
  const stat = await lstat(abs);
  const signature = `${String(stat.size)}:${String(stat.mtimeMs)}`;
  const cached = keyframeCache.get(abs);
  if (cached?.signature === signature) {
    return cached.keyframes;
  }
  const keyframes = (async () => {
    try {
      return await storedOrProbedKeyframes(abs, signature);
    } catch (error: unknown) {
      keyframeCache.delete(abs);
      throw error;
    }
  })();
  keyframeCache.set(abs, { signature, keyframes });
  return keyframes;
}

export function segmentName(index: number): string {
  return `segment-${String(index).padStart(6, "0")}.m4s`;
}

function segmentDurations(keyframes: readonly number[], duration: number): readonly number[] {
  return keyframes.map((time, index) => {
    const end = keyframes[index + 1] ?? Math.max(duration, time);
    return Math.max(end - time, 0.001);
  });
}

/** A complete VOD playlist: one segment per source keyframe. */
export function passthroughPlaylist(keyframes: readonly number[], duration: number): string {
  const durations = segmentDurations(keyframes, duration);
  const target = Math.ceil(Math.max(1, ...durations));
  const segments = durations.flatMap((length, index) => [`#EXTINF:${length.toFixed(6)},`, segmentName(index)]);
  return [
    "#EXTM3U", "#EXT-X-VERSION:7", `#EXT-X-TARGETDURATION:${String(target)}`, "#EXT-X-MEDIA-SEQUENCE:0",
    "#EXT-X-PLAYLIST-TYPE:VOD", "#EXT-X-INDEPENDENT-SEGMENTS", "#EXT-X-MAP:URI=\"init.mp4\"",
    ...segments, "#EXT-X-ENDLIST", "",
  ].join("\n");
}

async function producedCount(run: PassthroughRun): Promise<number> {
  const names = await readdir(run.directory).catch(() => []);
  return names.filter((name) => name.endsWith(".m4s")).length;
}

function segmentIndex(name: string): number | null {
  const match = /^segment-(?<index>\d{6})\.m4s$/u.exec(name)?.groups?.["index"];
  return match === undefined ? null : Number(match);
}

async function exists(path: string): Promise<boolean> {
  const stat = await lstat(path).catch(() => null);
  return stat?.isFile() === true;
}

/**
 * Timestamp of a run's first keyframe: the first video packet in decode order.
 * (The stream's start time can be earlier: open-GOP leading pictures display
 * before the keyframe that starts their segment.)
 */
async function firstSegmentStart(directory: string): Promise<number | null> {
  const input = `concat:${join(directory, "init.mp4")}|${join(directory, segmentName(0))}`;
  const proc = Bun.spawn([
    "ffprobe", "-v", "error", "-select_streams", "v:0", "-read_intervals", "%+#1",
    "-show_entries", "packet=pts_time", "-of", "csv=p=0", input,
  ], { stdin: "ignore", stdout: "pipe", stderr: "ignore" });
  const { code, text } = await captureProbe(proc, new Response(proc.stdout).text());
  const start = Number(text.trim().split("\n")[0]?.replace(/,$/u, "") ?? Number.NaN);
  return code === 0 && Number.isFinite(start) ? start : null;
}

/**
 * The keyframe nearest `time`. Matroska and MP4 can disagree on a keyframe's
 * presentation time by its composition offset (a frame or few), far less than
 * the gap between keyframes.
 */
export function keyframeIndexAt(keyframes: readonly number[], time: number): number {
  let nearest = 0;
  for (const [index, keyframe] of keyframes.entries()) {
    if (Math.abs(keyframe - time) < Math.abs((keyframes[nearest] ?? 0) - time)) {
      nearest = index;
    }
  }
  return nearest;
}

export class PassthroughProducer implements HlsProducer {
  exitCode: number | null = null;
  readonly exited: Promise<number>;
  readonly stderr: ReadableStream<Uint8Array>;
  readonly start: number;
  private readonly options: PassthroughOptions;
  private readonly keyframes: readonly number[];
  private readonly runs: PassthroughRun[] = [];
  /** Serializes run choices so concurrent requests don't start competing runs. */
  private choosing: Promise<void> = Promise.resolve();
  private finish: ((code: number, message: string) => void) | null = null;

  constructor(options: PassthroughOptions, keyframes: readonly number[]) {
    this.options = options;
    this.keyframes = keyframes;
    this.start = keyframes[0] ?? 0;
    const exit = Promise.withResolvers<number>();
    this.exited = exit.promise;
    this.stderr = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.finish = (code, message) => {
          this.finish = null;
          this.exitCode = code;
          if (message !== "") {
            controller.enqueue(new TextEncoder().encode(message));
          }
          controller.close();
          exit.resolve(code);
        };
      },
    });
  }

  kill(): void {
    if (this.exitCode !== null) {
      return;
    }
    void this.stopAll();
  }

  private async stopAll(): Promise<void> {
    await Promise.all(this.runs.map((run) => this.stopRun(run)));
    this.finish?.(0, "");
  }

  /** Path of a finished segment (or the init segment), repackaging it first when needed. */
  async segmentPath(name: string): Promise<string | null> {
    if (this.exitCode !== null) {
      return null;
    }
    if (name === "init.mp4") {
      return this.initPath();
    }
    const index = segmentIndex(name);
    if (index === null || index >= this.keyframes.length) {
      return null;
    }
    const ready = await this.producedPath(index);
    if (ready !== null) {
      return ready;
    }
    const run = await this.chooseRun(index);
    return this.waitForSegment(run, index);
  }

  private async chooseRun(index: number): Promise<PassthroughRun> {
    const previous = this.choosing;
    const turn = Promise.withResolvers<undefined>();
    this.choosing = turn.promise;
    await previous;
    try {
      return (await this.coveringRun(index)) ?? (await this.startRun(index));
    } finally {
      turn.resolve(undefined);
    }
  }

  /** Every run writes the same init segment; it is complete once the run's first segment exists. */
  private async initPath(): Promise<string | null> {
    const deadline = Date.now() + SEGMENT_WAIT_MS;
    if (this.runs.length === 0) {
      await this.chooseRun(0);
    }
    while (Date.now() < deadline && this.exitCode === null) {
      for (const run of this.runs) {
        if (await exists(join(run.directory, segmentName(0)))) {
          return join(run.directory, "init.mp4");
        }
      }
      await Bun.sleep(POLL_MS);
    }
    return null;
  }

  private async producedPath(index: number): Promise<string | null> {
    for (const run of this.runs) {
      if (run.base !== null && index >= run.base) {
        const path = join(run.directory, segmentName(index - run.base));
        if (await exists(path)) {
          return path;
        }
      }
    }
    return null;
  }

  /** A live run that has passed, or will soon reach, the requested segment. */
  private async coveringRun(index: number): Promise<PassthroughRun | null> {
    for (const run of this.runs.toReversed()) {
      if (!run.stopped && run.process.exitCode === null && run.requested <= index) {
        const reached = (run.base ?? run.requested) + await producedCount(run);
        if (index < reached + RUN_LOOKAHEAD_SEGMENTS) {
          return run;
        }
      }
    }
    return null;
  }

  private async startRun(index: number): Promise<PassthroughRun> {
    const live = this.runs.filter((candidate) => !candidate.stopped && candidate.process.exitCode === null);
    for (const run of live.slice(0, Math.max(0, live.length - MAX_LIVE_RUNS + 1))) {
      void this.stopRun(run);
    }
    const directory = join(this.options.directory, `run-${String(this.runs.length)}`);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const time = this.keyframes[index] ?? 0;
    const next = this.keyframes[index + 1] ?? time + 1;
    const seek = time + Math.min(0.02, (next - time) / 2);
    const process = Bun.spawn(["ffmpeg", ...passthroughRunArgs({ ...this.options, directory, seek })], {
      stdin: "ignore", stdout: "ignore", stderr: "pipe",
    });
    const run: PassthroughRun = {
      directory, requested: index, process, stderr: new Response(process.stderr).text(), base: null, stopped: false,
    };
    this.runs.push(run);
    void this.watchRun(run);
    return run;
  }

  private async watchRun(run: PassthroughRun): Promise<void> {
    const code = await run.process.exited;
    if (code !== 0 && !run.stopped && this.exitCode === null) {
      const stderr = await run.stderr;
      const message = stderr.trim() || `FFmpeg exited with code ${String(code)}`;
      this.finish?.(1, message);
    }
  }

  private async stopRun(run: PassthroughRun): Promise<void> {
    run.stopped = true;
    await stopHlsProcess(run.process, RUN_STOP_GRACE_MS);
  }

  private async resolveBase(run: PassthroughRun): Promise<number | null> {
    if (run.base !== null) {
      return run.base;
    }
    const first = join(run.directory, segmentName(0));
    if (!(await exists(first)) || !(await exists(join(run.directory, "init.mp4")))) {
      return null;
    }
    const start = await firstSegmentStart(run.directory);
    run.base = start === null ? null : keyframeIndexAt(this.keyframes, start - PASSTHROUGH_TIMESTAMP_OFFSET);
    return run.base;
  }

  private async waitForSegment(chosen: PassthroughRun, index: number): Promise<string | null> {
    const deadline = Date.now() + SEGMENT_WAIT_MS;
    let run = chosen;
    while (Date.now() < deadline && this.exitCode === null) {
      const base = await this.resolveBase(run);
      const path = base === null || index < base ? null : join(run.directory, segmentName(index - base));
      if (path !== null && await exists(path)) {
        return path;
      }
      if (run.stopped || run.process.exitCode !== null) {
        // Replaced by a seek elsewhere, or finished without this segment: another run may have it.
        const produced = await this.producedPath(index);
        if (produced !== null) {
          return produced;
        }
        run = await this.chooseRun(index);
      }
      await Bun.sleep(POLL_MS);
    }
    return null;
  }
}

/** Write the full playlist and return a producer that repackages segments on request. */
export async function startPassthrough(options: PassthroughOptions): Promise<PassthroughProducer> {
  const keyframes = await sourceKeyframes(options.input);
  if (keyframes.length === 0) {
    throw new Error("The video has no keyframes to stream from");
  }
  const playlist = join(options.directory, "index.m3u8");
  await writeFile(`${playlist}.tmp`, passthroughPlaylist(keyframes, options.duration), { mode: 0o600 });
  await rename(`${playlist}.tmp`, playlist);
  return new PassthroughProducer(options, keyframes);
}
