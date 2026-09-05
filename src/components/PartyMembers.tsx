import { useCallback } from "react";
import type { PartyMember } from "../../shared/watchTogether.ts";
import { useWatchTogetherContext } from "../hooks/watchTogetherContext.ts";

function MemberRow({ member }: { readonly member: PartyMember }): React.JSX.Element {
  const session = useWatchTogetherContext();
  const handleRemove = useCallback(() => session.remove.mutate(member.id), [session.remove, member.id]);
  return <li className="flex items-center justify-between gap-3 py-2">
    <span className="min-w-0 break-words">{member.name}{member.isSelf && " (you)"}{member.isHost && <span className="ml-2 text-xs text-primary">Host</span>}</span>
    {session.host !== null && !member.isSelf && <button type="button" disabled={session.remove.isPending} onClick={handleRemove} aria-label={`Remove ${member.name}`} className="rounded border border-border px-2 py-1 text-xs focus-visible:ring-2 focus-visible:ring-primary">Remove</button>}
  </li>;
}
export function PartyMembers(): React.JSX.Element {
  const { snapshot } = useWatchTogetherContext();
  return <section aria-label="Party members">
    <h3 className="font-medium">Members</h3>
    <ul className="max-h-48 divide-y divide-border overflow-y-auto">{snapshot?.state.memberList.map((member) => <MemberRow key={member.id} member={member} />)}</ul>
  </section>;
}
