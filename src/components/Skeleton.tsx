import { cn } from "../lib/utils.ts";

const CARD_KEYS = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"] as const;
const ROW_KEYS = ["one", "two", "three", "four"] as const;

function Skeleton({ className }: { readonly className: string }): React.JSX.Element {
  return <span aria-hidden="true" className={cn("skeleton block rounded-md", className)} />;
}

export function LibrarySkeleton(): React.JSX.Element {
  return (
    <section aria-busy="true" aria-label="Loading library">
      <span className="sr-only">Loading library…</span>
      <div className="mb-6 space-y-2">
        <Skeleton className="h-7 w-24" />
        <Skeleton className="h-4 w-16" />
      </div>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
        {CARD_KEYS.map((key) => (
          <li key={key} className="overflow-hidden rounded-lg border border-border bg-card">
            <Skeleton className="aspect-[2/3] w-full rounded-none" />
            <span className="block space-y-2 p-3">
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="h-3 w-3/5" />
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ListSkeleton({ rows = 3 }: { readonly rows?: number }): React.JSX.Element {
  return (
    <div aria-busy="true" aria-label="Loading" className="divide-y divide-border">
      <span className="sr-only">Loading…</span>
      {ROW_KEYS.slice(0, rows).map((key) => (
        <div key={key} className="flex items-center gap-3 py-4">
          <Skeleton className="size-10 shrink-0" />
          <span className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-3 w-2/5" />
          </span>
        </div>
      ))}
    </div>
  );
}

export function AppShellSkeleton(): React.JSX.Element {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-[env(safe-area-inset-top)] z-10 flex items-center gap-4 border-b border-border bg-background px-6 py-4">
        <Skeleton className="h-7 w-28 shrink-0" />
        <Skeleton className="h-10 min-w-0 flex-1" />
        <Skeleton className="size-10 shrink-0" />
      </header>
      <main className="mx-auto max-w-7xl px-6 py-6">
        <LibrarySkeleton />
      </main>
    </div>
  );
}

export function SessionSkeleton(): React.JSX.Element {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6">
      <section aria-busy="true" aria-label="Checking session" className="w-full max-w-sm space-y-5 rounded-xl border border-border bg-card p-6">
        <span className="sr-only">Checking session…</span>
        <Skeleton className="mx-auto h-10 w-36" />
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </section>
    </main>
  );
}
