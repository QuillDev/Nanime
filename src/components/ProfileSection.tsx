import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../lib/utils.ts";

interface ProfileSectionProps {
  readonly children: ReactNode;
  readonly className?: string | undefined;
  readonly description?: ReactNode;
  readonly icon: LucideIcon;
  readonly id: string;
  readonly title: string;
}

export function ProfileSection({
  children,
  className,
  description,
  icon: Icon,
  id,
  title,
}: ProfileSectionProps): React.JSX.Element {
  return (
    <section
      className={cn("overflow-hidden rounded-xl border border-border bg-card", className)}
      aria-labelledby={id}
    >
      <header className="flex items-start gap-3 border-b border-border px-4 py-4 sm:px-5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-primary">
          <Icon className="size-4.5" aria-hidden="true" />
        </span>
        <div className="min-w-0 pt-0.5">
          <h2 id={id} className="font-semibold tracking-tight">{title}</h2>
          {description !== undefined && (
            <div className="mt-0.5 text-sm leading-5 text-muted-foreground">{description}</div>
          )}
        </div>
      </header>
      {children}
    </section>
  );
}

interface ProfileSettingProps {
  readonly children: ReactNode;
  readonly description?: string;
  readonly label: string;
}

export function ProfileSetting({
  children,
  description,
  label,
}: ProfileSettingProps): React.JSX.Element {
  return (
    <div className="grid gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-6 sm:px-5">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        {description !== undefined && (
          <p className="mt-0.5 text-sm leading-5 text-muted-foreground">{description}</p>
        )}
      </div>
      <div className="w-full sm:w-auto">{children}</div>
    </div>
  );
}

export function ProfileEmptyState({ children }: { readonly children: ReactNode }): React.JSX.Element {
  return <p className="px-4 py-8 text-center text-sm text-muted-foreground sm:px-5">{children}</p>;
}
