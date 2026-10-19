import { readdir, readFile } from "node:fs/promises";
import { availableParallelism } from "node:os";
import { basename, join } from "node:path";
import { HLS_SEGMENT_SECONDS } from "../shared/playback.ts";
import type { TranscodePreset } from "../shared/types.ts";
import { stopHlsProcess, type HlsProcess } from "./hlsProcess.ts";

/** Stored transcodes may use at most this share of the host's processors. */
const CPU_SHARE = 4;
const THREADS_PER_WORKER = 2;
const MAX_WORKERS = 4;

export interface TranscodeWorkerBudget {
  /** Processors the stored-transcode workers share. */
  readonly cpus: number;
  readonly workers: number;
  readonly threadsPerWorker: number;
}

/**
 * Workers run in parallel inside one quarter-of-the-host budget. An explicit
 * worker count is honoured but never exceeds the budget.
 */
export function transcodeWorkerBudget(processors: number, configuredWorkers: number): TranscodeWorkerBudget {
  const cpus = Math.max(1, Math.floor(processors / CPU_SHARE));
  const configured = Number.isInteger(configuredWorkers) && configuredWorkers > 0;
  const workers = configured
    ? Math.min(configuredWorkers, cpus, MAX_WORKERS)
    : Math.min(MAX_WORKERS, Math.max(1, Math.floor(cpus / THREADS_PER_WORKER)));
  return { cpus, workers, threadsPerWorker: Math.max(1, Math.floor(cpus / workers)) };
}

export function parseCpuList(value: string): readonly number[] {
  return value.trim().split(",").flatMap((part) => {
    if (!/^\d+(?:-\d+)?$/u.test(part)) {
      return [];
    }
    const [first, last] = part.split("-").map(Number);
    if (first === undefined) {
      return [];
    }
    const end = last === undefined ? first : last;
    if (!Number.isInteger(end) || end < first) {
      return [];
    }
    return Array.from({ length: end - first + 1 }, (_, index) => first + index);
  });
}

/** The last processors this process may run on, or null when unknown. */
export async function reservedCpus(count: number): Promise<readonly number[] | null> {
  const status = await readFile("/proc/self/status", "utf8").catch(() => "");
  const line = status.split("\n").find((entry) => entry.startsWith("Cpus_allowed_list:"));
  const allowed = line === undefined ? [] : parseCpuList(line.slice(line.indexOf(":") + 1));
  return allowed.length === 0 ? null : allowed.slice(-count);
}

/**
 * Pin every stored-transcode encoder to the same reserved processors and run it
 * at low priority. The prefixes exec the encoder, so its PID is the child's.
 */
export function encoderCommandPrefix(cpus: readonly number[] | null): readonly string[] {
  const nice = Bun.which("nice");
  const taskset = Bun.which("taskset");
  return [
    ...(nice === null ? [] : [nice, "-n", "10"]),
    ...(taskset === null || cpus === null ? [] : [taskset, "-c", cpus.join(",")]),
  ];
}

export const budget = transcodeWorkerBudget(
  availableParallelism(),
  Number(process.env["NANIME_TRANSCODE_WORKERS"] ?? ""),
);

/**
 * Kill encoders a previous server instance left writing into the private
 * output directory. Their jobs were reset to queued and will restart cleanly.
 */
export async function reapStrayEncoders(outputDirectory: string): Promise<number> {
  const prefix = `${outputDirectory}/`;
  const entries = await readdir("/proc").catch((): string[] => []);
  const pids = await Promise.all(entries.map(async (entry) => {
    const pid = Number(entry);
    if (!/^\d+$/u.test(entry) || pid === process.pid) {
      return null;
    }
    const cmdline = await readFile(join("/proc", entry, "cmdline"), "utf8").catch(() => "");
    const args = cmdline.split("\0");
    const encoder = basename(args[0] ?? "") === "ffmpeg";
    return encoder && args.some((argument) => argument.startsWith(prefix)) ? pid : null;
  }));
  let reaped = 0;
  for (const pid of pids) {
    if (pid === null) {
      continue;
    }
    try {
      process.kill(pid, "SIGKILL");
      reaped += 1;
    } catch {
      // Already gone, or owned by another account: nothing this server may stop.
    }
  }
  return reaped;
}

let reaping: Promise<void> | null = null;

/** Reap once per server instance, before any of its own encoders exist. */
export function reapStrayEncodersOnce(outputDirectory: string | null): Promise<void> {
  reaping ??= (async (): Promise<void> => {
    if (outputDirectory !== null) {
      await reapStrayEncoders(outputDirectory).catch(() => 0);
    }
  })();
  return reaping;
}

const ENCODER_STOP_GRACE_MS = 5000;

/** SIGTERM, then SIGKILL if the encoder is still alive after the grace period. */
export function stopEncoder(encoder: HlsProcess | undefined): void {
  if (encoder !== undefined) {
    void stopHlsProcess(encoder, ENCODER_STOP_GRACE_MS);
  }
}

/** Tag stored on compatibility output: keyframes sit on every HLS segment boundary. */
export const STORED_KEYFRAME_TAG = "NANIME_HLS_KEYFRAME_SECONDS";

/** Peak video bitrate for stored compatibility copies, and its VBV buffer (two seconds' worth). */
const STORED_MAX_BITRATE = "6M";
const STORED_BUFFER_SIZE = "12M";

export function presetArgs(preset: TranscodePreset): readonly string[] {
  const threads = String(budget.threadsPerWorker);
  if (preset === "space-saver") {
    return ["-c:v", "libsvtav1", "-preset", "5", "-crf", "30", "-pix_fmt", "yuv420p10le", "-c:a", "libopus", "-b:a", "128k", "-threads", threads];
  }
  // Browser-safe 8-bit H.264 at the source resolution. Audio is copied, and a
  // keyframe on every HLS boundary lets playback stream the video without re-encoding.
  // The VBV cap keeps heavy scenes streamable: uncapped CRF 20 reached 16 Mbps over
  // a 2 s segment, while medium + animation tuning stays under 7 Mbps and scores
  // higher VMAF than the old veryfast output, at roughly twice the encode time.
  return [
    "-c:v", "libx264", "-preset", "medium", "-tune", "animation", "-crf", "20",
    "-maxrate", STORED_MAX_BITRATE, "-bufsize", STORED_BUFFER_SIZE, "-pix_fmt", "yuv420p", "-threads", threads,
    "-sc_threshold", "0", "-force_key_frames", `expr:gte(t,n_forced*${String(HLS_SEGMENT_SECONDS)})`,
    "-c:a", "copy", "-metadata", `${STORED_KEYFRAME_TAG}=${String(HLS_SEGMENT_SECONDS)}`,
  ];
}
