const UNITS = [
  ["year", 31_536_000_000],
  ["month", 2_592_000_000],
  ["week", 604_800_000],
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
] as const;

const format = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

/** "12 minutes ago", "yesterday", "just now". */
export function relativeTime(time: number, now = Date.now()): string {
  const elapsed = now - time;
  const unit = UNITS.find(([, size]) => Math.abs(elapsed) >= size);
  if (unit === undefined) {
    return "just now";
  }
  const [name, size] = unit;
  return format.format(-Math.round(elapsed / size), name);
}
