import { useCallback } from "react";
import { ExternalLink } from "lucide-react";
import aniListLogo from "../assets/anilist-logo.svg";
import {
  useAniListAccount,
  useDisconnectAniList,
} from "../hooks/useAniListAccount.ts";
import { ListSkeleton } from "./Skeleton.tsx";

export function LinkedAccounts(): React.JSX.Element {
  const account = useAniListAccount();
  const disconnect = useDisconnectAniList();
  const handleDisconnect = useCallback(() => disconnect.mutate(), [disconnect]);
  const details = account.data?.account;
  const connected = account.data?.connected === true && details !== undefined && details !== null;

  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold">Linked accounts</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Connect services that keep your anime activity in sync.
      </p>
      <div className="mt-4 rounded-lg border border-border bg-card p-5">
        <div className="flex items-center gap-3">
          <span className="rounded-md bg-black p-1">
            <img src={aniListLogo} alt="" className="size-8" />
          </span>
          <h3 className="font-semibold">AniList</h3>
        </div>
        {account.status === "pending" && (
          <ListSkeleton rows={1} />
        )}
        {account.status === "error" && (
          <p className="mt-4 select-text text-sm text-destructive">{account.error.message}</p>
        )}
        {account.status === "success" && !account.data.configured && (
          <p className="mt-4 text-sm text-muted-foreground">
            AniList OAuth has not been configured by the server administrator.
          </p>
        )}
        {account.status === "success" && account.data.configured && !connected && (
          <a
            href="/api/auth/anilist/start"
            className="mt-4 inline-flex w-fit items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
          >
            <img src={aniListLogo} alt="" className="size-5" />
            Connect AniList
          </a>
        )}
        {connected && details !== undefined && details !== null && (
          <div className="mt-4 flex items-center gap-4">
            {details.avatarUrl !== null && (
              <img src={details.avatarUrl} alt="" className="size-12 rounded-full object-cover" />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{details.name}</p>
              <a
                href={`https://anilist.co/user/${encodeURIComponent(details.name)}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
              >
                View profile
                <ExternalLink className="size-3" />
              </a>
            </div>
            <button
              type="button"
              onClick={handleDisconnect}
              disabled={disconnect.isPending}
              className="text-sm font-medium text-destructive disabled:text-muted-foreground"
            >
              Disconnect
            </button>
          </div>
        )}
        {disconnect.status === "error" && (
          <p className="mt-4 select-text text-sm text-destructive">{disconnect.error.message}</p>
        )}
      </div>
    </section>
  );
}
