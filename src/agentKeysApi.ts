import type { AgentKey } from "../shared/types.ts";
import { api, unwrap } from "./api.ts";

/** How an agent starts Nanime's MCP server on this host. */
export interface McpCommand {
  readonly command: string;
  readonly args: readonly string[];
}

export interface AgentKeysOverview {
  readonly keys: readonly AgentKey[];
  readonly mcp: McpCommand;
}

export interface CreatedAgentKey {
  readonly key: string;
  readonly agentKey: AgentKey;
}

export async function fetchAgentKeys(signal: AbortSignal): Promise<AgentKeysOverview> {
  return unwrap(await api.api["agent-keys"].get({ fetch: { signal } }), "Loading agent keys");
}

export async function createAgentKey(name: string): Promise<CreatedAgentKey> {
  return unwrap(await api.api["agent-keys"].post({ name }), "Creating agent key");
}

export async function revokeAgentKey(id: number): Promise<void> {
  unwrap(await api.api["agent-keys"]({ id: String(id) }).delete(), "Revoking agent key");
}
