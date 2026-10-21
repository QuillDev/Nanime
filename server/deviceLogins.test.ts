import { afterEach, expect, test } from "bun:test";
import { getJson, startLibraryTestServer, statusOf, type LibraryTestServer } from "./libraryFilesTestServer.ts";

let server: LibraryTestServer | null = null;

afterEach(async () => {
  await server?.close();
  server = null;
});

interface Started {
  readonly deviceCode: string;
  readonly userCode: string;
  readonly expiresAt: number;
}

const TV_AGENT = "Mozilla/5.0 (Linux; Android 12; BRAVIA 4K) NanimeAndroid/0.2.0 NanimeTV/0.2.0";

/** The TV: signed out, the Android TV user agent. */
async function startOnTv(target: LibraryTestServer): Promise<Started> {
  const response = await target.request("/api/auth/device", { method: "POST", cookie: null, headers: { "user-agent": TV_AGENT } });
  expect(response.status).toBe(200);
  return await response.json() as Started;
}

function poll(target: LibraryTestServer, deviceCode: string): Promise<Response> {
  return target.request("/api/auth/device/poll", { method: "POST", cookie: null, json: { deviceCode } });
}

function sessionCookieOf(response: Response): string {
  return /nanime_session=[^;]+/u.exec(response.headers.get("set-cookie") ?? "")?.[0] ?? "";
}

test("a TV signs in as the user who approves its code on their phone, once", async () => {
  server = await startLibraryTestServer();
  const target = server;
  const { deviceCode, userCode } = await startOnTv(target);
  expect(userCode).toMatch(/^[A-Z0-9]{8}$/u);

  const waiting = await poll(target, deviceCode);
  expect(await waiting.json()).toEqual({ status: "pending" });
  expect(sessionCookieOf(waiting)).toBe("");

  // The phone (signed in as admin) sees what's asking, typed with a dash and in lower case.
  const typed = `${userCode.slice(0, 4).toLowerCase()}-${userCode.slice(4)}`;
  const request = await getJson<{ readonly device: string }>(target, `/api/auth/device/${typed}`);
  expect(request.device).toBe("Android TV");
  expect(await statusOf(target.request("/api/auth/device/approve", { method: "POST", json: { userCode: typed } }))).toBe(204);

  const approved = await poll(target, deviceCode);
  expect(await approved.json()).toMatchObject({ status: "approved", user: { username: "admin", isAdmin: true } });
  const cookie = sessionCookieOf(approved);
  const me = await target.request("/api/auth/me", { cookie });
  expect(await me.json()).toMatchObject({ username: "admin" });

  // The approval hands out one session: polling again or reusing the code gets nothing.
  const again = await poll(target, deviceCode);
  expect(await again.json()).toEqual({ status: "expired" });
  expect(sessionCookieOf(again)).toBe("");
  expect(await statusOf(target.request("/api/auth/device/approve", { method: "POST", json: { userCode } }))).toBe(404);
}, 60_000);

test("only a signed-in browser can look up or approve a code, and a made-up code signs nothing in", async () => {
  server = await startLibraryTestServer();
  const target = server;
  const { deviceCode, userCode } = await startOnTv(target);

  expect(await statusOf(target.request(`/api/auth/device/${userCode}`, { cookie: null }))).toBe(401);
  expect(await statusOf(target.request("/api/auth/device/approve", { method: "POST", cookie: null, json: { userCode } }))).toBe(401);
  const keyResponse = await target.request("/api/agent-keys", { method: "POST", json: { name: "Agent" } });
  const { key } = await keyResponse.json() as { readonly key: string };
  const keyed = await fetch(`${target.origin}/api/auth/device/approve`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ userCode }),
  });
  expect(keyed.status).toBe(403);
  // A cross-site page can't approve with the user's cookie.
  expect(await statusOf(target.request("/api/auth/device/approve", { method: "POST", json: { userCode }, headers: { origin: "https://evil.example" } }))).toBe(403);
  expect(await statusOf(target.request("/api/auth/device/approve", { method: "POST", json: { userCode: "ACDEFGHJ" } }))).toBe(404);

  const stillWaiting = await poll(target, deviceCode);
  expect(await stillWaiting.json()).toEqual({ status: "pending" });
  const guessed = await poll(target, `${deviceCode}x`);
  expect(await guessed.json()).toEqual({ status: "expired" });
  expect(sessionCookieOf(guessed)).toBe("");
}, 60_000);
