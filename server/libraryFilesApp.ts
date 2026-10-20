import { Elysia } from "elysia";
import { jsonRequest } from "./requestBody.ts";
import { handle } from "./server.ts";
import {
  createFolderBodySchema, episodeNamesBodySchema, episodeNamesResultSchema, fileOperationResultSchema, librarySnapshotSchema, moveBodySchema, renameBodySchema, trashBodySchema,
} from "./libraryFilesSchemas.ts";

// Schemas give Eden end-to-end types; `handle` still applies origin checks,
// authentication, and the admin boundary before any filesystem access.
export const libraryFilesApp = new Elysia({ name: "library-files" })
  .get("/api/library/files", ({ request, server }) => handle(request, server), {
    response: librarySnapshotSchema,
  })
  .post("/api/library/files/folders", ({ request, server, body }) => handle(jsonRequest(request, body), server), {
    body: createFolderBodySchema, response: fileOperationResultSchema,
  })
  .post("/api/library/files/rename", ({ request, server, body }) => handle(jsonRequest(request, body), server), {
    body: renameBodySchema, response: fileOperationResultSchema,
  })
  .post("/api/library/files/move", ({ request, server, body }) => handle(jsonRequest(request, body), server), {
    body: moveBodySchema, response: fileOperationResultSchema,
  })
  .post("/api/library/files/trash", ({ request, server, body }) => handle(jsonRequest(request, body), server), {
    body: trashBodySchema, response: fileOperationResultSchema,
  })
  .post("/api/library/files/episode-names", ({ request, server, body }) => handle(jsonRequest(request, body), server), {
    body: episodeNamesBodySchema, response: episodeNamesResultSchema,
  })
  .post("/api/library/files/operations/:id/revert", ({ request, server }) => handle(request, server), {
    response: fileOperationResultSchema,
  });
