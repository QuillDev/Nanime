import { Elysia } from "elysia";
import { jsonRequest } from "./requestBody.ts";
import { authUserSchema, schema } from "./schemas.ts";
import { handle } from "./server.ts";

const pollSchema = schema.object({
  status: schema.union([schema.literal("pending"), schema.literal("approved"), schema.literal("expired")]),
  user: schema.optional(authUserSchema),
});

// Schemas give Eden end-to-end types; `handle` applies origin checks and sign-in (server/deviceLogins.ts).
export const deviceLoginApp = new Elysia({ name: "device-login" })
  .post("/api/auth/device", ({ request, server }) => handle(request, server), {
    response: schema.object({ deviceCode: schema.string(), userCode: schema.string(), expiresAt: schema.number(), interval: schema.number() }),
  })
  .post("/api/auth/device/poll", ({ request, server, body }) => handle(jsonRequest(request, body), server), {
    body: schema.object({ deviceCode: schema.string({ maxLength: 100 }) }),
    response: pollSchema,
  })
  .post("/api/auth/device/approve", ({ request, server, body }) => handle(jsonRequest(request, body), server), {
    body: schema.object({ userCode: schema.string({ maxLength: 20 }) }),
  })
  .get("/api/auth/device/:code", ({ request, server }) => handle(request, server), {
    response: schema.object({ userCode: schema.string(), device: schema.string(), createdAt: schema.number(), expiresAt: schema.number() }),
  });
