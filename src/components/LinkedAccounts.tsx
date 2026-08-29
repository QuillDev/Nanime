import { useCallback } from "react";
import { ExternalLink } from "lucide-react";
import aniListLogo from "../assets/anilist-logo.svg";
import type { AniListAccountStatus } from "../types.ts";
import {
  useAniListAccount,
  useDisconnectAniList,
} from "../hooks/useAniListAccount.ts";
import { ListSkeleton } from "./Skeleton.tsx";

interface LinkedAccountStateProps {
  readonly account: AniListAccountStatus | undefined;
  readonly error: Error | null;
  readonly status: "error" | "pending" | "success";
  readonly disconnecting: boolean;
  readonly onDisconnect: () => void;
}

function ConnectedAccount({
  account,
  disconnecting,
  onDisconnect,
}: {
  readonly account: NonNullable<AniListAccountStatus["account"]>;
  readonly disconnecting: boolean;
  readonly onDisconnect: () => void;
}): React.JSX.Element {
  return (
    <div className="mt-4 flex items-center gap-4">
      {account.avatarUrl !== null && (
        <img src={account.avatarUrl} alt="" className="size-12 rounded-full object-cover" />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">{account.name}</p>
        <a href={`https://anilist.co/user/${encodeURIComponent(account.name)}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
          View profile
          <ExternalLink className="size-3" />
        </a>
      </div>
      <button type="button" onClick={onDisconnect} disabled={disconnecting} className="text-sm font-medium text-destructive disabled:text-muted-foreground">
        Disconnect
      </button>
    </div>
  );
}

function LinkedAccountState({
  account,
  error,
  status,
  disconnecting,
  onDisconnect,
}: LinkedAccountStateProps): React.JSX.Element {
  if (status === "pending") {
    return <ListSkeleton rows={1} />;
  }
  if (status === "error") {
    return <p className="mt-4 select-text text-sm text-destructive">{error?.message}</p>;
  }
  if (account?.configured !== true) {
    return <p className="mt-4 text-sm text-muted-foreground">AniList OAuth has not been configured by the server administrator.</p>;
  }
  if (!account.connected || account.account === null) {
    return (
      <a href="/api/auth/anilist/start" className="mt-4 inline-flex w-fit items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">
        <img src={aniListLogo} alt="" className="size-5" />
        Connect AniList
      </a>
    );
  }
  return <ConnectedAccount account={account.account} disconnecting={disconnecting} onDisconnect={onDisconnect} />;
}

export function LinkedAccounts(): React.JSX.Element {
  const account = useAniListAccount();
  const disconnect = useDisconnectAniList();
  const handleDisconnect = useCallback(() => disconnect.mutate(), [disconnect]);

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
        <LinkedAccountState account={account.data} error={account.error} status={account.status} disconnecting={disconnect.isPending} onDisconnect={handleDisconnect} />
        {disconnect.status === "error" && (
          <p className="mt-4 select-text text-sm text-destructive">{disconnect.error.message}</p>
        )}
      </div>
    </section>
  );
}
