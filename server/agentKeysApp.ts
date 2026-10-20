import { Elysia } from "elysia";
import { jsonRequest } from "./requestBody.ts";
import { schema } from "./schemas.ts";
import { handle } from "./server.ts";

const agentKeySchema = schema.object({
  id: schema.number(), name: schema.string(), createdBy: schema.string(), createdAt: schema.number(),
  lastUsedAt: schema.union([schema.number(), schema.nullValue()]),
});
const mcpCommandSchema = schema.object({ command: schema.string(), args: schema.array(schema.string()) });

// Schemas give Eden end-to-end types; `handle` still applies origin checks,
// authentication, and the admin boundary.
export const agentKeysApp = new Elysia({ name: "agent-keys" })
  .get("/api/agent-keys", ({ request, server }) => handle(request, server), {
    response: schema.object({ keys: schema.array(agentKeySchema), mcp: mcpCommandSchema }),
  })
  .post("/api/agent-keys", ({ request, server, body }) => handle(jsonRequest(request, body), server), {
    body: schema.object({ name: schema.string({ minLength: 1, maxLength: 60 }) }),
    response: schema.object({ key: schema.string(), agentKey: agentKeySchema }),
  })
  .delete("/api/agent-keys/:id", ({ request, server }) => handle(request, server));
