import { useCallback } from "react";
import { ExternalLink } from "lucide-react";
import aniListLogo from "../assets/anilist-logo.svg";
import type { AniListAccountStatus } from "../types.ts";
import {
  useAniListAccount,
  useDisconnectAniList,
} from "../hooks/useAniListAccount.ts";
import { ProfileEmptyState, ProfileSection } from "./ProfileSection.tsx";

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
    <div className="flex items-center gap-3 py-1">
      {account.avatarUrl !== null && (
        <img src={account.avatarUrl} alt="" className="size-9 rounded-full object-cover" />
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
    return <ProfileEmptyState>Loading…</ProfileEmptyState>;
  }
  if (status === "error") {
    return <p className="select-text py-2 text-sm text-destructive">{error?.message}</p>;
  }
  if (account?.configured !== true) {
    return <ProfileEmptyState>AniList is not configured.</ProfileEmptyState>;
  }
  if (!account.connected || account.account === null) {
    return (
      <a href="/api/auth/anilist/start" className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground">
        <img src={aniListLogo} alt="" className="size-5" />
        Connect AniList
      </a>
    );
  }
  return <ConnectedAccount account={account.account} disconnecting={disconnecting} onDisconnect={onDisconnect} />;
}

function accountSummary(account: AniListAccountStatus | undefined): string | undefined {
  if (account?.configured !== true) {
    return undefined;
  }
  return account.account?.name ?? "Not connected";
}

export function LinkedAccounts(): React.JSX.Element {
  const account = useAniListAccount();
  const disconnect = useDisconnectAniList();
  const handleDisconnect = useCallback(() => disconnect.mutate(), [disconnect]);

  return (
    <ProfileSection id="linked-accounts" title="AniList" summary={accountSummary(account.data)}>
      <LinkedAccountState account={account.data} error={account.error} status={account.status} disconnecting={disconnect.isPending} onDisconnect={handleDisconnect} />
      {disconnect.status === "error" && (
        <p className="select-text pt-2 text-sm text-destructive">{disconnect.error.message}</p>
      )}
    </ProfileSection>
  );
}
