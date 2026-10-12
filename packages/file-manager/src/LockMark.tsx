import { WidgetRole } from "./aria.js";
import { LockIcon } from "./icons.js";
import type { ItemLock } from "./types.js";

export interface LockMarkProps {
  readonly lock: ItemLock | null;
}

export function LockMark({ lock }: LockMarkProps) {
  if (lock === null) {
    return null;
  }
  return (
    <span className="nfm-lock" data-tone={lock.tone ?? "locked"} title={lock.reason} aria-label={lock.reason} role={WidgetRole.image}>
      {lock.tone === "busy" ? <span className="nfm-pulse" /> : <LockIcon />}
    </span>
  );
}
