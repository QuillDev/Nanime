// Test-only support: a real Nanime server process over an isolated, fictitious
// library and database, plus a loopback stand-in for qBittorrent's Web API.
import { Database } from "bun:sqlite";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const SETUP_TOKEN = "library-files-test-setup-token-000001";
const ADMIN_PASSWORD = "library-files-test-admin-password";
export const VIEWER_PASSWORD = "library-files-viewer-password";

export interface FakeTorrent {
  readonly hash: string;
  readonly name: string;
  readonly content: string;
  readonly progress: number;
}

/** How the fake qBittorrent answers a login; omitted means it needs none. */
export interface FakeLogin {
  readonly status: number;
  readonly body: string;
}

export interface FakeQbittorrent {
  readonly origin: string;
  setTorrents: (torrents: readonly FakeTorrent[]) => void;
  setReachable: (reachable: boolean) => void;
  stop: () => void;
}

/**
 * `cookie`: omitted or undefined sends the admin session, null sends none.
 * `json`: sent as the JSON request body.
 */
export type TestRequestInit = RequestInit & { readonly cookie?: string | null | undefined; readonly json?: unknown };

export interface LibraryTestServer {
  readonly origin: string;
  readonly media: string;
  readonly databasePath: string;
  readonly qbittorrent: FakeQbittorrent;
  readonly adminCookie: string;
  readonly request: (path: string, init?: TestRequestInit) => Promise<Response>;
  readonly database: () => Database;
  readonly log: () => string;
  /** Stops the server process (gracefully, or with SIGKILL as a crash) and starts it again on the same state. */
  readonly restart: (how?: "graceful" | "crash") => Promise<void>;
  readonly close: () => Promise<void>;
}

interface TestServerOptions {
  readonly qbittorrentLogin?: FakeLogin;
}

/** The fictitious library the route tests start from. */
export const LIBRARY_FIXTURE = {
  "Example Show/Season 1/Example Show - 01.mkv": "episode one",
  "Example Show/Season 1/Example Show - 01.en.ass": "[Script Info]",
  "Example Show/Season 1/Example Show - 02.mkv": "episode two",
  "Example Show/Season 2/Example Show - 03.mkv": "episode three",
  "Example Show/Misc/Notes.txt": "notes",
  "Other Show/Episode 1.mp4": "other episode",
  "Seeding Show/Seeding Show - 01.mkv": "seeding episode",
  "Incoming/Partial Show/Partial Show - 01.mkv": "partial episode",
} as const satisfies Readonly<Record<string, string>>;

export async function writeLibraryFixture(media: string): Promise<void> {
  for (const [path, contents] of Object.entries(LIBRARY_FIXTURE)) {
    const abs = join(media, ...path.split("/"));
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, contents);
  }
}

const QBITTORRENT_SESSION = "SID=fake-qbittorrent-session";

export function startFakeQbittorrent(login?: FakeLogin): FakeQbittorrent {
  let torrents: readonly FakeTorrent[] = [];
  let reachable = true;
  const removeTorrents = async (request: Request): Promise<Response> => {
    const form = await request.formData();
    const hashes = new Set(form.get("hashes")?.toString().split("|"));
    torrents = torrents.filter((torrent) => !hashes.has(torrent.hash));
    return new Response("");
  };
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const { pathname } = new URL(request.url);
      if (!reachable) {
        return new Response("unavailable", { status: 503 });
      }
      if (login !== undefined && pathname === "/api/v2/auth/login") {
        return new Response(login.body, { status: login.status, headers: { "set-cookie": `${QBITTORRENT_SESSION}; HttpOnly` } });
      }
      if (login !== undefined && request.headers.get("cookie") !== QBITTORRENT_SESSION) {
        return new Response("Forbidden", { status: 403 });
      }
      if (pathname === "/api/v2/torrents/delete") {
        return removeTorrents(request);
      }
      if (pathname !== "/api/v2/torrents/info") {
        return new Response("Not found", { status: 404 });
      }
      return Response.json(torrents.map((torrent) => ({
        hash: torrent.hash,
        name: torrent.name,
        content_path: torrent.content,
        progress: torrent.progress,
        state: torrent.progress < 1 ? "downloading" : "stalledUP",
        dlspeed: 0,
        eta: 0,
        completed: 0,
        size: 1,
        added_on: 1,
      })));
    },
  });
  return {
    origin: `http://127.0.0.1:${String(server.port)}`,
    setTorrents: (next) => {
      torrents = next;
    },
    setReachable: (next) => {
      reachable = next;
    },
    stop: () => {
      void server.stop(true);
    },
  };
}

function freePort(): number {
  const listener = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
  const { port } = listener;
  listener.stop(true);
  return port;
}

async function waitUntilReady(origin: string, child: Bun.Subprocess, output: () => string): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Test server exited (${String(child.exitCode)}):\n${output()}`);
    }
    const response = await fetch(`${origin}/api/auth/me`).catch(() => null);
    if (response !== null) {
      return;
    }
    await Bun.sleep(50);
  }
  throw new Error(`Test server did not start:\n${output()}`);
}

function collect(stream: ReadableStream<Uint8Array>): () => string {
  let text = "";
  const decoder = new TextDecoder();
  void (async (): Promise<void> => {
    for await (const chunk of stream) {
      text += decoder.decode(chunk, { stream: true });
    }
  })();
  return () => text;
}

function sessionCookie(response: Response): string {
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
  if (cookie === undefined || cookie === "") {
    throw new Error(`No session cookie (${String(response.status)})`);
  }
  return cookie;
}

interface ServerProcess {
  readonly child: Bun.Subprocess<"ignore", "pipe", "pipe">;
  readonly log: () => string;
}

async function spawnServer(origin: string, env: Record<string, string | undefined>): Promise<ServerProcess> {
  const child = Bun.spawn([process.execPath, "run", "server/app.ts"], {
    cwd: join(import.meta.dir, ".."), env, stdout: "pipe", stderr: "pipe",
  });
  const stdout = collect(child.stdout);
  const stderr = collect(child.stderr);
  const log = (): string => `${stdout()}\n${stderr()}`;
  await waitUntilReady(origin, child, log);
  return { child, log };
}

async function stopServer({ child }: ServerProcess, signal: "SIGTERM" | "SIGKILL"): Promise<void> {
  child.kill(signal);
  await Promise.race([child.exited, Bun.sleep(3000)]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await child.exited;
  }
}

export async function startLibraryTestServer(
  prepare: (media: string) => Promise<void> = writeLibraryFixture,
  options: TestServerOptions = {},
): Promise<LibraryTestServer> {
  const directory = await mkdtemp(join(tmpdir(), "nanime-library-files-"));
  const media = join(directory, "media");
  const databasePath = join(directory, "nanime.sqlite");
  await mkdir(media);
  await prepare(media);
  const qbittorrent = startFakeQbittorrent(options.qbittorrentLogin);
  const origin = `http://127.0.0.1:${String(freePort())}`;
  const login = options.qbittorrentLogin === undefined ? "" : "fake-qbittorrent-user";
  const env = {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: new URL(origin).port,
    MEDIA_DIR: media,
    NANIME_DATABASE: databasePath,
    NANIME_ADMIN_SETUP_TOKEN: SETUP_TOKEN,
    NANIME_PUBLIC_ORIGIN: origin,
    NANIME_SECURE_COOKIES: "false",
    NANIME_ANILIST_CLIENT_ID: "",
    NANIME_ANILIST_CLIENT_SECRET: "",
    NANIME_ANILIST_REDIRECT_URI: "",
    NANIME_TOKEN_ENCRYPTION_KEY: "",
    MEDIA_METADATA_FILE: join(directory, "metadata.json"),
    QBITTORRENT_URL: qbittorrent.origin,
    QBITTORRENT_USERNAME: login,
    QBITTORRENT_PASSWORD: login,
  };
  let running = await spawnServer(origin, env);
  const setup = await fetch(`${origin}/api/auth/setup`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ username: "admin", password: ADMIN_PASSWORD, setupToken: SETUP_TOKEN }),
  });
  const adminCookie = sessionCookie(setup);
  const request = (path: string, init: TestRequestInit = {}): Promise<Response> => {
    const headers = new Headers(init.headers);
    const cookie = init.cookie === undefined ? adminCookie : init.cookie;
    if (cookie !== null) {
      headers.set("cookie", cookie);
    }
    if (!headers.has("origin")) {
      headers.set("origin", origin);
    }
    const body = init.json === undefined ? init.body : JSON.stringify(init.json);
    if (typeof body === "string") {
      headers.set("content-type", "application/json");
    }
    return fetch(`${origin}${path}`, { ...init, headers, body: body ?? null });
  };
  return {
    origin,
    media,
    databasePath,
    qbittorrent,
    adminCookie,
    request,
    database: () => new Database(databasePath),
    log: () => running.log(),
    restart: async (how = "graceful") => {
      await stopServer(running, how === "crash" ? "SIGKILL" : "SIGTERM");
      running = await spawnServer(origin, env);
    },
    close: async () => {
      await stopServer(running, "SIGTERM");
      qbittorrent.stop();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

export async function viewerCookie(server: LibraryTestServer): Promise<string> {
  const created = await server.request("/api/users", { method: "POST", body: JSON.stringify({ username: "viewer", isAdmin: false }) });
  const { setupToken } = await created.json() as { readonly setupToken: string };
  const setup = await fetch(`${server.origin}/api/auth/setup`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: server.origin },
    body: JSON.stringify({ username: "viewer", password: VIEWER_PASSWORD, setupToken }),
  });
  return sessionCookie(setup);
}

export interface ListedItem {
  readonly id: string;
  readonly path: string;
  readonly kind: "file" | "folder";
  readonly media: string | null;
  readonly lock: { readonly source: string; readonly reason: string; readonly tone: string } | null;
}

export async function listedItems(server: LibraryTestServer): Promise<readonly ListedItem[]> {
  const response = await server.request("/api/library/files");
  if (!response.ok) {
    throw new Error(`Listing failed (${String(response.status)}): ${await response.text()}`);
  }
  const snapshot = await response.json() as { readonly items: readonly ListedItem[] };
  return snapshot.items;
}

export async function reference(server: LibraryTestServer, path: string): Promise<{ readonly path: string; readonly id: string }> {
  const items = await listedItems(server);
  const item = items.find((candidate) => candidate.path === path);
  if (item === undefined) {
    throw new Error(`Not listed: ${path}`);
  }
  return { path: item.path, id: item.id };
}

export async function fileOperation(server: LibraryTestServer, action: string, body?: unknown): Promise<{ readonly status: number; readonly text: string }> {
  const init: RequestInit = { method: "POST" };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  const response = await server.request(`/api/library/files/${action}`, init);
  return { status: response.status, text: await response.text() };
}

/** A minimal valid stored mapping, as metadata links would write it. */
export function fixtureMapping(title: string, id: number): string {
  return JSON.stringify({
    provider: "jikan", id, anilistId: null, idMal: id,
    title: { english: title, romaji: title, native: null },
    description: "Fictitious library fixture", coverImage: { extraLarge: null, large: null, color: null },
    bannerImage: null, episodes: 3, duration: 24, season: null, seasonYear: null, startDate: null,
    format: "TV", status: "FINISHED_AIRING", genres: [], averageScore: null,
    siteUrl: "https://example.invalid/nanime-library-fixture", streamingEpisodes: [],
  });
}

export async function operationStatus(server: LibraryTestServer, action: string, body?: unknown): Promise<number> {
  const result = await fileOperation(server, action, body);
  return result.status;
}

export async function idAt(server: LibraryTestServer, path: string): Promise<string> {
  const found = await reference(server, path);
  return found.id;
}

export async function statusOf(pending: Promise<Response>): Promise<number> {
  const response = await pending;
  return response.status;
}

export async function getJson<T>(server: LibraryTestServer, path: string, cookie?: string): Promise<T> {
  const response = await server.request(path, { cookie });
  return await response.json() as T;
}
