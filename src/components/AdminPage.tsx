import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

interface AdminPageProps {
  readonly title: string;
  /** Optional primary action shown beside the title. */
  readonly actionLabel?: string;
  readonly actionIcon?: LucideIcon;
  readonly onAction?: () => void;
  readonly children: ReactNode;
}

/** One admin page: a display heading, an optional primary action, then content. */
export function AdminPage({ title, actionLabel, actionIcon: Icon, onAction, children }: AdminPageProps): React.JSX.Element {
  return (
    <section aria-labelledby="admin-page-title" className="min-w-0 flex-1 px-4 py-6 sm:px-8 lg:px-11 lg:py-8">
      <div className="mx-auto max-w-5xl">
        <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <h1 id="admin-page-title" className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">{title}</h1>
          {actionLabel !== undefined && onAction !== undefined && (
            <button type="button" onClick={onAction} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-foreground px-3.5 text-sm font-semibold text-background hover:bg-foreground/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {Icon !== undefined && <Icon aria-hidden="true" className="size-4" />}
              {actionLabel}
            </button>
          )}
        </header>
        {children}
      </div>
    </section>
  );
}
