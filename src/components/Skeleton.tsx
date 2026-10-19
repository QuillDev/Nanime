import { cn } from "../lib/utils.ts";
import { BrandLogo } from "./BrandLogo.tsx";

const ROW_KEYS = ["one", "two", "three", "four", "five", "six"] as const;
const NAV_KEYS = ["library", "admin", "party", "profile"] as const;

/** One shimmering placeholder shape. */
export function Bone({ className }: { readonly className: string }): React.JSX.Element {
  return <span aria-hidden="true" className={cn("skeleton block rounded-md", className)} />;
}

/** A text placeholder exactly one line tall in the given type style, so it takes the real text's space. */
export function TextBone({ type, width }: { readonly type: string; readonly width: string }): React.JSX.Element {
  return (
    <span aria-hidden="true" className={cn("flex h-[1lh] items-center", type)}>
      <span className={cn("skeleton block h-[0.8em] rounded-md", width)} />
    </span>
  );
}

/** A banner placeholder: a dim shimmer under the same gradient the real banner uses. */
export function BannerBone({ gradient }: { readonly gradient: string }): React.JSX.Element {
  return (
    <>
      <span aria-hidden="true" className="skeleton absolute inset-0 opacity-60" />
      <span aria-hidden="true" className={cn("absolute inset-0", gradient)} />
    </>
  );
}

/** The real header's frame and logo, with placeholders where search and account controls go. */
export function HeaderSkeleton({ overlay = false, search = true }: {
  readonly overlay?: boolean;
  readonly search?: boolean;
}): React.JSX.Element {
  return (
    <header
      className={cn(
        "sticky top-[env(safe-area-inset-top)] z-10 flex h-[var(--header-height)] items-center gap-2 border-b px-4 sm:gap-4 sm:px-6",
        overlay ? "border-transparent bg-[linear-gradient(180deg,rgb(0_0_0/0.55),transparent)] bg-origin-border" : "border-border bg-background",
      )}
    >
      <BrandLogo className="h-7 w-auto shrink-0" />
      {search && <Bone className="library-search h-10 rounded-full" />}
      <div className="mobile-account-controls ml-auto">
        {NAV_KEYS.map((key) => (
          <span key={key} className="mobile-nav-item">
            <Bone className="size-4 shrink-0" />
            <span className="mobile-nav-label">
              <Bone className="inline-block h-3.5 w-12 align-middle" />
            </span>
          </span>
        ))}
      </div>
    </header>
  );
}

export function ListSkeleton({ rows = 3 }: { readonly rows?: number }): React.JSX.Element {
  return (
    <div aria-busy="true" aria-label="Loading" className="divide-y divide-border">
      <span className="sr-only">Loading…</span>
      {ROW_KEYS.slice(0, rows).map((key) => (
        <div key={key} className="flex items-center gap-3 py-4">
          <Bone className="size-10 shrink-0" />
          <span className="min-w-0 flex-1 space-y-2">
            <Bone className="h-4 w-3/5" />
            <Bone className="h-3 w-2/5" />
          </span>
        </div>
      ))}
    </div>
  );
}
