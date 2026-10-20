import { UsersRound } from "lucide-react";
import { useCallback, useState, type ChangeEvent, type FormEvent } from "react";
import { useWatchTogetherContext } from "../hooks/watchTogetherContext.ts";
import { partyInviteLink, partyIdFromInvite } from "../lib/partyInvite.ts";
import { useHeaderPopover } from "../hooks/useHeaderPopover.ts";
import { PartyMembers } from "./PartyMembers.tsx";

function JoinParty({ onJoined }: { readonly onJoined: () => void }): React.JSX.Element {
  const { join, start } = useWatchTogetherContext();
  const [invite, setInvite] = useState("");
  const [error, setError] = useState("");
  const handleInvite = useCallback((event: ChangeEvent<HTMLInputElement>) => setInvite(event.target.value), []);
  const handleSubmit = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const id = partyIdFromInvite(invite, globalThis.location.origin);
    if (id === null) { setError("Paste a party invite link from this server."); return; }
    setError("");
    join.mutate(id, { onSuccess: onJoined });
  }, [invite, join, onJoined]);
  return (
    <form onSubmit={handleSubmit} className="grid gap-3">
      <label className="grid gap-1 text-sm">Party invite link
        <input value={invite} onChange={handleInvite} placeholder="Paste an invite link" required className="rounded border border-border bg-black p-2" />
      </label>
      <button type="submit" disabled={join.isPending || start.isPending} className="rounded border border-border p-2">{join.isPending ? "Joining…" : "Join party"}</button>
      {error !== "" && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </form>
  );
}
function PartyInvite({ id }: { readonly id: string }): React.JSX.Element {
  const [message, setMessage] = useState("");
  const handleCopy = useCallback(async () => {
    try { await navigator.clipboard.writeText(partyInviteLink(id)); setMessage("Invite link copied"); }
    catch { setMessage("Copy the invite link below"); }
  }, [id]);
  return <>
    <button type="button" onClick={handleCopy} className="rounded bg-primary p-2 text-primary-foreground">Copy invite link</button>
    <label className="grid gap-1 text-sm">Invite link<input readOnly value={partyInviteLink(id)} className="rounded border border-border bg-black p-2" /></label>
    {message !== "" && <output className="text-sm">{message}</output>}
  </>;
}
function ActiveParty({ id }: { readonly id: string }): React.JSX.Element {
  const session = useWatchTogetherContext();
  return <>
    <p>{session.host === null ? "Following the host across episodes and shows." : "You control this session."}</p>
    {session.waiting && <p>{session.host === null ? "Waiting for the host to choose an episode…" : "Choose an episode from your library to start watching."}</p>}
    <PartyInvite id={id} />
    <PartyMembers />
    {session.snapshot !== undefined && <p className="text-sm text-muted-foreground">{session.snapshot.state.members} in party · Host: {session.snapshot.state.hostName ?? "Reconnecting…"}</p>}
    <button type="button" onClick={session.handleLeave} className="rounded border border-border p-2">Leave session</button>
    {session.host !== null && <button type="button" disabled={session.end.isPending} onClick={session.handleEnd} className="rounded border border-border p-2">End session</button>}
  </>;
}
export function PartyMenu(): React.JSX.Element {
  const session = useWatchTogetherContext();
  const { id: popupId, triggerRef, panelRef, open, handleBeforeToggle, handleToggle, handleClose } = useHeaderPopover();
  const id = session.host?.id ?? session.guestId;
  const handleCreate = useCallback(() => session.start.mutate(), [session.start]);
  return <>
    <button ref={triggerRef} type="button" aria-label="Party" title="Party" aria-expanded={open} aria-controls={popupId} popoverTarget={popupId} data-active={id !== null} className="header-icon-button">
      <UsersRound className="size-4" />
    </button>
    <div ref={panelRef} id={popupId} popover="auto" onBeforeToggle={handleBeforeToggle} onToggle={handleToggle} aria-label="Party" className="fixed inset-auto m-0 max-h-[75dvh] w-80 max-w-[calc(100vw-1rem)] overflow-y-auto rounded-lg border border-border bg-black p-4 text-sm text-foreground shadow-lg">
      <div className="grid gap-3">
        <div className="flex items-center justify-between"><h2 className="font-semibold">Party</h2><button type="button" onClick={handleClose} aria-label="Close party" className="rounded px-2 py-1 focus-visible:ring-2 focus-visible:ring-primary">Close</button></div>
        <p className="text-muted-foreground">Watch together across episodes and shows.</p>
        {id === null ? <>
          <button type="button" disabled={session.start.isPending || session.join.isPending} onClick={handleCreate} className="rounded bg-primary p-2 text-primary-foreground">{session.start.isPending ? "Creating…" : "Create party"}</button>
          <JoinParty onJoined={handleClose} />
        </> : <ActiveParty id={id} />}
        {session.error !== null && <p role="alert" className="text-sm text-destructive">{session.error.message}</p>}
      </div>
    </div>
  </>;
}
