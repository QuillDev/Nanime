import { createHash, randomUUID } from "node:crypto";
import { link, lstat, mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { HLS_SEGMENT_SECONDS } from "../shared/playback.ts";
import type { AudioTrack } from "./audioTracks.ts";
import { cachedRunArgs } from "./hlsTranscode.ts";
import type { HlsProducer } from "./hlsProcess.ts";

/**
 * Conversion for clients that can't play the source as-is, kept as it's made.
 * Every episode is cut on one fixed grid (segment N covers N×2 s to N×2+2 s
 * whatever the start), so a run started anywhere converts only what's missing
 * and stops at the first segment that's already on disk. Over enough watches
 * the whole episode is converted once and every later play is served from disk.
 *
 * Runs write into their own directory; a segment moves into the episode's
 * cache only once it's known complete (the run has started the next one, or
 * finished normally), so a killed run never leaves a cut-off segment behind.
 */

/** Bump when the encoder settings change, so old segments aren't mixed with new ones. */
const CACHE_VERSION = "h264-faster-crf20-aac192-v2";
/** A run this far ahead of anything its viewer has asked for stops; a later request starts a new one. */
const RUN_AHEAD_SEGMENTS = 45;
/** Segments a running run is expected to reach soon; further requests start a new run. */
const RUN_LOOKAHEAD_SEGMENTS = 8;
const MAX_LIVE_RUNS = 2;
/** Under hls.js's 10 s time-to-first-byte limit, so a slow segment retries instead of failing. */
const SEGMENT_WAIT_MS = 8000;
const POLL_MS = 50;
const WATCH_MS = 250;

export interface CachedTranscodeOptions {
  readonly input: string;
  readonly audioTrack: AudioTrack | undefined;
  /** Where the library keeps converted segments (`<media root>/.nanime-segments`). */
  readonly cacheRoot: string;
  /** The session's own directory, for its playlist. */
  readonly directory: string;
  readonly duration: number;
}

interface CachedRun {
  readonly directory: string;
  readonly first: number;
  readonly end: number;
  readonly process: Bun.Subprocess<"ignore", "ignore", "pipe">;
  readonly stderr: Promise<string>;
  /** Highest segment a viewer has asked this run for. */
  wanted: number;
  stopped: boolean;
}

export function cachedSegmentName(index: number): string {
  return `segment-${String(index).padStart(6, "0")}.ts`;
}

function cachedSegmentIndex(name: string): number | null {
  const match = /^segment-(?<index>\d{6})\.ts$/u.exec(name)?.groups?.["index"];
  return match === undefined ? null : Number(match);
}

/** Container durations run a little past the last frame (audio padding); a tail under this isn't a segment. */
const TAIL_SECONDS = 0.1;

export function cachedSegmentCount(duration: number): number {
  return Math.max(1, Math.ceil((duration - TAIL_SECONDS) / HLS_SEGMENT_SECONDS));
}

/** The whole episode on the fixed grid, so players seek anywhere. */
export function cachedPlaylist(duration: number): string {
  const count = cachedSegmentCount(duration);
  const segments = Array.from({ length: count }, (_, index) => {
    const length = Math.min(HLS_SEGMENT_SECONDS, duration - index * HLS_SEGMENT_SECONDS);
    return [`#EXTINF:${Math.max(length, 0.001).toFixed(6)},`, cachedSegmentName(index)];
  }).flat();
  return [
    "#EXTM3U", "#EXT-X-VERSION:3", `#EXT-X-TARGETDURATION:${String(HLS_SEGMENT_SECONDS)}`, "#EXT-X-MEDIA-SEQUENCE:0",
    "#EXT-X-PLAYLIST-TYPE:VOD", ...segments, "#EXT-X-ENDLIST", "",
  ].join("\n");
}

/** One episode version (path, size, modification time) with one audio track, at one encoder setting. */
export async function cacheDirectory(options: Pick<CachedTranscodeOptions, "input" | "audioTrack" | "cacheRoot">): Promise<string> {
  const stat = await lstat(options.input);
  const key = createHash("sha256").update([
    CACHE_VERSION, options.input, String(stat.size), String(stat.mtimeMs), String(options.audioTrack?.index ?? "none"),
  ].join("\0")).digest("hex").slice(0, 32);
  return join(options.cacheRoot, key);
}

async function isFile(path: string): Promise<boolean> {
  const stat = await lstat(path).catch(() => null);
  return stat?.isFile() === true;
}

/** Segment indexes a run has written so far, in order. */
async function writtenSegments(directory: string): Promise<readonly number[]> {
  const names = await readdir(directory).catch((): string[] => []);
  return names.map((name) => cachedSegmentIndex(name)).filter((index) => index !== null).toSorted((left, right) => left - right);
}

async function keep(run: CachedRun, cache: string, index: number): Promise<void> {
  const target = join(cache, cachedSegmentName(index));
  if (!await isFile(target)) {
    // A hard link: a viewer may be reading the run's copy right now.
    await link(join(run.directory, cachedSegmentName(index)), target).catch(() => undefined);
  }
}

/** Runs converting right now, by cache directory, for progress views. */
const liveRuns = new Map<string, Set<CachedRun>>();

function trackRun(cache: string, run: CachedRun): void {
  const runs = liveRuns.get(cache) ?? new Set<CachedRun>();
  runs.add(run);
  liveRuns.set(cache, runs);
  void (async (): Promise<void> => {
    await run.process.exited.catch(() => -1);
    runs.delete(run);
    if (runs.size === 0 && liveRuns.get(cache) === runs) {
      liveRuns.delete(cache);
    }
  })();
}

type Range = readonly [number, number];

/** Consecutive segment indexes as `[start, end)` second ranges; the last segment runs to the very end. */
function secondRanges(indexes: readonly number[], duration: number): Range[] {
  const count = cachedSegmentCount(duration);
  const ranges: [number, number][] = [];
  for (const index of indexes) {
    const last = ranges.at(-1);
    if (last !== undefined && last[1] === index) {
      last[1] = index + 1;
    } else {
      ranges.push([index, index + 1]);
    }
  }
  return ranges.map(([start, end]) => [start * HLS_SEGMENT_SECONDS, end >= count ? duration : end * HLS_SEGMENT_SECONDS]);
}

export interface ConvertedProgress {
  readonly duration: number;
  /** Converted and kept: plays from disk. */
  readonly kept: readonly Range[];
  /** Where running conversions are headed: from what they've reached to where they'll stop. */
  readonly converting: readonly Range[];
}

/** What's converted of one episode version and audio track, and what's converting now. */
export async function convertedProgress(options: Pick<CachedTranscodeOptions, "input" | "audioTrack" | "cacheRoot" | "duration">): Promise<ConvertedProgress> {
  const cache = await cacheDirectory(options);
  const count = cachedSegmentCount(options.duration);
  const onDisk = await writtenSegments(cache);
  const kept = onDisk.filter((index) => index < count);
  const live = [...(liveRuns.get(cache) ?? [])].filter((run) => !run.stopped);
  const converting = await Promise.all(live.map(async (run): Promise<Range> => {
    const written = await writtenSegments(run.directory);
    const reached = run.first + written.length;
    const stop = Math.min(run.end, run.wanted + RUN_AHEAD_SEGMENTS + 1, count);
    return [reached * HLS_SEGMENT_SECONDS, Math.min(Math.max(reached, stop) * HLS_SEGMENT_SECONDS, options.duration)];
  }));
  return {
    duration: options.duration,
    kept: secondRanges(kept, options.duration),
    converting: converting.filter(([start, end]) => end > start),
  };
}

export class CachedTranscodeProducer implements HlsProducer {
  exitCode: number | null = null;
  readonly exited: Promise<number>;
  readonly stderr: ReadableStream<Uint8Array>;
  readonly start = 0;
  private readonly options: CachedTranscodeOptions;
  private readonly cache: string;
  private readonly count: number;
  private readonly runs: CachedRun[] = [];
  private choosing: Promise<void> = Promise.resolve();
  private finish: ((code: number, message: string) => void) | null = null;
  private readonly watcher: ReturnType<typeof setInterval>;

  constructor(options: CachedTranscodeOptions, cache: string) {
    this.options = options;
    this.cache = cache;
    this.count = cachedSegmentCount(options.duration);
    const exit = Promise.withResolvers<number>();
    this.exited = exit.promise;
    this.stderr = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.finish = (code, message) => {
          this.finish = null;
          this.exitCode = code;
          clearInterval(this.watcher);
          if (message !== "") {
            controller.enqueue(new TextEncoder().encode(message));
          }
          controller.close();
          exit.resolve(code);
        };
      },
    });
    this.watcher = setInterval(() => {
      void this.tend();
    }, WATCH_MS);
  }

  kill(): void {
    if (this.exitCode === null) {
      void this.stopAll();
    }
  }

  private async stopAll(): Promise<void> {
    await Promise.all(this.runs.map((run) => this.stopRun(run)));
    this.finish?.(0, "");
  }

  /** A converted segment: from disk when it exists, otherwise converted now. */
  async segmentPath(name: string): Promise<string | null> {
    const index = cachedSegmentIndex(name);
    if (this.exitCode !== null || index === null || index >= this.count) {
      return null;
    }
    const cached = join(this.cache, name);
    if (await isFile(cached)) {
      return cached;
    }
    const run = await this.chooseRun(index);
    return this.waitForSegment(run, index);
  }

  private async chooseRun(index: number): Promise<CachedRun> {
    const previous = this.choosing;
    const turn = Promise.withResolvers<undefined>();
    this.choosing = turn.promise;
    await previous;
    try {
      const run = (await this.coveringRun(index)) ?? (await this.startRun(index));
      run.wanted = Math.max(run.wanted, index);
      return run;
    } finally {
      turn.resolve(undefined);
    }
  }

  private async coveringRun(index: number): Promise<CachedRun | null> {
    for (const run of this.runs.toReversed()) {
      if (!run.stopped && run.process.exitCode === null && run.first <= index && index < run.end) {
        const written = await writtenSegments(run.directory);
        const reached = run.first + written.length;
        if (index < reached + RUN_LOOKAHEAD_SEGMENTS) {
          return run;
        }
      }
    }
    return null;
  }

  /** The first segment at or after `index` that's already on disk: where a new run can stop. */
  private async gapEnd(index: number): Promise<number> {
    const names = new Set(await readdir(this.cache).catch((): string[] => []));
    const next = Array.from({ length: this.count - index }, (_, offset) => index + offset)
      .find((candidate) => names.has(cachedSegmentName(candidate)));
    return next ?? this.count;
  }

  private async startRun(index: number): Promise<CachedRun> {
    const live = this.runs.filter((candidate) => !candidate.stopped && candidate.process.exitCode === null);
    for (const run of live.slice(0, Math.max(0, live.length - MAX_LIVE_RUNS + 1))) {
      void this.stopRun(run);
    }
    const end = Math.max(index + 1, await this.gapEnd(index));
    const directory = join(this.cache, "runs", randomUUID());
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const start = index * HLS_SEGMENT_SECONDS;
    const length = Math.min(end * HLS_SEGMENT_SECONDS, this.options.duration) - start;
    const nice = Bun.which("nice");
    const process = Bun.spawn([...(nice === null ? [] : [nice, "-n", "10"]), "ffmpeg", ...cachedRunArgs({ ...this.options, directory, start, length, first: index })], {
      stdin: "ignore", stdout: "ignore", stderr: "pipe",
    });
    const run: CachedRun = {
      directory, first: index, end, process, stderr: new Response(process.stderr).text(), wanted: index, stopped: false,
    };
    this.runs.push(run);
    trackRun(this.cache, run);
    void this.watchRun(run);
    return run;
  }

  private async watchRun(run: CachedRun): Promise<void> {
    const code = await run.process.exited;
    if (code === 0) {
      // Finished normally: every segment it wrote is complete.
      const written = await writtenSegments(run.directory);
      await Promise.all(written.map((index) => keep(run, this.cache, index)));
    } else if (!run.stopped && this.exitCode === null) {
      const stderr = await run.stderr;
      this.finish?.(1, stderr.trim() || `FFmpeg exited with code ${String(code)}`);
    }
  }

  /** Keeps finished segments and stops runs that got far ahead of their viewer. */
  private async tend(): Promise<void> {
    await Promise.all(this.runs.filter((run) => !run.stopped && run.process.exitCode === null).map(async (run) => {
      const written = await writtenSegments(run.directory);
      // The newest segment may still be growing; everything before it is done.
      await Promise.all(written.slice(0, -1).map((index) => keep(run, this.cache, index)));
      if ((written.at(-1) ?? run.first) - run.wanted > RUN_AHEAD_SEGMENTS) {
        await this.stopRun(run);
      }
    }));
  }

  /** SIGKILL: on SIGTERM ffmpeg would close out its current segment early, and that cut-off copy must not look finished. */
  private async stopRun(run: CachedRun): Promise<void> {
    run.stopped = true;
    if (run.process.exitCode === null) {
      run.process.kill("SIGKILL");
    }
    await run.process.exited.catch(() => -1);
    await rm(run.directory, { recursive: true, force: true });
  }

  private async waitForSegment(chosen: CachedRun, index: number): Promise<string | null> {
    const deadline = Date.now() + SEGMENT_WAIT_MS;
    let run = chosen;
    while (Date.now() < deadline && this.exitCode === null) {
      const cached = join(this.cache, cachedSegmentName(index));
      if (await isFile(cached)) {
        return cached;
      }
      // Ffmpeg renames a segment into place once it's written (temp_file), so a viewer can have it before it's kept.
      const fresh = join(run.directory, cachedSegmentName(index));
      if (!run.stopped && await isFile(fresh)) {
        return fresh;
      }
      if (run.process.exitCode === 0 && run.first <= index && index < run.end) {
        // Finished without it: there's no picture there (past the last frame).
        return null;
      }
      if (run.stopped || run.process.exitCode !== null) {
        run = await this.chooseRun(index);
      }
      await Bun.sleep(POLL_MS);
    }
    return null;
  }
}

/** Run directories nothing has written to for a while: left by a restart or a crash. Their segments may be cut off. */
async function removeAbandonedRuns(runs: string): Promise<void> {
  const names = await readdir(runs).catch((): string[] => []);
  const cutoff = Date.now() - 10 * 60 * 1000;
  await Promise.all(names.map(async (name) => {
    const stat = await lstat(join(runs, name)).catch(() => null);
    if (stat !== null && stat.mtimeMs < cutoff) {
      await rm(join(runs, name), { recursive: true, force: true });
    }
  }));
}

/** Writes the session playlist and returns a producer that converts (or reuses) segments on request. */
export async function startCachedTranscode(options: CachedTranscodeOptions): Promise<CachedTranscodeProducer> {
  const cache = await cacheDirectory(options);
  await mkdir(join(cache, "runs"), { recursive: true, mode: 0o700 });
  await removeAbandonedRuns(join(cache, "runs"));
  const playlist = join(options.directory, "index.m3u8");
  await writeFile(`${playlist}.tmp`, cachedPlaylist(options.duration), { mode: 0o600 });
  await rename(`${playlist}.tmp`, playlist);
  return new CachedTranscodeProducer(options, cache);
}
