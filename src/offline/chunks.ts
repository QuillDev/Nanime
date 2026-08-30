import type { OfflineChunkMetadata } from "./types.ts";

export const OFFLINE_MEDIA_CHUNK_BYTES = 4 * 1024 * 1024;

export interface OfflineChunkRange {
  readonly end: number;
  readonly index: number;
  readonly start: number;
}

export interface OfflineChunkInspection {
  readonly downloadedBytes: number;
  readonly invalid: readonly number[];
  readonly missing: readonly number[];
}

interface ChunkPartition {
  readonly invalid: readonly number[];
  readonly valid: ReadonlySet<number>;
}

export function offlineChunkCount(totalBytes: number): number {
  return Math.ceil(totalBytes / OFFLINE_MEDIA_CHUNK_BYTES);
}

export function offlineChunkRange(index: number, totalBytes: number): OfflineChunkRange {
  const start = index * OFFLINE_MEDIA_CHUNK_BYTES;
  return {
    index,
    start,
    end: Math.min(start + OFFLINE_MEDIA_CHUNK_BYTES, totalBytes) - 1,
  };
}

export function expectedOfflineChunkBytes(index: number, totalBytes: number): number {
  const range = offlineChunkRange(index, totalBytes);
  return Math.max(0, range.end - range.start + 1);
}

export function inspectOfflineChunks(
  metadata: readonly OfflineChunkMetadata[],
  totalBytes: number,
): OfflineChunkInspection {
  const expectedCount = offlineChunkCount(totalBytes);
  const { invalid, valid } = partitionChunkMetadata(metadata, totalBytes, expectedCount);
  const missing = Array.from({ length: expectedCount }, (_, index) => index)
    .filter((index) => !valid.has(index));
  const downloadedBytes = [...valid]
    .reduce((total, index) => total + expectedOfflineChunkBytes(index, totalBytes), 0);
  return { downloadedBytes, invalid, missing };
}

function partitionChunkMetadata(
  metadata: readonly OfflineChunkMetadata[],
  totalBytes: number,
  expectedCount: number,
): ChunkPartition {
  const valid = new Set<number>();
  const invalid: number[] = [];
  for (const chunk of metadata) {
    const expected = expectedOfflineChunkBytes(chunk.index, totalBytes);
    if (chunk.index >= 0 && chunk.index < expectedCount && chunk.byteLength === expected) {
      valid.add(chunk.index);
    } else {
      invalid.push(chunk.index);
    }
  }
  return { invalid, valid };
}
