import { Link, LogOut, X } from "lucide-react";
import { useCallback, useState, type RefObject } from "react";
import type { PartyMember } from "../../shared/watchTogether.ts";
import type { useWatchTogether } from "../hooks/useWatchTogether.ts";
import { partyInviteLink as inviteLink } from "../lib/partyInvite.ts";
import { PlayerPanel } from "./PlayerPanel.tsx";

export { useWatchTogether, useWatchTogetherPosition } from "../hooks/useWatchTogether.ts";

type Session = ReturnType<typeof useWatchTogether>;

interface Props {
  readonly session: Session;
  readonly videoRef: RefObject<HTMLVideoElement | null>;
  readonly onClose: () => void;
}

const solidButton = "flex h-10 flex-1 items-center justify-center gap-2 rounded-full bg-white px-4 text-sm font-semibold text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60";
const quietButton = "flex h-10 flex-1 shrink-0 items-center justify-center gap-2 rounded-full bg-white/15 px-4 text-sm font-semibold hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function memberNote(member: PartyMember): string {
  return [member.isHost ? "host" : null, member.isSelf ? "you" : null].filter((part) => part !== null).join(" · ");
}

function MemberRow({ member, session }: { readonly member: PartyMember; readonly session: Session }): React.JSX.Element {
  const { mutate: remove } = session.remove;
  const handleRemove = useCallback(() => {
    remove(member.id);
  }, [member.id, remove]);
  return (
    <li className="flex min-h-11 items-center gap-2.5 text-[15px]">
      <span className="grid size-[26px] shrink-0 place-items-center rounded-full bg-white/20 text-xs font-bold" aria-hidden="true">{member.name.charAt(0).toUpperCase()}</span>
      <span className="min-w-0 truncate">{member.name}</span>
      <span className="shrink-0 text-[13px] text-muted-foreground">{memberNote(member)}</span>
      {session.host !== null && !member.isSelf && (
        <button type="button" disabled={session.remove.isPending} onClick={handleRemove} aria-label={`Remove ${member.name}`} title={`Remove ${member.name}`} className="ml-auto grid size-9 shrink-0 place-items-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <X className="size-4" />
        </button>
      )}
    </li>
  );
}

function guestStatus(session: Session): string {
  if (session.joining) { return "Connecting to host…"; }
  return session.waiting ? "Waiting for the host to choose an episode…" : "";
}

/** A guest's browser may refuse to start the video on its own; this starts it from a tap. */
function GuestPlayback({ session, videoRef }: Pick<Props, "session" | "videoRef">): React.JSX.Element | null {
  const [failed, setFailed] = useState(false);
  const handleEnable = useCallback(async () => {
    try {
      await videoRef.current?.play();
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [videoRef]);
  if (session.guestId === null) {
    return null;
  }
  const status = guestStatus(session);
  return (
    <>
      {status !== "" && <p className="text-muted-foreground">{status}</p>}
      {failed && <p role="alert" className="text-destructive">Playback could not start. Try again when the video is ready.</p>}
      {!session.waiting && <button type="button" onClick={handleEnable} className="min-h-11 text-left text-[15px] underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Video not playing? Start it here</button>}
    </>
  );
}

function useInvite(id: string) {
  const [copied, setCopied] = useState<boolean | null>(null);
  const handleInvite = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(inviteLink(id));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }, [id]);
  return { copied, handleInvite };
}

/** Invite and Leave; a host's Leave first asks whether the party goes on without them. */
function PartyActions({ id, session }: { readonly id: string; readonly session: Session }): React.JSX.Element {
  const { copied, handleInvite } = useInvite(id);
  const [leaving, setLeaving] = useState(false);
  const handleLeave = useCallback(() => {
    if (session.host === null) {
      session.handleLeave();
    } else {
      setLeaving(true);
    }
  }, [session]);
  const handleStay = useCallback(() => {
    setLeaving(false);
  }, []);
  if (leaving) {
    return (
      <div className="shrink-0 pt-2">
        <p className="mb-2 text-muted-foreground">Leaving hands the party to whoever has been here longest.</p>
        <div className="grid gap-2">
          <button type="button" onClick={session.handleLeave} className={quietButton}>Leave</button>
          <button type="button" disabled={session.end.isPending} onClick={session.handleEnd} className={quietButton}>End for everyone</button>
          <button type="button" onClick={handleStay} className="min-h-10 rounded-full text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Stay</button>
        </div>
      </div>
    );
  }
  return (
    <div className="shrink-0 pt-2">
      {copied === false && <input readOnly aria-label="Invite link" value={inviteLink(id)} className="mb-2 w-full rounded-md bg-white/10 p-2 text-[13px]" />}
      <div className="flex gap-2">
        <button type="button" onClick={handleInvite} className={solidButton}>
          <Link className="size-4" aria-hidden="true" />
          {copied === true ? "Link copied" : "Invite"}
        </button>
        <button type="button" onClick={handleLeave} className={quietButton}>
          <LogOut className="size-4" aria-hidden="true" />
          Leave
        </button>
      </div>
    </div>
  );
}

/** The party panel: who is watching, with Invite and Leave pinned under the list. */
export function WatchTogether({ session, videoRef, onClose }: Props): React.JSX.Element {
  const { mutate: start } = session.start;
  const handleStart = useCallback(() => {
    start();
  }, [start]);
  const id = session.host?.id ?? session.guestId;
  return (
    <PlayerPanel title="Watch together" onClose={onClose}>
      {id === null ? (
        <div className="mt-1">
          <p className="leading-relaxed text-foreground/85">Friends with an account here can join and watch along.</p>
          <button type="button" disabled={session.start.isPending} onClick={handleStart} className={`${solidButton} mt-4 w-full flex-none`}>Start a party</button>
        </div>
      ) : (
        <>
          <ul className="mt-1 min-h-0 flex-1 overflow-y-auto [mask-image:linear-gradient(#000_85%,transparent)]">
            {session.snapshot?.state.memberList.map((member) => <MemberRow key={member.id} member={member} session={session} />)}
          </ul>
          <GuestPlayback session={session} videoRef={videoRef} />
          <PartyActions id={id} session={session} />
        </>
      )}
      {session.error !== null && <p role="alert" className="mt-2 shrink-0 text-destructive">{session.error.message}</p>}
    </PlayerPanel>
  );
}
