import { randomUUID } from "node:crypto";
import { link, lstat, unlink } from "node:fs/promises";
import { extname, join } from "node:path";
import type { DownloadStatus } from "../shared/types.ts";
import { fileSystemErrorCode } from "./fileSystemError.ts";
import { claimLibraryPaths } from "./libraryWriters.ts";
import { safeDestinationDirectory } from "./mediaUpload.ts";
import {
  deleteFileDownload, fileDownloadJob, fileDownloadJobs, insertFileDownloads, setFileDownloadProgress, setFileDownloadState,
  type FileDownloadJob, type NewFileDownload, type ResolvedEpisode, type SourceEpisode, type SubtitleLink,
} from "./downloadStore.ts";
import { DownloadFailureError, downloadFile, downloadHls } from "./fileDownloadTransfer.ts";
import { saveSubtitles } from "./sourceSubtitles.ts";

const PART_FOLDER = ".nanime-downloads";
const configuredConcurrency = Number(process.env["NANIME_DOWNLOAD_CONCURRENCY"] ?? "");
const CONCURRENCY = Number.isSafeInteger(configuredConcurrency) && configuredConcurrency > 0 ? configuredConcurrency : 2;
const PERSIST_INTERVAL_MS = 2000;
const SPEED_WINDOW_MS = 1000;

interface Running {
  readonly controller: AbortController;
  received: number;
  size: number;
  speed: number;
  sampledAt: number;
  sampledBytes: number;
  persistedAt: number;
}

interface FileDownloadsConfiguration {
  readonly mediaRoot: string;
  /** Called after a finished file lands in the library. */
  readonly onComplete: () => void;
  /** Asks a source plugin what an episode is right now (its links expire). */
  readonly resolveEpisode: (episode: SourceEpisode) => Promise<ResolvedEpisode>;
  /** Hands a magnet to the torrent client; returns why it was refused, or null. */
  readonly addTorrent: (magnet: string, showFolder: string) => Promise<string | null>;
}

/** What a job downloads once resolved: a file (with its final name and subtitles) or a torrent. */
type Prepared =
  | { readonly kind: "file"; readonly job: FileDownloadJob; readonly fileName: string; readonly subtitles: readonly SubtitleLink[] }
  | { readonly kind: "torrent"; readonly magnet: string };

let configuration: FileDownloadsConfiguration | null = null;
const running = new Map<string, Running>();
/** Each unfinished job holds its destination so file operations can't move it away mid-download. */
const claims = new Map<string, () => void>();

function destination(job: Pick<FileDownloadJob, "showFolder" | "fileName">): string {
  return `${job.showFolder}/${job.fileName}`;
}

/** Library-relative destinations of unfinished direct downloads. */
export function activeDownloadPaths(): readonly string[] {
  return fileDownloadJobs().map((job) => destination(job));
}

function releaseClaim(id: string): void {
  claims.get(id)?.();
  claims.delete(id);
}

function partPath(root: string, id: string): string {
  return join(root, PART_FOLDER, `${id}.part`);
}

async function partDirectory(): Promise<string> {
  const directory = configuration === null ? null : await safeDestinationDirectory(configuration.mediaRoot, [PART_FOLDER]);
  if (directory === null) {
    throw new DownloadFailureError("Download storage is unavailable");
  }
  return directory;
}

function sample(state: Running, received: number, size: number): void {
  const now = Date.now();
  state.received = received;
  state.size = size;
  if (now - state.sampledAt >= SPEED_WINDOW_MS) {
    state.speed = Math.max(0, (received - state.sampledBytes) * 1000 / (now - state.sampledAt));
    state.sampledAt = now;
    state.sampledBytes = received;
  }
}

function reporter(id: string, state: Running): (received: number, size: number) => void {
  return (received, size) => {
    sample(state, received, size);
    if (Date.now() - state.persistedAt >= PERSIST_INTERVAL_MS) {
      state.persistedAt = Date.now();
      setFileDownloadProgress(id, received, size);
    }
  };
}

function stem(fileName: string): string {
  return fileName.slice(0, fileName.length - extname(fileName).length);
}

function done(job: FileDownloadJob): void {
  deleteFileDownload(job.id);
  releaseClaim(job.id);
  configuration?.onComplete();
}

/** Puts a finished part file in place without ever replacing an existing file, then its subtitles beside it. */
async function finish(prepared: Extract<Prepared, { readonly kind: "file" }>, part: string): Promise<void> {
  const { job, fileName, subtitles } = prepared;
  const root = configuration?.mediaRoot ?? "";
  const directory = await safeDestinationDirectory(root, [job.showFolder]);
  if (directory === null) {
    throw new DownloadFailureError("The show folder can't be used");
  }
  try {
    await link(part, join(directory, fileName));
  } catch (error) {
    throw new DownloadFailureError(fileSystemErrorCode(error) === "EEXIST" ? "A file with that name already exists" : "Could not move the download into the library");
  }
  await unlink(part).catch(() => undefined);
  await saveSubtitles(subtitles, { headers: job.headers, scratch: join(root, PART_FOLDER), stem: join(directory, stem(fileName)) });
  done(job);
}

/** Resolves a source episode into what to fetch; other jobs already know. */
async function prepare(job: FileDownloadJob): Promise<Prepared> {
  if (job.episode === null || configuration === null) {
    return { kind: "file", job, fileName: job.fileName, subtitles: [] };
  }
  let resolved: ResolvedEpisode | null = null;
  try {
    resolved = await configuration.resolveEpisode(job.episode);
  } catch (error) {
    throw new DownloadFailureError(error instanceof Error ? error.message : "The source couldn't find this episode");
  }
  if (resolved.kind === "torrent") {
    return resolved;
  }
  const { url, headers, format, extension, subtitles } = resolved;
  return { kind: "file", job: { ...job, url, headers, format }, fileName: `${stem(job.fileName)}${extension}`, subtitles };
}

/** Gives the episode to qBittorrent; its file claim is let go first, since the torrent claims the show folder. */
async function handOver(job: FileDownloadJob, magnet: string): Promise<void> {
  releaseClaim(job.id);
  const refused = configuration === null ? "Torrents aren't available" : await configuration.addTorrent(magnet, job.showFolder);
  if (refused !== null) {
    try {
      claims.set(job.id, claimLibraryPaths([destination(job)], true));
    } catch {
      // Something else holds the folder now; the job fails either way.
    }
    throw new DownloadFailureError(refused);
  }
  done(job);
}

function stopped(job: FileDownloadJob, controller: AbortController, error: unknown): void {
  const state = running.get(job.id);
  if (state !== undefined) {
    setFileDownloadProgress(job.id, state.received, state.size);
  }
  if (controller.signal.aborted) {
    // Paused or removed: whoever aborted already recorded the new state.
    return;
  }
  const message = error instanceof DownloadFailureError ? error.message : "The download stopped unexpectedly";
  setFileDownloadState(job.id, "failed", message);
}

async function run(job: FileDownloadJob): Promise<void> {
  const controller = new AbortController();
  const state: Running = { controller, received: job.received, size: job.size, speed: 0, sampledAt: Date.now(), sampledBytes: job.received, persistedAt: 0 };
  running.set(job.id, state);
  setFileDownloadState(job.id, "downloading");
  try {
    const prepared = await prepare(job);
    if (prepared.kind === "torrent") {
      await handOver(job, prepared.magnet);
      return;
    }
    const part = join(await partDirectory(), `${job.id}.part`);
    const transfer = { job: prepared.job, part, signal: controller.signal, report: reporter(job.id, state) };
    await (prepared.job.format === "hls" ? downloadHls(transfer) : downloadFile(transfer));
    await finish(prepared, part);
  } catch (error) {
    stopped(job, controller, error);
  } finally {
    running.delete(job.id);
    schedule();
  }
}

/** Starts queued jobs, oldest first, up to the concurrency limit. */
function schedule(): void {
  if (configuration === null) {
    return;
  }
  const queued = fileDownloadJobs().filter((job) => job.state === "queued" && !running.has(job.id));
  queued.slice(0, Math.max(0, CONCURRENCY - running.size)).forEach((job) => {
    void run(job);
  });
}

/** Holds every unfinished job's destination, then starts the queue. Call once at startup. */
export function startFileDownloads(next: FileDownloadsConfiguration): void {
  configuration = next;
  for (const job of fileDownloadJobs()) {
    try {
      claims.set(job.id, claimLibraryPaths([destination(job)], true));
    } catch {
      setFileDownloadState(job.id, "failed", "Its destination is busy");
    }
  }
  schedule();
}

export interface FileDownloadRequest {
  readonly showFolder: string;
  readonly fileName: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
}

function newJob(request: FileDownloadRequest): NewFileDownload {
  const hls = new URL(request.url).pathname.toLowerCase().endsWith(".m3u8");
  return {
    ...request,
    id: randomUUID(),
    format: hls ? "hls" : "file",
    fileName: hls ? `${stem(request.fileName)}.mp4` : request.fileName,
    episode: null,
  };
}

export interface SourceEpisodeRequest {
  readonly showFolder: string;
  /** Saved as `.mp4` unless the source turns out to serve another video file type. */
  readonly fileName: string;
  readonly episode: SourceEpisode;
}

function episodeJob(request: SourceEpisodeRequest): NewFileDownload {
  return { ...request, id: randomUUID(), url: "", headers: {}, format: "file", fileName: `${stem(request.fileName)}.mp4` };
}

/** One claim per destination, so each finished job frees only its own file; all or none. */
function claimEach(paths: readonly string[]): readonly (() => void)[] {
  const releases: (() => void)[] = [];
  try {
    paths.forEach((path) => releases.push(claimLibraryPaths([path], true)));
  } catch (error) {
    releases.forEach((release) => release());
    throw error;
  }
  return releases;
}

async function existing(root: string, job: NewFileDownload): Promise<boolean> {
  return await lstat(join(root, job.showFolder, job.fileName)).catch(() => null) !== null;
}

/**
 * Queues one job per request, all or none: each destination must be free and
 * not already a file. Throws LibraryFileError (423) when a destination is busy.
 */
export function enqueueFileDownloads(requests: readonly FileDownloadRequest[]): Promise<readonly string[] | "exists"> {
  return enqueue(requests.map((request) => newJob(request)));
}

/** Queues source episodes the same way; each is resolved by its plugin when it starts. */
export function enqueueSourceEpisodes(requests: readonly SourceEpisodeRequest[]): Promise<readonly string[] | "exists"> {
  return enqueue(requests.map((request) => episodeJob(request)));
}

async function enqueue(jobs: readonly NewFileDownload[]): Promise<readonly string[] | "exists"> {
  const root = configuration?.mediaRoot ?? "";
  const taken = await Promise.all(jobs.map((job) => existing(root, job)));
  if (taken.some(Boolean) || new Set(jobs.map((job) => destination(job))).size !== jobs.length) {
    return "exists";
  }
  const releases = claimEach(jobs.map((job) => destination(job)));
  insertFileDownloads(jobs);
  jobs.forEach((job, index) => {
    claims.set(job.id, releases[index] ?? (() => undefined));
  });
  schedule();
  return jobs.map((job) => job.id);
}

export function pauseFileDownload(id: string): boolean {
  const job = fileDownloadJob(id);
  if (job === null || job.state === "paused" || job.state === "failed") {
    return job !== null;
  }
  setFileDownloadState(id, "paused");
  running.get(id)?.controller.abort();
  return true;
}

export function resumeFileDownload(id: string): boolean {
  const job = fileDownloadJob(id);
  if (job === null) {
    return false;
  }
  if (job.state === "paused" || job.state === "failed") {
    setFileDownloadState(id, "queued");
    schedule();
  }
  return true;
}

export async function cancelFileDownload(id: string): Promise<boolean> {
  const job = fileDownloadJob(id);
  if (job === null) {
    return false;
  }
  deleteFileDownload(id);
  running.get(id)?.controller.abort();
  releaseClaim(id);
  await unlink(partPath(configuration?.mediaRoot ?? "", id)).catch(() => undefined);
  return true;
}

export function fileDownloadStatuses(): readonly DownloadStatus[] {
  return fileDownloadJobs().map((job) => {
    const live = running.get(job.id);
    const received = live?.received ?? job.received;
    const size = live?.size ?? job.size;
    const speed = live?.speed ?? 0;
    return {
      id: job.id,
      kind: "file",
      name: job.fileName,
      showFolder: job.showFolder,
      state: job.state,
      progress: size > 0 ? Math.min(received / size, 1) : 0,
      downloadSpeed: speed,
      eta: speed > 0 && size > received ? Math.round((size - received) / speed) : 0,
      completed: received,
      size,
      addedOn: Math.floor(job.addedAt / 1000),
      error: job.error,
    };
  });
}
