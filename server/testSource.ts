// Test-only support: a loopback stand-in for a site that serves episode files
// and HLS streams. Every request must carry SOURCE_HEADER, the way real sites
// require a referer or token, so tests prove headers reach every request.
import { readFile } from "node:fs/promises";
import { once } from "node:events";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join } from "node:path";

export const SOURCE_HEADER = { "x-source-key": "fake-source-key" } as const;

interface Served {
  readonly bytes: Uint8Array;
  /** Bytes per write and the pause between writes; unset sends everything at once. */
  readonly throttle?: { readonly chunk: number; readonly delayMs: number };
  /** `ignored`: always the whole file (200). `from-start`: a 206 from byte 0 whatever was asked. */
  readonly ranges?: "ignored" | "from-start";
  /** Most bytes one response carries, the way some CDNs cap each answer; the rest needs another request. */
  readonly pieceSize?: number;
}

export interface FakeSource {
  readonly origin: string;
  readonly url: (path: string) => string;
  serve: (path: string, served: Served) => void;
  /** Serves every file in `directory` under `prefix/`. */
  serveDirectory: (prefix: string, directory: string) => void;
  /** Answers `path` with `status` until cleared with null. */
  fail: (path: string, status: number | null) => void;
  /** The Range header of each request for `path`, oldest first (null when absent). */
  ranges: (path: string) => readonly (string | null)[];
  stop: () => void;
}

function rangeStart(header: string | undefined, size: number): number | null {
  const start = /^bytes=(?<start>\d+)-$/u.exec(header ?? "")?.groups?.["start"];
  return start === undefined || Number(start) >= size ? null : Number(start);
}

/** Where the answer starts, as this site's range behavior has it; null for a whole-file 200. */
function answeredStart(served: Served, header: string | undefined): number | null {
  const asked = served.ranges === "ignored" ? null : rangeStart(header, served.bytes.byteLength);
  const requested = served.ranges === "from-start" && asked !== null ? 0 : asked;
  return served.pieceSize === undefined ? requested : requested ?? 0;
}

/** Writes the file (or the requested tail) with a real Content-Length, throttled when asked. */
async function respond(served: Served, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const size = served.bytes.byteLength;
  const start = answeredStart(served, request.headers.range);
  const end = Math.min(size, (start ?? 0) + (served.pieceSize ?? size));
  const bytes = served.bytes.subarray(start ?? 0, end);
  const range = start === null ? {} : { "content-range": `bytes ${String(start)}-${String(end - 1)}/${String(size)}` };
  response.writeHead(start === null ? 200 : 206, { "content-length": String(bytes.byteLength), "accept-ranges": "bytes", ...range });
  const chunk = served.throttle?.chunk ?? bytes.byteLength;
  for (let offset = 0; offset < bytes.byteLength && !response.destroyed; offset += chunk) {
    if (served.throttle !== undefined) {
      await Bun.sleep(served.throttle.delayMs);
    }
    response.write(bytes.subarray(offset, offset + chunk));
  }
  response.end();
}

export async function startFakeSource(): Promise<FakeSource> {
  const files = new Map<string, Served>();
  const directories = new Map<string, string>();
  const failures = new Map<string, number>();
  const seen = new Map<string, (string | null)[]>();
  const fromDirectory = async (path: string): Promise<Served | undefined> => {
    const [, prefix = "", ...rest] = path.split("/");
    const directory = directories.get(prefix);
    const bytes = directory === undefined ? null : await readFile(join(directory, ...rest)).catch(() => null);
    return bytes === null ? undefined : { bytes };
  };
  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const { pathname } = new URL(request.url ?? "/", "http://source.invalid");
    if (request.headers["x-source-key"] !== SOURCE_HEADER["x-source-key"]) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    seen.set(pathname, [...seen.get(pathname) ?? [], request.headers.range ?? null]);
    const failure = failures.get(pathname);
    const served = files.get(pathname) ?? await fromDirectory(pathname);
    if (failure !== undefined || served === undefined) {
      response.writeHead(failure ?? 404).end("Unavailable");
      return;
    }
    await respond(served, request, response);
  };
  const server = createServer((request, response) => {
    void handle(request, response);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  const origin = `http://127.0.0.1:${String(port)}`;
  return {
    origin,
    url: (path) => `${origin}${path}`,
    serve: (path, served) => { files.set(path, served); },
    serveDirectory: (prefix, directory) => { directories.set(prefix, directory); },
    fail: (path, status) => {
      if (status === null) {
        failures.delete(path);
      } else {
        failures.set(path, status);
      }
    },
    ranges: (path) => seen.get(path) ?? [],
    stop: () => {
      server.closeAllConnections();
      server.close();
    },
  };
}
