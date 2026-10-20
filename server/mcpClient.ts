import { treaty } from "@elysiajs/eden";
import type { App } from "./app.ts";

/** Where the MCP server finds Nanime and the agent key it signs requests with. */
export interface NanimeConnection {
  readonly baseUrl: string;
  readonly key: string;
}

/** Reads `NANIME_URL` and `NANIME_KEY` (an agent key from Admin → Agents). */
export function connectionFromEnvironment(env: NodeJS.ProcessEnv): NanimeConnection {
  const baseUrl = URL.parse(env["NANIME_URL"] ?? "");
  const key = env["NANIME_KEY"]?.trim() ?? "";
  if (baseUrl === null || key === "") {
    throw new Error("Set NANIME_URL and NANIME_KEY (create a key in Nanime under Admin → Agents)");
  }
  return { baseUrl: baseUrl.origin, key };
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
 * An Eden client for Nanime's API, signed with the agent key, so every call
 * goes through the same routes, checks and admin boundary as the web app.
 */
export function nanimeClient(connection: NanimeConnection) {
  const send = async (input: string | URL | Request, init: RequestInit | undefined): Promise<Response> => {
    const headers = new Headers(init?.headers);
    headers.set("authorization", `Bearer ${connection.key}`);
    const response = await fetch(input, { ...init, headers });
    return response.ok ? response : await buffered(response);
  };
  const fetcher = Object.assign(send, { preconnect: fetch.preconnect });
  return treaty<App>(connection.baseUrl, { fetcher, parseDate: false });
}

export type NanimeClient = ReturnType<typeof nanimeClient>;
