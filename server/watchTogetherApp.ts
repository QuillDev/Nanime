import { Elysia } from "elysia";
import { handle } from "./server.ts";
import { jsonRequest } from "./requestBody.ts";
import { watchCreateSchema, watchCreatedSchema, watchUpdateSchema, watchEndSchema, watchStateSchema, partyMemberSchema, partyPlaybackSchema, partyEndSchema, partyStateSchema, partyRemoveSchema } from "./watchTogetherSchemas.ts";

export const watchTogetherApp = new Elysia({ name: "watch-together" })
  .post("/api/watch-together", ({ request, server, body }) => (
    handle(jsonRequest(request, body), server)
  ), { body: watchCreateSchema, response: watchCreatedSchema })
  .get("/api/watch-together/:id", ({ request, server }) => handle(request, server), {
    response: watchStateSchema,
  })
  .put("/api/watch-together/:id", ({ request, server, body }) => (
    handle(jsonRequest(request, body), server)
  ), { body: watchUpdateSchema, response: watchStateSchema })
  .delete("/api/watch-together/:id", ({ request, server, body }) => (
    handle(jsonRequest(request, body), server)
  ), { body: watchEndSchema })
  .post("/api/watch-together/:id/presence", ({ request, server, body }) => handle(jsonRequest(request, body), server), { body: partyMemberSchema, response: partyStateSchema })
  .put("/api/watch-together/:id/party-playback", ({ request, server, body }) => handle(jsonRequest(request, body), server), { body: partyPlaybackSchema, response: partyStateSchema })
  .post("/api/watch-together/:id/leave", ({ request, server, body }) => handle(jsonRequest(request, body), server), { body: partyMemberSchema })
  .post("/api/watch-together/:id/remove", ({ request, server, body }) => handle(jsonRequest(request, body), server), { body: partyRemoveSchema })
  .post("/api/watch-together/:id/end", ({ request, server, body }) => handle(jsonRequest(request, body), server), { body: partyEndSchema });
