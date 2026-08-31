import { useCallback, useEffect } from "react";
import { LogOut, ShieldCheck } from "lucide-react";
import { useLogout } from "../hooks/useAuth.ts";
import type { AuthUser } from "../types.ts";
import { LinkedAccounts } from "./LinkedAccounts.tsx";
import { MediaHeader } from "./MediaHeader.tsx";
import { PlaybackPreferences } from "./PlaybackPreferences.tsx";
import { PlaybackHistory } from "./PlaybackHistory.tsx";
import { LibraryActivity } from "./LibraryActivity.tsx";
import { OfflineDownloads } from "./OfflineDownloads.tsx";

export function ProfileApp({ user }: { readonly user: AuthUser }): React.JSX.Element {
  const logout = useLogout();
  useEffect(() => {
    if (globalThis.location.hash === "#offline-downloads") {
      document.querySelector("#offline-downloads")?.scrollIntoView({ behavior: "smooth" });
    }
  }, []);
  const handleLogout = useCallback(() => logout.mutate(), [logout]);
  const initial = user.username.trim().slice(0, 1).toLocaleUpperCase();
  return (
    <div className="min-h-screen bg-background text-foreground">
      <MediaHeader user={user} view="profile" />
      <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        <header className="mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary text-xl font-bold text-primary-foreground sm:size-14">
              {initial}
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-2xl font-bold tracking-tight sm:text-3xl">{user.username}</h1>
                {user.isAdmin && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
                    <ShieldCheck className="size-3" aria-hidden="true" />
                    Admin
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-sm text-muted-foreground">Profile and device settings</p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            disabled={logout.isPending}
            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-border bg-card px-4 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-60 sm:w-auto"
          >
            <LogOut className="size-4" />
            Sign out
          </button>
        </header>
        {logout.status === "error" && (
          <p className="mb-5 select-text rounded-lg border border-destructive px-4 py-3 text-sm text-destructive">{logout.error.message}</p>
        )}
        <div className="grid items-start gap-5 lg:grid-cols-12 lg:gap-6">
          <PlaybackPreferences user={user} className="lg:col-span-7" />
          <LinkedAccounts className="lg:col-span-5" />
          <OfflineDownloads className="lg:col-span-12" />
          <PlaybackHistory className={user.isAdmin ? "lg:col-span-7" : "lg:col-span-12"} />
          {user.isAdmin && <LibraryActivity className="lg:col-span-5" />}
        </div>
      </main>
    </div>
  );
}
