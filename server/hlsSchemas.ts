import { schema } from "./schemas.ts";

export const hlsSegmentQuerySchema = schema.object({
  session: schema.string({ minLength: 1 }),
  lease: schema.optional(schema.string({ format: "uuid" })),
  name: schema.string({ pattern: "^(?:segment-[0-9]{6}\\.(?:ts|m4s)|init\\.mp4)$" }),
});

export const hlsQuerySchema = schema.object({
  path: schema.string({ minLength: 1 }),
  audio: schema.optional(schema.integer({ minimum: 0 })),
  start: schema.optional(schema.number({ minimum: 0 })),
  hevc: schema.optional(schema.literal("1")),
  player: schema.optional(schema.string({ format: "uuid" })),
  lease: schema.optional(schema.string({ format: "uuid" })),
});

export const hlsReleaseQuerySchema = schema.object({
  player: schema.string({ format: "uuid" }),
  lease: schema.string({ format: "uuid" }),
});
