import { Elysia } from "elysia";
import { handle, serverOptions } from "./server.ts";
import { securityHeaders } from "./security.ts";
import {
  aniListMediaSchema,
  authUserSchema,
  credentialsSchema,
  mediaEntrySchema,
  playbackProgressSchema,
  provisionedUserSchema,
  schema,
  subtitleTrackSchema,
  torrentStatusSchema,
} from "./schemas.ts";

function requestWithBody(req: Request, body: string | FormData): Request {
  const headers = new Headers(req.headers);
  headers.delete("content-length");
  if (body instanceof FormData) {
    headers.delete("content-type");
  }
  return new Request(req.url, {
    method: req.method,
    headers,
    body,
    signal: req.signal,
  });
}

function jsonRequest(req: Request, body: unknown): Request {
  return requestWithBody(req, JSON.stringify(body));
}

function formRequest(
  req: Request,
  body: { readonly torrent?: File; readonly magnet?: string; readonly showFolder: string },
): Request {
  const form = new FormData();
  if (body.torrent !== undefined) {
    form.append("torrent", body.torrent, body.torrent.name);
  }
  if (body.magnet !== undefined) {
    form.append("magnet", body.magnet);
  }
  form.append("showFolder", body.showFolder);
  return requestWithBody(req, form);
}

const setupCredentialsSchema = schema.composite([
  credentialsSchema,
  schema.object({ setupToken: schema.string() }),
]);
const playbackUpdateSchema = schema.object({
  rel: schema.string(),
  position: schema.number({ minimum: 0 }),
  duration: schema.number({ minimum: 0 }),
  completed: schema.boolean(),
});
const searchQuerySchema = schema.object({ q: schema.string({ minLength: 2 }) });
const pathQuerySchema = schema.object({ path: schema.string({ minLength: 1 }) });
const indexedPathQuerySchema = schema.object({
  path: schema.string({ minLength: 1 }),
  index: schema.integer({ minimum: 0 }),
});
const segmentQuerySchema = schema.object({
  path: schema.string({ minLength: 1 }),
  i: schema.integer({ minimum: 0 }),
});
const optionalTorrentFileSchema = schema.optional(schema.file());
const optionalMagnetSchema = schema.optional(schema.string());
const mediaPathsSchema = schema.array(schema.string(), { minItems: 1, maxItems: 5000 });

export const app = new Elysia({ name: "nanime" })
  .onError(({ code }) => securityHeaders(new Response(
    code === "VALIDATION" ? "Invalid request" : "Server error",
    { status: code === "VALIDATION" ? 400 : 500 },
  )))
  .get("/api/auth/me", ({ request, server }) => handle(request, server), {
    response: schema.union([authUserSchema, schema.nullValue()]),
  })
  .post("/api/auth/login", ({ request, server, body }) => (
    handle(jsonRequest(request, body), server)
  ), { body: credentialsSchema, response: authUserSchema })
  .post("/api/auth/setup", ({ request, server, body }) => (
    handle(jsonRequest(request, body), server)
  ), { body: setupCredentialsSchema, response: authUserSchema })
  .post("/api/auth/logout", ({ request, server }) => handle(request, server))
  .get("/api/list", ({ request, server }) => handle(request, server), {
    response: schema.array(mediaEntrySchema),
  })
  .get("/api/metadata", ({ request, server }) => handle(request, server), {
    response: schema.record(schema.string(), aniListMediaSchema),
  })
  .get("/api/progress", ({ request, server }) => handle(request, server), {
    response: schema.array(playbackProgressSchema),
  })
  .put("/api/progress", ({ request, server, body }) => (
    handle(jsonRequest(request, body), server)
  ), { body: playbackUpdateSchema, response: playbackProgressSchema })
  .get("/api/anilist/search", ({ request, server }) => handle(request, server), {
    query: searchQuerySchema,
    response: schema.array(aniListMediaSchema),
  })
  .post("/api/anilist/link", ({ request, server, body }) => (
    handle(jsonRequest(request, body), server)
  ), {
    body: schema.object({ key: schema.string({ minLength: 1 }), id: schema.integer() }),
    response: aniListMediaSchema,
  })
  .get("/api/users", ({ request, server }) => handle(request, server), {
    response: schema.array(provisionedUserSchema),
  })
  .post("/api/users", ({ request, server, body }) => (
    handle(jsonRequest(request, body), server)
  ), {
    body: schema.object({ username: schema.string(), isAdmin: schema.boolean() }),
    response: schema.object({ setupToken: schema.string() }),
  })
  .get("/api/torrents", ({ request, server }) => handle(request, server), {
    response: schema.array(torrentStatusSchema),
  })
  .post("/api/torrents", ({ request, server, body }) => (
    handle(formRequest(request, body), server)
  ), {
    body: schema.object({
      torrent: optionalTorrentFileSchema,
      magnet: optionalMagnetSchema,
      showFolder: schema.string(),
    }),
    response: schema.object({ added: schema.boolean() }),
  })
  .post("/api/media/delete", ({ request, server, body }) => (
    handle(jsonRequest(request, body), server)
  ), {
    body: schema.object({
      paths: mediaPathsSchema,
    }),
    response: schema.object({ deleted: schema.number() }),
  })
  .get("/api/subtitles", ({ request, server }) => handle(request, server), {
    query: pathQuerySchema,
    response: schema.array(subtitleTrackSchema),
  })
  .get("/stream", ({ request, server }) => handle(request, server), {
    query: pathQuerySchema,
  })
  .get("/thumbnail", ({ request, server }) => handle(request, server), {
    query: pathQuerySchema,
  })
  .get("/subtitle", ({ request, server }) => handle(request, server), {
    query: indexedPathQuerySchema,
  })
  .get("/hls/index", ({ request, server }) => handle(request, server), {
    query: pathQuerySchema,
  })
  .get("/hls/seg", ({ request, server }) => handle(request, server), {
    query: segmentQuerySchema,
  })
  .all("*", ({ request, server }) => handle(request, server));

export type App = typeof app;

app.listen(serverOptions);
