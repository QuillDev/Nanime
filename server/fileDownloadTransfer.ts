import { open, stat, unlink } from "node:fs/promises";
import { stopHlsProcess } from "./hlsProcess.ts";
import type { FileDownloadJob } from "./downloadStore.ts";

/** A download failure worth showing the admin as is. */
export class DownloadFailureError extends Error {
  override name = "DownloadFailureError";
}

export type ProgressReport = (received: number, size: number) => void;

interface Transfer {
  readonly job: FileDownloadJob;
  readonly part: string;
  readonly signal: AbortSignal;
  readonly report: ProgressReport;
}

interface Piece {
  /** Where the response's bytes go in the file. */
  readonly start: number;
  /** The whole file's size, or 0 when the source doesn't say. */
  readonly size: number;
}

/** Where a response's bytes belong; null when a partial answer isn't the part that was asked for. */
function piece(response: Response, have: number): Piece | null {
  const range = /^bytes (?<first>\d+)-\d+\/(?<total>\d+|\*)$/u.exec(response.headers.get("content-range") ?? "")?.groups;
  const length = Number(response.headers.get("content-length") ?? "");
  if (response.status !== 206) {
    // A source that ignores Range sends the whole file again: start over.
    return { start: 0, size: Number.isSafeInteger(length) && length > 0 ? length : 0 };
  }
  if (range === undefined || Number(range["first"]) !== have) {
    return null;
  }
  return { start: have, size: range["total"] === "*" ? 0 : Number(range["total"]) };
}

async function existingBytes(part: string): Promise<number> {
  const information = await stat(part).catch(() => null);
  return information?.size ?? 0;
}

async function requestFrom(transfer: Transfer, have: number): Promise<Response> {
  const headers = new Headers(transfer.job.headers);
  if (have > 0) {
    headers.set("range", `bytes=${String(have)}-`);
  }
  return await fetch(transfer.job.url, { headers, signal: transfer.signal, redirect: "follow" });
}

/** Writes one response at its place in the part file; returns the file's length afterwards. */
async function writePiece(transfer: Transfer, response: Response, where: Piece): Promise<number> {
  const file = await open(transfer.part, where.start > 0 ? "a" : "w", 0o600);
  let received = where.start;
  try {
    for await (const chunk of response.body ?? []) {
      await file.write(chunk);
      received += chunk.byteLength;
      transfer.report(received, where.size);
    }
  } finally {
    await file.close();
  }
  return received;
}

/**
 * Downloads a plain file, continuing a partial copy when the source supports
 * ranges and asking again for the rest when a source sends it in pieces.
 */
export async function downloadFile(transfer: Transfer): Promise<void> {
  const have = await existingBytes(transfer.part);
  const response = await requestFrom(transfer, have);
  if (have > 0 && response.status === 416 && have === transfer.job.size) {
    return;
  }
  if (!response.ok) {
    throw new DownloadFailureError(`The source answered ${String(response.status)}`);
  }
  const where = piece(response, have);
  if (where === null) {
    throw new DownloadFailureError("The source sent a different part of the file than was asked for");
  }
  const received = await writePiece(transfer, response, where);
  if (where.size === 0 || received >= where.size) {
    transfer.report(received, received);
    return;
  }
  if (received === have) {
    throw new DownloadFailureError(`The source stopped sending the file (${String(received)} of ${String(where.size)} bytes)`);
  }
  await downloadFile(transfer);
}

function ffmpegHeaders(headers: Readonly<Record<string, string>>): readonly string[] {
  const lines = Object.entries(headers).map(([name, value]) => `${name}: ${value}\r\n`).join("");
  return lines === "" ? [] : ["-headers", lines];
}

function hlsArgs(transfer: Transfer): readonly string[] {
  return [
    "-nostdin", "-hide_banner", "-loglevel", "info", "-nostats", "-y",
    "-protocol_whitelist", "http,https,tcp,tls,crypto",
    ...ffmpegHeaders(transfer.job.headers),
    "-i", transfer.job.url,
    // Default stream selection keeps the best video and audio of a multi-variant playlist.
    "-sn", "-dn", "-c", "copy", "-bsf:a", "aac_adtstoasc",
    "-progress", "pipe:1", "-f", "mp4", transfer.part,
  ];
}

function seconds(value: string): number {
  const [hours = "0", minutes = "0", rest = "0"] = value.split(":");
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(rest);
}

/** Reads ffmpeg's `-progress` lines, estimating the size from how much of the duration is done. */
async function readProgress(stdout: ReadableStream<Uint8Array>, duration: () => number, report: ProgressReport): Promise<void> {
  let outSeconds = 0;
  for await (const line of textLines(stdout)) {
    const [key, value = ""] = line.split("=", 2);
    if (key === "out_time_us") {
      outSeconds = Number(value) / 1_000_000;
    } else if (key === "total_size") {
      const bytes = Number(value);
      const fraction = duration() > 0 ? Math.min(outSeconds / duration(), 0.999) : 0;
      report(bytes, fraction > 0.01 ? Math.round(bytes / fraction) : 0);
    }
  }
}

/** A process pipe's output, one trimmed line at a time. */
async function* textLines(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of stream) {
    buffer += decoder.decode(chunk, { stream: true });
    const complete = buffer.split(/\r?\n|\r/u);
    buffer = complete.pop() ?? "";
    yield* complete.map((line) => line.trim());
  }
  yield buffer.trim();
}

async function readLog(stderr: ReadableStream<Uint8Array>, onDuration: (seconds: number) => void): Promise<string> {
  let tail = "";
  for await (const line of textLines(stderr)) {
    const duration = /Duration: (?<time>\d+:\d+:[\d.]+)/u.exec(line)?.groups?.["time"];
    if (duration !== undefined) {
      onDuration(seconds(duration));
    }
    tail = `${tail}\n${line}`.slice(-2000);
  }
  return tail;
}

function lastError(log: string): string {
  const line = log.split("\n").map((entry) => entry.trim()).findLast((entry) => entry !== "");
  return line === undefined ? "ffmpeg could not read the stream" : `ffmpeg: ${line.slice(0, 300)}`;
}

/** Copies an HLS stream into one MP4. A paused stream starts over when resumed. */
export async function downloadHls(transfer: Transfer): Promise<void> {
  await unlink(transfer.part).catch(() => undefined);
  const process = Bun.spawn(["ffmpeg", ...hlsArgs(transfer)], { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const stop = (): void => { void stopHlsProcess(process, 2000); };
  transfer.signal.addEventListener("abort", stop, { once: true });
  let duration = 0;
  const [, log, code] = await Promise.all([
    readProgress(process.stdout, () => duration, transfer.report),
    readLog(process.stderr, (value) => { duration = value; }),
    process.exited,
  ]);
  transfer.signal.removeEventListener("abort", stop);
  transfer.signal.throwIfAborted();
  if (code !== 0) {
    throw new DownloadFailureError(lastError(log));
  }
  const size = await existingBytes(transfer.part);
  transfer.report(size, size);
}
