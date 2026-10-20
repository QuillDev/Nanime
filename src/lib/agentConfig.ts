import type { McpCommand } from "../agentKeysApi.ts";

/** A YAML scalar that survives any path or key: double-quoted with escapes. */
function quoted(value: string): string {
  return JSON.stringify(value);
}

/** The Hermes Agent `mcp_servers` entry that starts Nanime's MCP server with this key. */
export function hermesConfig(mcp: McpCommand, origin: string, key: string): string {
  return [
    "mcp_servers:",
    "  nanime:",
    `    command: ${quoted(mcp.command)}`,
    `    args: [${mcp.args.map((arg) => quoted(arg)).join(", ")}]`,
    "    env:",
    `      NANIME_URL: ${quoted(origin)}`,
    `      NANIME_KEY: ${quoted(key)}`,
  ].join("\n");
}
