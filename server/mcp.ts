import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { connectionFromEnvironment, nanimeClient } from "./mcpClient.ts";
import { registerNanimeTools } from "./mcpTools.ts";

/**
 * A stdio MCP server for agents: searches Nanime's source plugins and queues
 * downloads through a running Nanime, signed in as an admin account.
 * `bun run mcp` with NANIME_URL, NANIME_USERNAME and NANIME_PASSWORD_FILE set.
 */
const connection = await connectionFromEnvironment(process.env);
const server = new McpServer({ name: "nanime", version: "1.0.0" });
registerNanimeTools(server, nanimeClient(connection));
await server.connect(new StdioServerTransport());
