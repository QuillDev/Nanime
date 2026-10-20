import { Elysia } from "elysia";
import { jsonRequest } from "./requestBody.ts";
import { schema } from "./schemas.ts";
import { handle } from "./server.ts";

const nullableString = schema.union([schema.string(), schema.nullValue()]);
const sourceSchema = schema.object({
  id: schema.string(), repoUrl: schema.string(), name: schema.string(), lang: schema.string(),
  version: schema.string(), iconUrl: nullableString, nsfw: schema.boolean(),
});
const availableSchema = schema.object({
  id: schema.string(), repoUrl: schema.string(), name: schema.string(), lang: schema.string(),
  version: schema.string(), iconUrl: nullableString, nsfw: schema.boolean(), installedVersion: nullableString,
});
const repoSchema = schema.object({ url: schema.string(), sources: schema.array(availableSchema), error: nullableString });
const okSchema = schema.object({ ok: schema.boolean() });
const optionSchema = schema.object({ label: schema.string(), value: schema.string() });
const optionalString = schema.optional(schema.string());
const searchQuery = schema.string({ minLength: 1, maxLength: 200 });
const chosenEpisode = schema.object({ url: schema.string(), number: schema.number() });
const settingValueSchema = schema.union([schema.string(), schema.boolean(), schema.array(schema.string()), schema.nullValue()]);
const settingSchema = schema.object({
  key: schema.string(),
  kind: schema.union([schema.literal("list"), schema.literal("multi"), schema.literal("toggle"), schema.literal("text")]),
  title: schema.string(), summary: schema.string(),
  options: schema.array(optionSchema),
  value: settingValueSchema,
});
const resultSchema = schema.object({ name: schema.string(), imageUrl: nullableString, link: schema.string() });
const episodeSchema = schema.object({ name: schema.string(), url: schema.string(), number: schema.number() });
const detailSchema = schema.object({
  name: schema.string(), imageUrl: nullableString, description: nullableString, genres: schema.array(schema.string()), episodes: schema.array(episodeSchema),
});
const idBody = schema.object({ id: schema.string() });
const urlBody = schema.object({ url: schema.string() });
const downloadBody = schema.object({
  id: schema.string(), showFolder: schema.string(),
  episodes: schema.array(chosenEpisode, { minItems: 1, maxItems: 500 }),
});

// Schemas give Eden end-to-end types; `handle` still applies origin checks,
// authentication, and the admin boundary.
export const sourcesApp = new Elysia({ name: "sources" })
  .get("/api/sources", ({ request, server }) => handle(request, server), {
    query: schema.object({ refresh: optionalString }),
    response: schema.object({ sources: schema.array(sourceSchema), repos: schema.array(repoSchema) }),
  })
  .post("/api/sources/repos", ({ request, server, body }) => handle(jsonRequest(request, body), server), {
    body: urlBody, response: schema.object({ sources: schema.number() }),
  })
  .post("/api/sources/repos/remove", ({ request, server, body }) => handle(jsonRequest(request, body), server), { body: urlBody, response: okSchema })
  .post("/api/sources/install", ({ request, server, body }) => handle(jsonRequest(request, body), server), { body: idBody, response: sourceSchema })
  .post("/api/sources/uninstall", ({ request, server, body }) => handle(jsonRequest(request, body), server), { body: idBody, response: okSchema })
  .get("/api/sources/settings", ({ request, server }) => handle(request, server), {
    query: schema.object({ id: schema.string() }), response: schema.array(settingSchema),
  })
  .post("/api/sources/settings", ({ request, server, body }) => handle(jsonRequest(request, body), server), {
    body: schema.object({ id: schema.string(), key: schema.string(), value: settingValueSchema }), response: okSchema,
  })
  .get("/api/sources/search", ({ request, server }) => handle(request, server), {
    query: schema.object({ id: schema.string(), q: searchQuery, page: optionalString }),
    response: schema.object({ results: schema.array(resultSchema), hasNextPage: schema.boolean() }),
  })
  .get("/api/sources/detail", ({ request, server }) => handle(request, server), {
    query: schema.object({ id: schema.string(), url: schema.string() }), response: detailSchema,
  })
  .post("/api/sources/download", ({ request, server, body }) => handle(jsonRequest(request, body), server), {
    body: downloadBody, response: schema.object({ added: schema.number() }),
  });
