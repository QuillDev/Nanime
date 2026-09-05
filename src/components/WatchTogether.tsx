import { EllipsisVertical } from "lucide-react";
import { useCallback, useState, type RefObject } from "react";
import type { useWatchTogether } from "../hooks/useWatchTogether.ts";
import { partyInviteLink as inviteLink } from "../lib/partyInvite.ts";

export { useWatchTogether, useWatchTogetherPosition } from "../hooks/useWatchTogether.ts";

interface Props {
  readonly session: ReturnType<typeof useWatchTogether>;
  readonly videoRef: RefObject<HTMLVideoElement | null>;
}

function guestStatus(session: Props["session"]): string {
  if (session.joining) { return "Connecting to host…"; }
  return session.waiting ? "Waiting for the host to choose an episode…" : "Following the host across episodes and shows.";
}

export function WatchTogether({ session, videoRef }: Props): React.JSX.Element {
  const [message, setMessage] = useState("");
  const hostId = session.host?.id;
  const { mutate: start } = session.start;
  const handleStart = useCallback(() => start(), [start]);
  const handleCopy = useCallback(async () => {
    if (hostId === undefined) { return; }
    try {
      await navigator.clipboard.writeText(inviteLink(hostId));
      setMessage("Invite link copied");
    } catch { setMessage("Copy the invite link below"); }
  }, [hostId]);
  const handleEnable = useCallback(async () => {
    try { await videoRef.current?.play(); }
    catch { setMessage("Playback could not start. Try again when the video is ready."); }
  }, [videoRef]);
  const active = hostId !== undefined || session.guestId !== null;
  return (
    <details className="absolute right-14 top-[max(0.75rem,env(safe-area-inset-top))] z-40 rounded-md bg-black text-sm">
      <summary aria-label="Watch together" className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-md border border-border px-3 focus-visible:ring-2 focus-visible:ring-primary [&::-webkit-details-marker]:hidden">
        {active ? "Watch together" : <EllipsisVertical className="size-5" />}
      </summary>
      <div className="absolute right-0 mt-2 grid w-64 gap-3 rounded-md border border-border bg-black p-4">
        <p>{hostId === undefined ? "Watch together follows the host’s playback." : "You control this session."}</p>
        {!active && <button type="button" disabled={session.start.isPending} onClick={handleStart} className="rounded bg-primary p-2 text-primary-foreground">Start watch together</button>}
        {hostId !== undefined && <>
          <button type="button" onClick={handleCopy} className="rounded bg-primary p-2 text-primary-foreground">Copy invite link</button>
          <label className="grid gap-1">Invite link<input readOnly value={inviteLink(hostId)} className="w-full rounded border border-border bg-black p-2" /></label>
          <p className="text-muted-foreground">Your friend needs an account on this server. Refresh keeps you in the party. Leaving passes hosting to the longest-connected guest; ending closes it for everyone.</p>
        </>}
        {session.guestId !== null && <>
          <p>{guestStatus(session)}</p>
          {!session.waiting && <button type="button" onClick={handleEnable} className="rounded bg-primary p-2 text-primary-foreground">Enable playback</button>}
        </>}
        {active && <button type="button" onClick={session.handleLeave} className="rounded border border-border p-2">Leave session</button>}
        {hostId !== undefined && <button type="button" onClick={session.handleEnd} className="rounded border border-border p-2">End session</button>}
        {session.snapshot !== undefined && <p className="text-muted-foreground">{session.snapshot.state.members} in party · Host: {session.snapshot.state.hostName ?? "Reconnecting…"}</p>}
        {session.error !== null && <p role="alert" className="text-destructive">{session.error.message}</p>}
        {message !== "" && <output>{message}</output>}
      </div>
    </details>
  );
}
