import { Elysia } from "elysia";
import { jsonRequest } from "./requestBody.ts";
import { downloadStatusSchema, schema } from "./schemas.ts";
import { handle } from "./server.ts";

const headersSchema = schema.record(schema.string(), schema.string());
const downloadItemSchema = schema.union([
  schema.object({ kind: schema.literal("torrent"), magnet: schema.string({ minLength: 1 }) }),
  schema.object({
    kind: schema.literal("file"),
    url: schema.string({ minLength: 1 }),
    fileName: schema.string({ minLength: 1 }),
    headers: schema.optional(headersSchema),
  }),
]);
const okSchema = schema.object({ ok: schema.boolean() });
const torrentErrorSchema = schema.union([schema.string(), schema.nullValue()]);
const downloadListSchema = schema.object({ downloads: schema.array(downloadStatusSchema), torrentError: torrentErrorSchema });
const addDownloadsSchema = schema.object({ showFolder: schema.string(), items: schema.array(downloadItemSchema, { minItems: 1, maxItems: 500 }) });

// Schemas give Eden end-to-end types; `handle` still applies origin checks,
// authentication, and the admin boundary.
export const downloadsApp = new Elysia({ name: "downloads" })
  .get("/api/downloads", ({ request, server }) => handle(request, server), {
    response: downloadListSchema,
  })
  .post("/api/downloads", ({ request, server, body }) => handle(jsonRequest(request, body), server), {
    body: addDownloadsSchema,
    response: schema.object({ added: schema.number() }),
  })
  .post("/api/downloads/:id/pause", ({ request, server }) => handle(request, server), { response: okSchema })
  .post("/api/downloads/:id/resume", ({ request, server }) => handle(request, server), { response: okSchema })
  .post("/api/downloads/:id/cancel", ({ request, server, body }) => handle(jsonRequest(request, body), server), {
    body: schema.object({ deleteFiles: schema.boolean() }),
    response: okSchema,
  });
