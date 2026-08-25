import { Elysia } from "elysia";
import { handle, serverOptions } from "./server.ts";
import { securityHeaders } from "./security.ts";
import {
  aniListMediaSchema,
  aniListAccountSchema,
  aniListAuthConfigSchema,
  aniListListEntrySchema,
  audioTrackSchema,
  authUserSchema,
  credentialsSchema,
  mediaEntrySchema,
  libraryStatusSchema,
  metadataRefreshStatusSchema,
  mediaScanSchema,
  nyaaSearchResultSchema,
  playbackProgressSchema,
  provisionedUserSchema,
  schema,
  storageStatusSchema,
  subtitleTrackSchema,
  transcodeJobSchema,
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

function uploadChunkRequest(
  req: Request,
  body: { readonly chunk: File; readonly offset: number },
): Request {
  const form = new FormData();
  form.append("chunk", body.chunk, "chunk");
  form.append("offset", String(body.offset));
  return requestWithBody(req, form);
}

function subtitleUploadRequest(
  req: Request,
  body: { readonly path: string; readonly subtitle: File; readonly offsetSeconds: number },
): Request {
  const form = new FormData();
  form.append("path", body.path);
  form.append("subtitle", body.subtitle, body.subtitle.name);
  form.append("offsetSeconds", String(body.offsetSeconds));
  return requestWithBody(req, form);
}

const setupCredentialsSchema = schema.composite([
  credentialsSchema,
  schema.object({ setupToken: schema.string() }),
]);
const optionalEpisodeCountSchema = schema.optional(schema.union([
  schema.integer({ minimum: 1 }),
  schema.nullValue(),
]));
const nullablePositiveIntegerSchema = schema.union([
  schema.integer({ minimum: 1 }),
  schema.nullValue(),
]);
const metadataAniListIdSchema = schema.object({
  key: schema.string({ minLength: 1 }),
  anilistId: nullablePositiveIntegerSchema,
});
const jikanLinkSchema = schema.object({
  key: schema.string({ minLength: 1 }),
  id: schema.integer(),
  anilistId: schema.optional(nullablePositiveIntegerSchema),
});
const playbackUpdateSchema = schema.object({
  rel: schema.string(),
  position: schema.number({ minimum: 0 }),
  duration: schema.number({ minimum: 0 }),
  completed: schema.boolean(),
  anilistMediaId: schema.optional(schema.integer({ minimum: 1 })),
  episode: schema.optional(schema.integer({ minimum: 1 })),
  totalEpisodes: optionalEpisodeCountSchema,
});
const playbackDismissSchema = schema.object({ rel: schema.string({ minLength: 1 }) });
const aniListUpdateSchema = schema.object({
  status: schema.optional(schema.string()),
  progress: schema.optional(schema.integer({ minimum: 0 })),
  score: schema.optional(schema.number({ minimum: 0, maximum: 10 })),
});
const searchQuerySchema = schema.object({ q: schema.string({ minLength: 2 }) });
const nyaaSortSchema = schema.union([
  schema.literal("id"),
  schema.literal("size"),
  schema.literal("seeders"),
  schema.literal("leechers"),
  schema.literal("downloads"),
]);
const nyaaSortOrderSchema = schema.union([
  schema.literal("asc"),
  schema.literal("desc"),
]);
const nyaaSearchQuerySchema = schema.object({
  q: schema.string({ minLength: 2, maxLength: 200 }),
  category: schema.optional(schema.string()),
  trusted: schema.optional(schema.boolean()),
  sort: schema.optional(nyaaSortSchema),
  order: schema.optional(nyaaSortOrderSchema),
});
const pathQuerySchema = schema.object({ path: schema.string({ minLength: 1 }) });
const indexedPathQuerySchema = schema.object({
  path: schema.string({ minLength: 1 }),
  index: schema.integer(),
  offset: schema.optional(schema.number({ minimum: 0 })),
});
const segmentQuerySchema = schema.object({
  session: schema.string({ minLength: 1 }),
  name: schema.string({ pattern: "^segment-[0-9]{6}\\.ts$" }),
});
const hlsQuerySchema = schema.object({
  path: schema.string({ minLength: 1 }),
  audio: schema.optional(schema.integer({ minimum: 0 })),
  start: schema.optional(schema.number({ minimum: 0 })),
});
const optionalTorrentFileSchema = schema.optional(schema.file());
const optionalMagnetSchema = schema.optional(schema.string());
const mediaPathsSchema = schema.array(schema.string(), { minItems: 1, maxItems: 5000 });
const trackIndicesSchema = schema.array(schema.integer(), { maxItems: 100 });
const trackPruneOperationSchema = schema.object({
  path: schema.string({ minLength: 1 }),
  audioIndices: trackIndicesSchema,
  subtitleIndices: trackIndicesSchema,
});
const transcodePathsSchema = schema.array(schema.string(), { minItems: 1, maxItems: 500 });
const transcodePresetSchema = schema.union([
  schema.literal("space-saver"),
  schema.literal("compatibility"),
]);

export const app = new Elysia({ name: "nanime" })
  .onError(({ code }) => securityHeaders(new Response(
    code === "VALIDATION" ? "Invalid request" : "Server error",
    { status: code === "VALIDATION" ? 400 : 500 },
  )))
  .get("/api/auth/me", ({ request, server }) => handle(request, server), {
    response: schema.union([authUserSchema, schema.nullValue()]),
  })
  .get("/api/auth/anilist/config", ({ request, server }) => handle(request, server), {
    response: aniListAuthConfigSchema,
  })
  .get("/api/auth/anilist/start", ({ request, server }) => handle(request, server))
  .get("/api/auth/anilist/callback", ({ request, server }) => handle(request, server))
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
  .get("/api/media-info", ({ request, server }) => handle(request, server), {
    query: pathQuerySchema,
    response: schema.object({ duration: schema.number({ minimum: 0 }) }),
  })
  .get("/api/library/status", ({ request, server }) => handle(request, server), {
    response: libraryStatusSchema,
  })
  .post("/api/library/refresh", ({ request, server }) => handle(request, server), {
    response: libraryStatusSchema,
  })
  .get("/api/metadata", ({ request, server }) => handle(request, server), {
    response: schema.record(schema.string(), aniListMediaSchema),
  })
  .get("/api/metadata/refresh", ({ request, server }) => handle(request, server), {
    response: metadataRefreshStatusSchema,
  })
  .put("/api/metadata/anilist-id", ({ request, server, body }) => (
    handle(jsonRequest(request, body), server)
  ), {
    body: metadataAniListIdSchema,
    response: aniListMediaSchema,
  })
  .post("/api/metadata/refresh", ({ request, server }) => handle(request, server), {
    response: metadataRefreshStatusSchema,
  })
  .get("/api/progress", ({ request, server }) => handle(request, server), {
    response: schema.array(playbackProgressSchema),
  })
  .put("/api/progress", ({ request, server, body }) => (
    handle(jsonRequest(request, body), server)
  ), { body: playbackUpdateSchema, response: playbackProgressSchema })
  .post("/api/progress/dismiss", ({ request, server, body }) => (
    handle(jsonRequest(request, body), server)
  ), { body: playbackDismissSchema, response: playbackProgressSchema })
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
  .get("/api/jikan/search", ({ request, server }) => handle(request, server), {
    query: searchQuerySchema,
    response: schema.array(aniListMediaSchema),
  })
  .post("/api/jikan/link", ({ request, server, body }) => (
    handle(jsonRequest(request, body), server)
  ), {
    body: jikanLinkSchema,
    response: aniListMediaSchema,
  })
  .get("/api/anilist/account", ({ request, server }) => handle(request, server), {
    response: aniListAccountSchema,
  })
  .delete("/api/anilist/account", ({ request, server }) => handle(request, server))
  .get("/api/anilist/list/:id", ({ request, server }) => handle(request, server), {
    response: schema.union([aniListListEntrySchema, schema.nullValue()]),
  })
  .put("/api/anilist/list/:id", ({ request, server, body }) => (
    handle(jsonRequest(request, body), server)
  ), {
    body: aniListUpdateSchema,
    response: schema.union([aniListListEntrySchema, schema.nullValue()]),
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
  .delete("/api/users/:id", ({ request, server }) => handle(request, server))
  .get("/api/torrents", ({ request, server }) => handle(request, server), {
    response: schema.array(torrentStatusSchema),
  })
  .get("/api/storage", ({ request, server }) => handle(request, server), {
    response: storageStatusSchema,
  })
  .get("/api/transcodes", ({ request, server }) => handle(request, server), {
    response: schema.array(transcodeJobSchema),
  })
  .post("/api/transcodes", ({ request, server, body }) => (
    handle(jsonRequest(request, body), server)
  ), {
    body: schema.object({
      path: schema.string(),
      preset: transcodePresetSchema,
    }),
    response: transcodeJobSchema,
  })
  .post("/api/transcodes/bulk", ({ request, server, body }) => (
    handle(jsonRequest(request, body), server)
  ), {
    body: schema.object({
      paths: transcodePathsSchema,
      preset: transcodePresetSchema,
    }),
    response: schema.array(transcodeJobSchema),
  })
  .delete("/api/transcodes/:id", ({ request, server }) => handle(request, server))
  .post("/api/transcodes/:id/cancel", ({ request, server }) => handle(request, server), {
    response: transcodeJobSchema,
  })
  .delete("/api/transcodes/:id/original", ({ request, server }) => handle(request, server), {
    response: transcodeJobSchema,
  })
  .get("/api/torrents/search", ({ request, server }) => handle(request, server), {
    query: nyaaSearchQuerySchema,
    response: schema.array(nyaaSearchResultSchema),
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
  .post("/api/torrents/:hash/cancel", ({ request, server, body }) => (
    handle(jsonRequest(request, body), server)
  ), {
    body: schema.object({ deleteFiles: schema.boolean() }),
    response: schema.object({ cancelled: schema.boolean() }),
  })
  .post("/api/media/delete", ({ request, server, body }) => (
    handle(jsonRequest(request, body), server)
  ), {
    body: schema.object({
      paths: mediaPathsSchema,
    }),
    response: schema.object({ deleted: schema.number() }),
  })
  .post("/api/media/prune-tracks", ({ request, server, body }) => (
    handle(jsonRequest(request, body), server)
  ), {
    body: schema.object({
      operations: schema.array(trackPruneOperationSchema, { minItems: 1, maxItems: 100 }),
    }),
    response: schema.object({ processed: schema.integer() }),
  })
  .get("/api/media/scans", ({ request, server }) => handle(request, server), {
    response: schema.array(mediaScanSchema),
  })
  .post("/api/media/scans", ({ request, server, body }) => (
    handle(jsonRequest(request, body), server)
  ), {
    body: schema.object({ paths: mediaPathsSchema }),
    response: schema.array(mediaScanSchema),
  })
  .post("/api/media/uploads", ({ request, server, body }) => (
    handle(jsonRequest(request, body), server)
  ), {
    body: schema.object({
      fileName: schema.string({ minLength: 1, maxLength: 255 }),
      folder: schema.string({ maxLength: 1000 }),
      size: schema.integer({ minimum: 1 }),
    }),
    response: schema.object({ id: schema.string(), chunkSize: schema.integer() }),
  })
  .post("/api/media/uploads/:id", ({ request, server, body }) => (
    handle(uploadChunkRequest(request, body), server)
  ), {
    body: schema.object({ chunk: schema.file(), offset: schema.integer({ minimum: 0 }) }),
    response: schema.object({ received: schema.integer() }),
  })
  .post("/api/media/uploads/:id/complete", ({ request, server }) => (
    handle(request, server)
  ), {
    response: schema.object({ path: schema.string() }),
  })
  .delete("/api/media/uploads/:id", ({ request, server }) => handle(request, server))
  .post("/api/subtitles", ({ request, server, body }) => (
    handle(subtitleUploadRequest(request, body), server)
  ), {
    body: schema.object({
      path: schema.string({ minLength: 1 }),
      subtitle: schema.file(),
      offsetSeconds: schema.number({ minimum: -3600, maximum: 3600 }),
    }),
    response: schema.object({ uploaded: schema.boolean() }),
  })
  .get("/api/subtitles", ({ request, server }) => handle(request, server), {
    query: pathQuerySchema,
    response: schema.array(subtitleTrackSchema),
  })
  .get("/api/audio-tracks", ({ request, server }) => handle(request, server), {
    query: pathQuerySchema,
    response: schema.array(audioTrackSchema),
  })
  .delete("/api/audio-tracks", ({ request, server, body }) => (
    handle(jsonRequest(request, body), server)
  ), {
    body: schema.object({ path: schema.string({ minLength: 1 }), index: schema.integer({ minimum: 0 }) }),
    response: schema.object({ deleted: schema.boolean() }),
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
    query: hlsQuerySchema,
  })
  .get("/hls/seg", ({ request, server }) => handle(request, server), {
    query: segmentQuerySchema,
  })
  .all("*", ({ request, server }) => handle(request, server));

export type App = typeof app;

app.listen(serverOptions);
