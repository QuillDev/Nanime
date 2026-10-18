import { Elysia } from "elysia";
import { androidReleaseResponse } from "./androidRelease.ts";
import { androidReleaseSchema } from "./schemas.ts";
import { authenticatedUser, securityHeaders } from "./security.ts";

const configuredReleaseDir = process.env["NANIME_ANDROID_RELEASE_DIR"] ?? "";
const RELEASE_DIR = configuredReleaseDir === "" ? null : configuredReleaseDir;

// Read-only routes for signed-in users; the APK is served with the same session
// cookie the app already holds, so no download token ever leaves the server.
async function androidRoute(request: Request): Promise<Response> {
  const { pathname } = new URL(request.url);
  const response = authenticatedUser(request) === null
    ? new Response("Unauthorized", { status: 401 })
    : await androidReleaseResponse(pathname, request, RELEASE_DIR);
  return securityHeaders(response ?? new Response("Not found", { status: 404 }));
}

export const androidReleaseApp = new Elysia({ name: "android-release" })
  .get("/api/android/release", ({ request }) => androidRoute(request), {
    response: androidReleaseSchema,
  })
  .get("/android/nanime.apk", ({ request }) => androidRoute(request));
