import { useCallback } from "react";
import { LogOut } from "lucide-react";
import { useLogout } from "../hooks/useAuth.ts";
import { useAniListAccount } from "../hooks/useAniListAccount.ts";
import { cn } from "../lib/utils.ts";
import type { AuthUser } from "../types.ts";
import { artSources } from "../lib/art.ts";

function Avatar({ avatarUrl, username }: { readonly avatarUrl: string | null; readonly username: string }): React.JSX.Element {
  const className = "size-20 shrink-0 rounded-full border-4 border-background sm:size-24";
  if (avatarUrl !== null) {
    return <img src={avatarUrl} alt="" className={cn(className, "object-cover")} />;
  }
  return (
    <span aria-hidden="true" className={cn(className, "flex items-center justify-center bg-primary font-display text-3xl font-extrabold text-primary-foreground")}>
      {username.trim().slice(0, 1).toLocaleUpperCase()}
    </span>
  );
}

function SignOut(): React.JSX.Element {
  const logout = useLogout();
  const handleLogout = useCallback(() => logout.mutate(), [logout]);
  return (
    <div className="flex flex-col items-end gap-1 pb-2">
      <button
        type="button"
        onClick={handleLogout}
        disabled={logout.isPending}
        className="inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-60"
      >
        <LogOut className="size-4" />
        <span className="hidden sm:inline">Sign out</span>
      </button>
      {logout.status === "error" && <p className="select-text text-xs text-destructive">{logout.error.message}</p>}
    </div>
  );
}

/** Banner from the latest watched show, with the account's identity over its lower edge. */
export function ProfileHero({ banner, user }: { readonly banner: string | null; readonly user: AuthUser }): React.JSX.Element {
  const aniList = useAniListAccount();
  const account = aniList.data?.account ?? null;
  const details = [user.isAdmin ? "Admin" : null, account === null ? null : `AniList ${account.name}`]
    .filter((part) => part !== null)
    .join(" · ");
  return (
    <header className="relative">
      <div className="relative h-44 overflow-hidden sm:h-64">
        {banner !== null && (
          <img src={artSources(banner, "banner").src} srcSet={artSources(banner, "banner").srcSet} sizes="100vw" alt="" className="absolute inset-0 size-full object-cover object-[50%_30%]" />
        )}
        <span aria-hidden="true" className="absolute inset-0 bg-[linear-gradient(0deg,rgb(0_0_0)_4%,rgb(0_0_0/0.55)_55%,rgb(0_0_0/0.25)),linear-gradient(90deg,rgb(0_0_0/0.75),transparent_60%)]" />
      </div>
      <div className="relative mx-auto -mt-20 flex w-full max-w-5xl items-end gap-4 px-4 sm:-mt-24 sm:gap-5 sm:px-6 lg:px-8">
        <Avatar avatarUrl={account?.avatarUrl ?? null} username={user.username} />
        <div className="min-w-0 flex-1 pb-1.5">
          <h1 className="truncate font-display text-3xl font-extrabold leading-none tracking-tight sm:text-5xl">{user.username}</h1>
          {details !== "" && <p className="mt-1.5 truncate text-sm text-muted-foreground">{details}</p>}
        </div>
        <SignOut />
      </div>
    </header>
  );
}
