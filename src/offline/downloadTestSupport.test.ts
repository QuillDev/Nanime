import { inspectOfflineChunks } from "./chunks.ts";
import { isOfflineDownloadAvailable } from "./database.ts";
import type {
  OfflineChunkWrite,
  OfflineDownload,
  OfflineDownloadStore,
  OfflineProfile,
} from "./types.ts";

export class MemoryOfflineStore implements OfflineDownloadStore {
  readonly downloads = new Map<string, OfflineDownload>();
  readonly chunks = new Map<string, ArrayBuffer>();
  readonly profiles = new Map<number, OfflineProfile>();

  findDownload(userId: number, rel: string): Promise<OfflineDownload | null> {
    return Promise.resolve(
      [...this.downloads.values()].find((item) => item.userId === userId && item.rel === rel) ?? null,
    );
  }

  async completeDownload(transition: {
    readonly downloadId: string;
    readonly sourceUrl: string;
    readonly totalBytes: number;
    readonly updatedAt: number;
  }): Promise<OfflineDownload> {
    const current = this.downloads.get(transition.downloadId);
    if (current === undefined || current.sourceUrl !== transition.sourceUrl ||
      current.totalBytes !== transition.totalBytes) {
      throw new Error("Offline download was removed or replaced before completion");
    }
    const inventory = inspectOfflineChunks(
      await this.listChunkMetadata(current.id), current.totalBytes);
    if (inventory.missing.length > 0 || inventory.invalid.length > 0) {
      throw new Error("Offline media download is missing stored chunks");
    }
    const complete = {
      ...current,
      state: "complete" as const,
      downloadedBytes: inventory.downloadedBytes,
      updatedAt: transition.updatedAt,
      error: null,
    };
    this.downloads.set(complete.id, complete);
    return complete;
  }

  failDownload(transition: {
    readonly downloadId: string;
    readonly sourceUrl: string;
    readonly totalBytes: number;
    readonly updatedAt: number;
    readonly error: string;
    readonly state: "failed" | "paused";
  }): Promise<OfflineDownload | null> {
    const current = this.downloads.get(transition.downloadId);
    if (current === undefined || current.sourceUrl !== transition.sourceUrl ||
      current.totalBytes !== transition.totalBytes) {
      return Promise.resolve(null);
    }
    const failed = { ...current, ...transition, id: current.id };
    this.downloads.set(failed.id, failed);
    return Promise.resolve(failed);
  }

  getChunk(downloadId: string, index: number): Promise<ArrayBuffer | null> {
    return Promise.resolve(this.chunks.get(`${downloadId}:${String(index)}`) ?? null);
  }

  listChunkMetadata(downloadId: string) {
    const prefix = `${downloadId}:`;
    return Promise.resolve([...this.chunks.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, bytes]) => ({
        downloadId,
        index: Number(key.slice(prefix.length)),
        byteLength: bytes.byteLength,
      })));
  }

  listDownloads(userId: number, completedOnly = false): Promise<readonly OfflineDownload[]> {
    return Promise.resolve([...this.downloads.values()].filter((item) => (
      item.userId === userId && (!completedOnly || isOfflineDownloadAvailable(item))
    )));
  }

  putDownload(download: OfflineDownload): Promise<void> {
    this.downloads.set(download.id, download);
    return Promise.resolve();
  }

  putProfile(profile: OfflineProfile): Promise<void> {
    this.profiles.set(profile.user.id, profile);
    return Promise.resolve();
  }

  getProfile(userId: number): Promise<OfflineProfile | null> {
    return Promise.resolve(this.profiles.get(userId) ?? null);
  }

  getLatestProfile(): Promise<OfflineProfile | null> {
    const [latest] = [...this.profiles.values()]
      .toSorted((left, right) => right.updatedAt - left.updatedAt);
    return Promise.resolve(latest ?? null);
  }

  setActiveProfile(userId: number | null): Promise<void> {
    for (const [id, profile] of this.profiles) {
      this.profiles.set(id, { ...profile, active: id === userId });
    }
    return Promise.resolve();
  }

  removeDownload(downloadId: string): Promise<void> {
    this.downloads.delete(downloadId);
    return this.removeChunks(downloadId, this.chunkIndexes(downloadId));
  }

  removeChunks(downloadId: string, indexes: readonly number[]): Promise<void> {
    for (const index of indexes) {
      this.chunks.delete(`${downloadId}:${String(index)}`);
    }
    return Promise.resolve();
  }

  writeChunk(write: OfflineChunkWrite): Promise<OfflineDownload> {
    const current = validatedDownload(this.downloads, write);
    const key = `${write.downloadId}:${String(write.index)}`;
    const previousBytes = this.chunks.get(key)?.byteLength ?? 0;
    const next = {
      ...current,
      sourceVersion: current.sourceVersion ?? write.sourceVersion,
      downloadedBytes: current.downloadedBytes - previousBytes + write.bytes.byteLength,
      updatedAt: write.updatedAt,
    };
    this.chunks.set(key, write.bytes);
    this.downloads.set(next.id, next);
    return Promise.resolve(next);
  }

  private chunkIndexes(downloadId: string): readonly number[] {
    const prefix = `${downloadId}:`;
    return [...this.chunks.keys()]
      .filter((key) => key.startsWith(prefix))
      .map((key) => Number(key.slice(prefix.length)));
  }
}

function validatedDownload(
  downloads: ReadonlyMap<string, OfflineDownload>,
  write: OfflineChunkWrite,
): OfflineDownload {
  const current = downloads.get(write.downloadId);
  if (current === undefined) {
    throw new Error("Offline download record is missing");
  }
  if (current.sourceVersion !== null && write.sourceVersion !== null &&
    current.sourceVersion !== write.sourceVersion) {
    throw new Error("Offline media changed during the download");
  }
  return current;
}
