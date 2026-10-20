import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { connectionFromEnvironment, nanimeClient } from "./mcpClient.ts";
import { registerNanimeTools } from "./mcpTools.ts";

/**
 * A stdio MCP server for agents: searches Nanime's source plugins and queues
 * downloads through a running Nanime, signed with an agent key.
 * `bun run mcp` with NANIME_URL and NANIME_KEY (an agent key from Admin → Agents) set.
 */
const connection = connectionFromEnvironment(process.env);
const server = new McpServer({ name: "nanime", version: "1.0.0" });
registerNanimeTools(server, nanimeClient(connection));
await server.connect(new StdioServerTransport());
