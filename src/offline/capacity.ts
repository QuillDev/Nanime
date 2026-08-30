import type { OfflineStorageEstimate } from "./types.ts";

function finiteStorageValue(value: number | undefined): number | null {
  return value === undefined || !Number.isFinite(value) ? null : Math.max(0, value);
}

export async function prepareOfflineStorage(
  requiredBytes: number,
  manager: StorageManager | undefined = globalThis.navigator?.storage,
): Promise<OfflineStorageEstimate> {
  if (manager === undefined) {
    return {
      availableBytes: null,
      persisted: false,
      quotaBytes: null,
      sufficient: null,
      usageBytes: null,
    };
  }
  const [estimate, wasPersisted] = await Promise.all([
    manager.estimate().catch((): StorageEstimate => ({})),
    manager.persisted?.().catch(() => false) ?? Promise.resolve(false),
  ]);
  const persisted = wasPersisted || await (manager.persist?.().catch(() => false) ?? false);
  const quotaBytes = finiteStorageValue(estimate.quota);
  const usageBytes = finiteStorageValue(estimate.usage);
  const availableBytes = quotaBytes === null || usageBytes === null
    ? null
    : Math.max(0, quotaBytes - usageBytes);
  return {
    availableBytes,
    persisted,
    quotaBytes,
    sufficient: availableBytes === null ? null : availableBytes >= Math.max(0, requiredBytes),
    usageBytes,
  };
}
