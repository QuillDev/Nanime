import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "../lib/utils.ts";
import { MediaThumbnail } from "./MediaThumbnail.tsx";

interface ProfileSectionProps {
  readonly children: ReactNode;
  readonly className?: string | undefined;
  readonly defaultOpen?: boolean;
  readonly id: string;
  readonly summary?: ReactNode;
  readonly title: string;
}

/** A collapsible profile row: title on the left, its current value on the right. */
export function ProfileSection({
  children,
  className,
  defaultOpen = false,
  id,
  summary,
  title,
}: ProfileSectionProps): React.JSX.Element {
  return (
    <details
      id={id}
      open={defaultOpen}
      className={cn("group/section scroll-mt-24 border-b border-border first:border-t", className)}
    >
      <summary className="flex cursor-pointer list-none items-center gap-3 py-4 outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-open/section:rotate-90" aria-hidden="true" />
        <h2 className="flex-1 font-display text-lg font-bold tracking-tight">{title}</h2>
        {summary !== undefined && (
          <span className="min-w-0 truncate text-sm text-muted-foreground">{summary}</span>
        )}
      </summary>
      <div className="pb-5 pl-7">{children}</div>
    </details>
  );
}

interface ProfileSettingProps {
  readonly children: ReactNode;
  readonly label: string;
}

export function ProfileSetting({ children, label }: ProfileSettingProps): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-2.5">
      <p className="text-sm">{label}</p>
      {children}
    </div>
  );
}

interface ProfileSwitchProps {
  readonly checked: boolean;
  readonly label: string;
  readonly onToggle: () => void;
}

export function ProfileSwitch({ checked, label, onToggle }: ProfileSwitchProps): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onToggle}
      className="group relative block h-6 w-10 shrink-0 rounded-full bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-checked:bg-primary"
    >
      <span className="absolute left-0.75 top-0.75 size-4.5 rounded-full bg-white shadow-sm transition-transform group-aria-checked:translate-x-4" />
    </button>
  );
}

export function ProfileEmptyState({ children }: { readonly children: ReactNode }): React.JSX.Element {
  return <p className="py-2 text-sm text-muted-foreground">{children}</p>;
}

interface ProfileMediaRowProps {
  readonly children: ReactNode;
  readonly rel: string;
  readonly thumbnail: string | null;
}

/** Episode thumbnail followed by the row's text and trailing action. */
export function ProfileMediaRow({ children, rel, thumbnail }: ProfileMediaRowProps): React.JSX.Element {
  return (
    <li className="flex items-center gap-3.5 py-2">
      <span className="w-20 shrink-0 overflow-hidden rounded-md sm:w-24">
        <MediaThumbnail rel={rel} source={thumbnail} className="w-full" />
      </span>
      {children}
    </li>
  );
}
