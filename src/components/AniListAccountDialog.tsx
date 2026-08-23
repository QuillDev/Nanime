import { useCallback, useState } from "react";
import { ExternalLink, Link2 } from "lucide-react";
import {
  useAniListAccount,
  useDisconnectAniList,
} from "../hooks/useAniListAccount.ts";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog.tsx";

export function AniListAccountDialog(): React.JSX.Element {
  const [open, setOpen] = useState<boolean>(false);
  const account = useAniListAccount();
  const disconnect = useDisconnectAniList();
  const handleOpen = useCallback(() => setOpen(true), []);
  const handleOpenChange = useCallback((nextOpen: boolean) => setOpen(nextOpen), []);
  const handleDisconnect = useCallback(() => disconnect.mutate(), [disconnect]);
  const accountDetails = account.data?.account;
  const connected = account.data?.connected === true &&
    accountDetails !== undefined && accountDetails !== null;

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
        aria-label="AniList account"
        title="AniList account"
      >
        <Link2 className="size-4" />
      </button>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>AniList account</DialogTitle>
            <DialogDescription>
              Sign in with AniList and keep your watch status, progress, and ratings in sync.
            </DialogDescription>
          </DialogHeader>
          {account.status === "pending" && (
            <p className="text-sm text-muted-foreground">Loading account…</p>
          )}
          {account.status === "error" && (
            <p className="text-sm text-destructive">{account.error.message}</p>
          )}
          {account.status === "success" && !account.data.configured && (
            <p className="text-sm text-muted-foreground">
              AniList OAuth has not been configured by the server administrator.
            </p>
          )}
          {account.status === "success" && account.data.configured && !connected && (
            <a
              href="/api/auth/anilist/start"
              className="inline-flex w-fit items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
            >
              <Link2 className="size-4" />
              Connect AniList
            </a>
          )}
          {connected && accountDetails !== undefined && accountDetails !== null && (
            <div className="flex items-center gap-4 rounded-lg border border-border bg-card p-4">
              {accountDetails.avatarUrl !== null && (
                <img
                  src={accountDetails.avatarUrl}
                  alt=""
                  className="size-12 rounded-full object-cover"
                />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{accountDetails.name}</p>
                <a
                  href={`https://anilist.co/user/${encodeURIComponent(accountDetails.name)}`}
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
            <p className="text-sm text-destructive">{disconnect.error.message}</p>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
