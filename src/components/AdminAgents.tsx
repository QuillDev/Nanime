import { useCallback, useState } from "react";
import { KeyRound } from "lucide-react";
import type { AgentKey } from "../../shared/types.ts";
import { useAgentKeys } from "../hooks/useAgentKeys.ts";
import { relativeTime } from "../lib/relativeTime.ts";
import { AdminPage } from "./AdminPage.tsx";
import { NewAgentKeyDialog, RevokeAgentKeyDialog } from "./AgentKeyDialogs.tsx";
import { ListSkeleton } from "./Skeleton.tsx";

function lastUsed(agentKey: AgentKey): string {
  return agentKey.lastUsedAt === null ? "Never used" : `Last used ${relativeTime(agentKey.lastUsedAt)}`;
}

function AgentKeyRow({ agentKey }: { readonly agentKey: AgentKey }): React.JSX.Element {
  return (
    <li className="flex items-center gap-4 border-b border-border py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">{agentKey.name}</p>
        <p className="mt-0.5 text-[13px] text-muted-foreground">{lastUsed(agentKey)} · acts as {agentKey.createdBy}</p>
      </div>
      <RevokeAgentKeyDialog agentKey={agentKey} />
    </li>
  );
}

function AgentKeyList({ keys }: { readonly keys: readonly AgentKey[] }): React.JSX.Element {
  if (keys.length === 0) {
    return <p className="py-3 text-sm text-muted-foreground">No agent keys yet.</p>;
  }
  return <ul>{keys.map((agentKey) => <AgentKeyRow key={agentKey.id} agentKey={agentKey} />)}</ul>;
}

/** Keys for agents (Nanime's MCP server): create one with its Hermes config, see when it was used, revoke it. */
export function AdminAgents(): React.JSX.Element {
  const overview = useAgentKeys();
  const [creating, setCreating] = useState(false);
  const handleCreate = useCallback(() => setCreating(true), []);
  const handleClose = useCallback(() => setCreating(false), []);
  return (
    <AdminPage title="Agents" actionLabel="New key" actionIcon={KeyRound} onAction={handleCreate}>
      {overview.status === "pending" && <ListSkeleton />}
      {overview.status === "error" && <p className="select-text py-4 text-sm text-destructive">{overview.error.message}</p>}
      {overview.status === "success" && <AgentKeyList keys={overview.data.keys} />}
      {creating && overview.data !== undefined && <NewAgentKeyDialog mcp={overview.data.mcp} onClose={handleClose} />}
    </AdminPage>
  );
}
