import { offlineChunkRange } from "./chunks.ts";
import type { OfflineDownload, OfflineMediaFetcher } from "./types.ts";

export { OFFLINE_MEDIA_CHUNK_BYTES } from "./chunks.ts";
export { OFFLINE_MEDIA_PARALLEL_REQUESTS } from "./pool.ts";

interface ResponseRange {
  readonly end: number;
  readonly start: number;
  readonly total: number;
}

export interface OfflineMediaPart {
  readonly bytes: Uint8Array;
  readonly end: number;
  readonly start: number;
  readonly index: number;
  readonly version: string | null;
}

export class RetryableOfflineMediaError extends Error {
  override readonly name = "RetryableOfflineMediaError";
}

interface MediaReadState {
  readonly onBytes: ((received: number) => void) | undefined;
  offset: number;
}

function responseRange(response: Response): ResponseRange | null {
  const value = response.headers.get("content-range");
  const match = value === null
    ? null
    : /^bytes (?<start>\d+)-(?<end>\d+)\/(?<total>\d+)$/u.exec(value);
  return match?.groups === undefined
    ? null
    : {
      start: Number(match.groups["start"]),
      end: Number(match.groups["end"]),
      total: Number(match.groups["total"]),
    };
}

function matchingRangeResponse(options: {
  readonly download: OfflineDownload;
  readonly end: number;
  readonly response: Response;
  readonly start: number;
}): boolean {
  const { download, end, response, start } = options;
  const version = response.headers.get("etag");
  const range = responseRange(response);
  return response.status === 206 && range?.start === start && range.end === end &&
    range.total === download.totalBytes &&
    (download.sourceVersion === null || version === download.sourceVersion);
}

function mediaRequestInit(options: {
  readonly download: OfflineDownload;
  readonly end: number;
  readonly signal: AbortSignal | undefined;
  readonly start: number;
}): RequestInit {
  const { download, end, signal, start } = options;
  const headers = new Headers({ range: `bytes=${String(start)}-${String(end)}` });
  if (download.sourceVersion !== null) {
    headers.set("if-range", download.sourceVersion);
  }
  return signal === undefined ? { headers } : { headers, signal };
}

function validateMediaResponse(options: {
  readonly download: OfflineDownload;
  readonly end: number;
  readonly response: Response;
  readonly start: number;
}): string | null {
  const { download, end, response, start } = options;
  if (response.status === 408 || response.status === 429 || response.status >= 500) {
    throw new RetryableOfflineMediaError(
      `Offline media download failed with HTTP ${String(response.status)}`,
    );
  }
  if (!matchingRangeResponse({ download, end, response, start })) {
    throw new Error("Offline media changed while the download was paused");
  }
  if (!response.ok || response.body === null) {
    throw new Error(`Offline media download failed with HTTP ${String(response.status)}`);
  }
  return response.headers.get("etag") ?? download.sourceVersion;
}

async function readMediaBody(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  target: Uint8Array,
  state: MediaReadState,
): Promise<number> {
  const result = await reader.read();
  if (result.done) {
    return state.offset;
  }
  if (state.offset + result.value.byteLength > target.byteLength) {
    throw new Error("Offline media range returned too many bytes");
  }
  target.set(result.value, state.offset);
  state.offset += result.value.byteLength;
  state.onBytes?.(result.value.byteLength);
  return readMediaBody(reader, target, state);
}

async function responseBytes(
  response: Response,
  expectedBytes: number,
  onBytes: ((received: number) => void) | undefined,
): Promise<Uint8Array> {
  if (response.body === null) {
    throw new Error("Offline media response has no body");
  }
  const bytes = new Uint8Array(expectedBytes);
  const received = await readMediaBody(
    response.body.getReader(), bytes, { offset: 0, onBytes });
  if (received !== expectedBytes) {
    throw new Error("Offline media range returned an unexpected number of bytes");
  }
  return bytes;
}

export async function fetchOfflineMediaPart(options: {
  readonly download: OfflineDownload;
  readonly index: number;
  readonly onBytes?: ((received: number) => void) | undefined;
  readonly request: OfflineMediaFetcher;
  readonly signal: AbortSignal | undefined;
}): Promise<OfflineMediaPart> {
  const { download, index, onBytes, request, signal } = options;
  const { end, start } = offlineChunkRange(index, download.totalBytes);
  const response = await request(
    download.sourceUrl,
    mediaRequestInit({ download, end, signal, start }),
  );
  const version = validateMediaResponse({ download, end, response, start });
  const bytes = await responseBytes(response, end - start + 1, onBytes);
  return { bytes, end, index, start, version };
}
