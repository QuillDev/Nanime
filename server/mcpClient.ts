import { readFile } from "node:fs/promises";
import { treaty } from "@elysiajs/eden";
import type { App } from "./app.ts";

/** Where the MCP server finds Nanime and the admin account it signs in as. */
export interface NanimeConnection {
  readonly baseUrl: string;
  readonly username: string;
  readonly password: string;
}

const SESSION_COOKIE = /(?:^|[,\s])(?<cookie>nanime_session=[^;,\s]+)/u;

/** Reads `NANIME_URL`, `NANIME_USERNAME` and the password from the file `NANIME_PASSWORD_FILE` names. */
export async function connectionFromEnvironment(env: NodeJS.ProcessEnv): Promise<NanimeConnection> {
  const baseUrl = env["NANIME_URL"] ?? "";
  const username = env["NANIME_USERNAME"] ?? "";
  const passwordFile = env["NANIME_PASSWORD_FILE"] ?? "";
  if (URL.parse(baseUrl) === null || username === "" || passwordFile === "") {
    throw new Error("Set NANIME_URL, NANIME_USERNAME and NANIME_PASSWORD_FILE");
  }
  const contents = await readFile(passwordFile, "utf8");
  const password = contents.trim();
  return { baseUrl: new URL(baseUrl).origin, username, password };
}

/** The session cookie, or Nanime's refusal (wrong password, throttled) to hand back as the answer. */
async function signIn(connection: NanimeConnection): Promise<string | Response> {
  const response = await fetch(`${connection.baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: connection.baseUrl },
    body: JSON.stringify({ username: connection.username, password: connection.password }),
  });
  const cookie = SESSION_COOKIE.exec(response.headers.get("set-cookie") ?? "")?.groups?.["cookie"];
  return response.ok && cookie !== undefined ? cookie : response;
}

function withSession(init: RequestInit | undefined, cookie: string, origin: string): RequestInit {
  const headers = new Headers(init?.headers);
  headers.set("cookie", cookie);
  // Nanime refuses writes without its own origin; this client is not a browser.
  headers.set("origin", origin);
  return { ...init, headers };
}

/**
 * Error bodies read whole: Eden hands a chunked text body back as a stream, and
 * the tools want the route's message.
 */
async function buffered(response: Response): Promise<Response> {
  const text = await response.text();
  return new Response(text, { status: response.status, headers: { "content-type": "text/plain" } });
}

/**
 * An Eden client for Nanime's API that signs in on first use and again when
 * the session expires, so every call goes through the same routes, checks and
 * admin boundary as the web app.
 */
export function nanimeClient(connection: NanimeConnection) {
  let session: Promise<string | Response> | null = null;
  const sendSigned = async (input: string | URL | Request, init: RequestInit | undefined): Promise<Response> => {
    session ??= signIn(connection);
    const cookie = await session;
    if (cookie instanceof Response) {
      session = null;
      return cookie;
    }
    return await fetch(input, withSession(init, cookie, connection.baseUrl));
  };
  const send = async (input: string | URL | Request, init: RequestInit | undefined): Promise<Response> => {
    const first = await sendSigned(input, init);
    // A 401 after a good sign-in means the session expired or was signed out: sign in once more.
    const retry = first.status === 401 && session !== null;
    session = retry ? null : session;
    const response = retry ? await sendSigned(input, init) : first;
    return response.ok ? response : await buffered(response);
  };
  const fetcher = Object.assign(send, { preconnect: fetch.preconnect });
  return treaty<App>(connection.baseUrl, { fetcher, parseDate: false });
}

export type NanimeClient = ReturnType<typeof nanimeClient>;
