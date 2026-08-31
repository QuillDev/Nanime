import { useCallback } from "react";
import { ExternalLink, Link2 } from "lucide-react";
import aniListLogo from "../assets/anilist-logo.svg";
import type { AniListAccountStatus } from "../types.ts";
import {
  useAniListAccount,
  useDisconnectAniList,
} from "../hooks/useAniListAccount.ts";
import { ListSkeleton } from "./Skeleton.tsx";
import { ProfileSection } from "./ProfileSection.tsx";

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
    <div className="flex items-center gap-3 px-4 py-4 sm:px-5">
      {account.avatarUrl !== null && (
        <img src={account.avatarUrl} alt="" className="size-12 rounded-full object-cover" />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{account.name}</p>
        <a href={`https://anilist.co/user/${encodeURIComponent(account.name)}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
          View profile
          <ExternalLink className="size-3" />
        </a>
      </div>
      <button type="button" onClick={onDisconnect} disabled={disconnecting} className="shrink-0 rounded-md px-2 py-1.5 text-sm font-medium text-destructive hover:bg-accent disabled:text-muted-foreground">
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
    return <div className="px-4 sm:px-5"><ListSkeleton rows={1} /></div>;
  }
  if (status === "error") {
    return <p className="select-text px-4 py-5 text-sm text-destructive sm:px-5">{error?.message}</p>;
  }
  if (account?.configured !== true) {
    return <p className="px-4 py-6 text-sm text-muted-foreground sm:px-5">AniList is not configured.</p>;
  }
  if (!account.connected || account.account === null) {
    return (
      <div className="px-4 py-5 sm:px-5">
        <a href="/api/auth/anilist/start" className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground sm:w-auto">
          <img src={aniListLogo} alt="" className="size-5" />
          Connect AniList
        </a>
      </div>
    );
  }
  return <ConnectedAccount account={account.account} disconnecting={disconnecting} onDisconnect={onDisconnect} />;
}

export function LinkedAccounts({ className }: { readonly className?: string }): React.JSX.Element {
  const account = useAniListAccount();
  const disconnect = useDisconnectAniList();
  const handleDisconnect = useCallback(() => disconnect.mutate(), [disconnect]);

  return (
    <ProfileSection
      className={className}
      description="Sync watched progress and scores."
      icon={Link2}
      id="linked-accounts-title"
      title="Connected accounts"
    >
      <div className="flex items-center gap-3 border-b border-border px-4 py-3 sm:px-5">
        <span className="rounded-md bg-black p-1"><img src={aniListLogo} alt="" className="size-6" /></span>
        <h3 className="text-sm font-medium">AniList</h3>
      </div>
        <LinkedAccountState account={account.data} error={account.error} status={account.status} disconnecting={disconnect.isPending} onDisconnect={handleDisconnect} />
        {disconnect.status === "error" && (
          <p className="select-text border-t border-border px-4 py-3 text-sm text-destructive sm:px-5">{disconnect.error.message}</p>
        )}
    </ProfileSection>
  );
}
