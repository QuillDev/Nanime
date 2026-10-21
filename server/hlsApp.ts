import { Elysia } from "elysia";
import { handle } from "./server.ts";
import {
  hlsQuerySchema,
  hlsReleaseQuerySchema,
  hlsSegmentQuerySchema,
} from "./hlsSchemas.ts";

// Managed HLS playback; `handle` applies origin checks, authentication and lease ownership.
export const hlsApp = new Elysia({ name: "hls" })
  .get("/hls/index", ({ request, server }) => handle(request, server), {
    query: hlsQuerySchema,
  })
  .get("/hls/seg", ({ request, server }) => handle(request, server), {
    query: hlsSegmentQuerySchema,
  })
  .post("/api/hls/release", ({ request, server }) => handle(request, server), {
    query: hlsReleaseQuerySchema,
  });
