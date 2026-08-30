import type { OfflineDownload, OfflineMediaFetcher } from "./types.ts";

export const OFFLINE_MEDIA_CHUNK_BYTES = 4 * 1024 * 1024;
export const OFFLINE_MEDIA_PARALLEL_REQUESTS = 4;

interface ResponseRange {
  readonly end: number;
  readonly start: number;
  readonly total: number;
}

export interface OfflineMediaPart {
  readonly bytes: Uint8Array;
  readonly end: number;
  readonly start: number;
  readonly version: string | null;
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
    (download.sourceVersion === null || version === null || version === download.sourceVersion);
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
  if (!matchingRangeResponse({ download, end, response, start })) {
    throw new Error("Offline media changed while the download was paused");
  }
  if (!response.ok || response.body === null) {
    throw new Error(`Offline media download failed with HTTP ${String(response.status)}`);
  }
  return response.headers.get("etag") ?? download.sourceVersion;
}

async function fetchMediaPart(options: {
  readonly download: OfflineDownload;
  readonly end: number;
  readonly request: OfflineMediaFetcher;
  readonly signal: AbortSignal | undefined;
  readonly start: number;
}): Promise<OfflineMediaPart> {
  const { download, end, request, signal, start } = options;
  const response = await request(
    download.sourceUrl,
    mediaRequestInit({ download, end, signal, start }),
  );
  const version = validateMediaResponse({ download, end, response, start });
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength !== end - start + 1) {
    throw new Error("Offline media range returned an unexpected number of bytes");
  }
  return { bytes, end, start, version };
}

function mediaPartRanges(download: OfflineDownload): readonly ResponseRange[] {
  const ranges: ResponseRange[] = [];
  let start = download.downloadedBytes;
  while (start < download.totalBytes && ranges.length < OFFLINE_MEDIA_PARALLEL_REQUESTS) {
    const chunkEnd = (Math.floor(start / OFFLINE_MEDIA_CHUNK_BYTES) + 1) *
      OFFLINE_MEDIA_CHUNK_BYTES - 1;
    const end = Math.min(chunkEnd, download.totalBytes - 1);
    ranges.push({ start, end, total: download.totalBytes });
    start = end + 1;
  }
  return ranges;
}

export function offlineMediaPartVersion(
  parts: readonly OfflineMediaPart[],
  current: string | null,
): string | null {
  const versions = new Set(parts.flatMap((part) => part.version === null ? [] : [part.version]));
  if (versions.size > 1) {
    throw new Error("Offline media changed during the download");
  }
  return versions.values().next().value ?? current;
}

export function fetchOfflineMediaParts(options: {
  readonly download: OfflineDownload;
  readonly request: OfflineMediaFetcher;
  readonly signal: AbortSignal | undefined;
}): Promise<readonly OfflineMediaPart[]> {
  const { download, request, signal } = options;
  return Promise.all(mediaPartRanges(download).map(({ start, end }) => (
    fetchMediaPart({ download, end, request, signal, start })
  )));
}
