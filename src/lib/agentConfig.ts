import type { McpCommand } from "../agentKeysApi.ts";

export type AgentKind = "hermes" | "codex" | "claude";

export const AGENT_KINDS: readonly { readonly kind: AgentKind; readonly label: string }[] = [
  { kind: "hermes", label: "Hermes" },
  { kind: "codex", label: "Codex" },
  { kind: "claude", label: "Claude Code" },
];

/** A shell word: bare when it's plainly safe, otherwise single-quoted. */
function word(value: string): string {
  return /^[\w./:=@-]+$/u.test(value) ? value : `'${value.replaceAll("'", String.raw`'\''`)}'`;
}

interface Setup {
  readonly add: string;
  readonly check: string;
}

function setupFor(kind: AgentKind, mcp: McpCommand, env: readonly string[]): Setup {
  const args = mcp.args.map((part) => word(part)).join(" ");
  const server = `${word(mcp.command)} ${args}`;
  const pairs = env.map((pair) => word(pair));
  switch (kind) {
    case "hermes": {
      // `hermes mcp add` asks whether to enable the tools it found; answer yes.
      return { add: `printf 'y\\n' | hermes mcp add nanime --command ${word(mcp.command)} --env ${pairs.join(" ")} --args ${args}`, check: "hermes mcp test nanime" };
    }
    case "codex": {
      return { add: `codex mcp add nanime ${pairs.map((pair) => `--env ${pair}`).join(" ")} -- ${server}`, check: "codex mcp list" };
    }
    case "claude": {
      return { add: `claude mcp add nanime --scope user ${pairs.map((pair) => `-e ${pair}`).join(" ")} -- ${server}`, check: "claude mcp get nanime" };
    }
  }
}

export interface AgentConnection {
  readonly mcp: McpCommand;
  readonly origin: string;
  readonly key: string;
}

/** A message to paste into the agent: what Nanime's MCP server is, the command that adds it, and how to check it. */
export function agentSetupPrompt(kind: AgentKind, { mcp, origin, key }: AgentConnection): string {
  const setup = setupFor(kind, mcp, [`NANIME_URL=${origin}`, `NANIME_KEY=${key}`]);
  return [
    "Set up Nanime's MCP server so you can search Nanime's sources (like Nyaa) and queue and manage its downloads.",
    "",
    "Add it with:",
    "",
    setup.add,
    "",
    `Then run \`${setup.check}\` and tell me whether it connected and which tools it has. The tools show up in a new session.`,
    "NANIME_KEY is a secret: don't repeat it back, log it or commit it anywhere.",
  ].join("\n");
}
