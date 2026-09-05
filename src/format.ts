export function formatDuration(seconds: number): string {
  const wholeMinutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  if (wholeMinutes < 60) {
    return `${String(wholeMinutes)}:${String(remainingSeconds).padStart(2, "0")}`;
  }
  const hours = Math.floor(wholeMinutes / 60);
  const minutes = wholeMinutes % 60;
  return `${String(hours)}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
}

export function formatSize(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"] as const;
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const unit = units[unitIndex] ?? "B";
  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${unit}`;
}

const COMPACT_COUNT_SUFFIXES = ["", "k", "m", "b", "t"] as const;

interface CompactCount {
  readonly unitIndex: number;
  readonly value: number;
}

function scaleCompactCount(count: number): CompactCount {
  let value = count;
  let unitIndex = 0;
  while (value >= 1000 && unitIndex < COMPACT_COUNT_SUFFIXES.length - 1) {
    value /= 1000;
    unitIndex += 1;
  }
  return { unitIndex, value };
}

function roundedCompactCount(compact: CompactCount): CompactCount {
  const rounded = compact.value < 10
    ? Math.round(compact.value * 10) / 10
    : Math.round(compact.value);
  return rounded >= 1000 && compact.unitIndex < COMPACT_COUNT_SUFFIXES.length - 1
    ? { value: rounded / 1000, unitIndex: compact.unitIndex + 1 }
    : { value: rounded, unitIndex: compact.unitIndex };
}

export function formatCompactCount(count: number): string {
  const normalized = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  const compact = scaleCompactCount(normalized);
  if (compact.unitIndex === 0) {
    return String(normalized);
  }
  const rounded = roundedCompactCount(compact);
  return `${String(rounded.value)}${COMPACT_COUNT_SUFFIXES[rounded.unitIndex] ?? ""}`;
}
