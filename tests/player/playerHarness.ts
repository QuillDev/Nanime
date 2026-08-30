import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Database } from "bun:sqlite";
import { PLAYER_PROXY_ENTRYPOINT } from "./playerProxy.ts";

const ADMIN_SETUP_TOKEN = "nanime-player-harness-setup-token-0001";
const ADMIN_PASSWORD = "nanime-player-harness-password";
const FIXTURE_FOLDER = "Browser Fixture Show";
export const HLS_FIXTURE = `${FIXTURE_FOLDER}/Browser Fixture - 01.mkv`;
export const DIRECT_FIXTURE = `${FIXTURE_FOLDER}/Browser Fixture - 02.mp4`;
export const FIXTURE_DURATION = 48;

const FIXTURE_METADATA = {
  provider: "jikan",
  id: 1,
  anilistId: null,
  idMal: 1,
  title: { english: FIXTURE_FOLDER, romaji: FIXTURE_FOLDER, native: null },
  description: "Generated browser player test fixture",
  coverImage: { extraLarge: null, large: null, color: null },
  bannerImage: null,
  episodes: 2,
  duration: 2,
  season: null,
  seasonYear: null,
  startDate: null,
  format: "TV",
  status: "FINISHED_AIRING",
  genres: [],
  averageScore: null,
  siteUrl: "https://example.invalid/nanime-player-fixture",
  streamingEpisodes: [],
};

interface PlayerState {
  readonly bufferedEnd: number;
  readonly controlsVisible: boolean;
  readonly duration: number;
  readonly error: string | null;
  readonly paused: boolean;
  readonly readyState: number;
  readonly timelinePosition: number;
  readonly videoTime: number;
}

interface NetworkResponseEvent {
  readonly response: { readonly status: number; readonly url: string };
}

interface NetworkRequestEvent {
  readonly request: { readonly url: string };
}

export interface PlayerView {
  readonly consoleErrors: string[];
  readonly manifestRequests: string[];
  readonly networkResponses: { readonly status: number; readonly url: string }[];
  readonly view: Bun.WebView;
  close: () => Promise<void>;
}

export interface PlayerHarness {
  readonly browserPath: string;
  readonly origin: string;
  readonly serverLog: () => string;
  readonly temporaryRoot: string;
  close: () => Promise<void>;
  openApp: () => Promise<PlayerView>;
  openPlayer: (rel: string, options?: { readonly failFirstManifest?: boolean }) => Promise<PlayerView>;
}

interface ProcessOutput {
  readonly completed: Promise<void>;
  readonly output: () => string;
}

interface HarnessProxy {
  readonly failNextManifest: () => Promise<void>;
  readonly output: ProcessOutput;
  readonly process: Bun.Subprocess;
}

interface WaitForPlayerStateOptions {
  readonly view: Bun.WebView;
  readonly predicate: (state: PlayerState) => boolean;
  readonly description: string;
  readonly timeout?: number;
}

interface CaptureFailureOptions {
  readonly player: PlayerView;
  readonly name: string;
  readonly serverLog: string;
  readonly error: unknown;
}

interface TimedOperationOptions<T> {
  readonly description: string;
  readonly operation: Promise<T>;
  readonly timeout?: number;
}

function requiredExecutable(names: readonly string[]): string {
  for (const name of names) {
    const executable = Bun.which(name);
    if (executable !== null) {
      return executable;
    }
  }
  throw new Error(`Player browser harness requires one of: ${names.join(", ")}`);
}

function timedOperation<T>(options: TimedOperationOptions<T>): Promise<T> {
  const timeout = options.timeout ?? 15_000;
  const timeoutFailure = (async (): Promise<never> => {
    await Bun.sleep(timeout);
    throw new Error(`Timed out waiting for ${options.description}`);
  })();
  return Promise.race([options.operation, timeoutFailure]);
}

async function run(command: readonly string[]): Promise<void> {
  const process = Bun.spawn(command, { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`${command[0] ?? "Command"} failed (${String(exitCode)})\n${stdout}${stderr}`);
  }
}

async function generateFixture(mediaDirectory: string): Promise<void> {
  const ffmpeg = requiredExecutable(["ffmpeg"]);
  requiredExecutable(["ffprobe"]);
  const folder = join(mediaDirectory, FIXTURE_FOLDER);
  const hlsFixture = join(mediaDirectory, HLS_FIXTURE);
  const directFixture = join(mediaDirectory, DIRECT_FIXTURE);
  await mkdir(folder, { recursive: true });
  await run([
    ffmpeg, "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", `testsrc2=size=426x240:rate=24:duration=${String(FIXTURE_DURATION)}`,
    "-f", "lavfi", "-i", `sine=frequency=440:sample_rate=48000:duration=${String(FIXTURE_DURATION)}`,
    "-f", "lavfi", "-i", `sine=frequency=880:sample_rate=48000:duration=${String(FIXTURE_DURATION)}`,
    "-map", "0:v:0", "-map", "1:a:0", "-map", "2:a:0",
    "-c:v", "libx264", "-preset", "ultrafast", "-crf", "32", "-pix_fmt", "yuv420p",
    "-g", "48", "-keyint_min", "48", "-sc_threshold", "0",
    "-c:a", "aac", "-b:a", "64k",
    "-metadata:s:a:0", "language=eng", "-metadata:s:a:1", "language=jpn",
    "-disposition:a:0", "default", "-shortest", hlsFixture,
  ]);
  await run([
    ffmpeg, "-hide_banner", "-loglevel", "error", "-i", hlsFixture,
    "-map", "0:v:0", "-c:v", "copy", "-an", "-movflags", "+faststart",
    directFixture,
  ]);
}

function availablePort(): number {
  const listener = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: { data() {} },
  });
  const { port } = listener;
  listener.stop(true);
  return port;
}

async function waitForServer(origin: string, process: Bun.Subprocess): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (process.exitCode !== null) {
      throw new Error(`Player harness server exited with ${String(process.exitCode)}`);
    }
    const response = await fetch(origin).catch(() => null);
    if (response?.ok === true) {
      return;
    }
    await Bun.sleep(50);
  }
  throw new Error("Timed out waiting for the player harness server");
}

async function createAdmin(origin: string): Promise<void> {
  const response = await fetch(`${origin}/api/auth/setup`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({
      username: "admin",
      password: ADMIN_PASSWORD,
      setupToken: ADMIN_SETUP_TOKEN,
    }),
  });
  if (!response.ok) {
    throw new Error(`Player harness admin setup failed (${String(response.status)}): ${await response.text()}`);
  }
}

function seedFixtureMetadata(databasePath: string): void {
  const database = new Database(databasePath);
  try {
    database.query(`
      INSERT INTO media_metadata (key, payload, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at
    `).run(`show:${FIXTURE_FOLDER}`, JSON.stringify(FIXTURE_METADATA), Date.now());
  } finally {
    database.close();
  }
}

function browserConsole(errors: string[]) {
  return (type: string, ...arguments_: unknown[]): void => {
    if (type === "error") {
      errors.push(arguments_.map(String).join(" "));
    }
  };
}

function observeNetwork(view: Bun.WebView, player: PlayerView): void {
  view.addEventListener<NetworkResponseEvent>("Network.responseReceived", (event) => {
    const { status, url } = event.data.response;
    if (url.includes("/hls/") || url.includes("/stream")) {
      player.networkResponses.push({ status, url });
    }
  });
}

async function login(view: Bun.WebView): Promise<void> {
  const result = await view.evaluate<{ readonly status: number; readonly body: string }>(`
    fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: ${JSON.stringify(ADMIN_PASSWORD)} })
    }).then(async response => ({ status: response.status, body: await response.text() }))
  `);
  if (result.status !== 200) {
    throw new Error(`Player harness login failed (${String(result.status)}): ${result.body}`);
  }
}

async function openPlayer(
  harness: Pick<PlayerHarness, "browserPath" | "origin"> & {
    readonly failNextManifest: () => Promise<void>;
  },
  rel: string,
  options: { readonly failFirstManifest?: boolean } = {},
): Promise<PlayerView> {
  const player = await openApp(harness);
  try {
    if (options.failFirstManifest === true) {
      await harness.failNextManifest();
    }
    const playerUrl = new URL(harness.origin);
    playerUrl.searchParams.set("episode", rel);
    await timedOperation({ operation: player.view.navigate(playerUrl.href), description: "player route" });
    return player;
  } catch (error: unknown) {
    await player.close();
    throw error;
  }
}

async function openApp(
  harness: Pick<PlayerHarness, "browserPath" | "origin">,
): Promise<PlayerView> {
  const consoleErrors: string[] = [];
  const view = new Bun.WebView({
    width: 1280,
    height: 720,
    backend: {
      type: "chrome",
      path: harness.browserPath,
      argv: ["--autoplay-policy=no-user-gesture-required", "--no-sandbox"],
    },
    console: browserConsole(consoleErrors),
  });
  const player: PlayerView = {
    consoleErrors,
    manifestRequests: [],
    networkResponses: [],
    view,
    close: () => {
      view.close();
      return Promise.resolve();
    },
  };
  try {
    await timedOperation({ operation: view.navigate(harness.origin), description: "application shell" });
    await view.cdp("Network.enable");
    observeNetwork(view, player);
    view.addEventListener<NetworkRequestEvent>("Network.requestWillBeSent", (event) => {
      const { request } = event.data;
      if (request.url.includes("/hls/index")) {
        player.manifestRequests.push(request.url);
      }
    });
    await timedOperation({ operation: login(view), description: "browser login" });
    await timedOperation({ operation: view.navigate(harness.origin), description: "authenticated application shell" });
    return player;
  } catch (error: unknown) {
    view.close();
    throw error;
  }
}

async function stopProcess(process: Bun.Subprocess): Promise<void> {
  if (process.exitCode !== null) {
    return;
  }
  process.kill("SIGTERM");
  await Promise.race([process.exited, Bun.sleep(3000)]);
  if (process.exitCode === null) {
    process.kill("SIGKILL");
    await process.exited;
  }
}

function captureProcessOutput(stream: ReadableStream<Uint8Array>): ProcessOutput {
  const decoder = new TextDecoder();
  let output = "";
  const completed = (async (): Promise<void> => {
    for await (const chunk of stream) {
      output += decoder.decode(chunk, { stream: true });
    }
    output += decoder.decode();
  })();
  return { completed, output: () => output };
}

async function startHarnessProxy(
  port: number,
  backendOrigin: string,
  publicOrigin: string,
): Promise<HarnessProxy> {
  const proxyProcess = Bun.spawn([process.execPath, "run", PLAYER_PROXY_ENTRYPOINT], {
    cwd: process.cwd(),
    env: { ...process.env, BACKEND_ORIGIN: backendOrigin, PORT: String(port) },
    stdout: "pipe",
    stderr: "pipe",
  });
  const standardOutput = captureProcessOutput(proxyProcess.stdout);
  const errorOutput = captureProcessOutput(proxyProcess.stderr);
  await waitForServer(`${publicOrigin}/__player-harness/health`, proxyProcess);
  return {
    process: proxyProcess,
    output: {
      completed: (async (): Promise<void> => {
        await Promise.all([standardOutput.completed, errorOutput.completed]);
      })(),
      output: () => `${standardOutput.output()}\n${errorOutput.output()}`,
    },
    failNextManifest: async () => {
      const response = await fetch(`${publicOrigin}/__player-harness/fail-next-manifest`, {
        method: "POST",
      });
      if (!response.ok) {
        throw new Error(`Could not arm transient manifest failure (${String(response.status)})`);
      }
    },
  };
}

export async function startPlayerHarness(): Promise<PlayerHarness> {
  if (Bun.version !== "1.4.0") {
    throw new Error(`Player harness requires Bun 1.4.0; received ${Bun.version}`);
  }
  const browserPath = requiredExecutable([
    "google-chrome-stable", "google-chrome", "chromium", "chromium-browser",
  ]);
  const temporaryRoot = await mkdtemp(join(tmpdir(), "nanime-player-harness-"));
  const mediaDirectory = join(temporaryRoot, "media");
  await mkdir(mediaDirectory);
  await generateFixture(mediaDirectory);
  const backendPort = availablePort();
  let publicPort = availablePort();
  while (publicPort === backendPort) {
    publicPort = availablePort();
  }
  const backendOrigin = `http://127.0.0.1:${String(backendPort)}`;
  const origin = `http://127.0.0.1:${String(publicPort)}`;
  const databasePath = join(temporaryRoot, "nanime.sqlite");
  const server = Bun.spawn([process.execPath, "run", "server/app.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      HWACCEL: "",
      MEDIA_DIR: mediaDirectory,
      NANIME_ADMIN_SETUP_TOKEN: ADMIN_SETUP_TOKEN,
      NANIME_ANILIST_CLIENT_ID: "",
      NANIME_ANILIST_CLIENT_SECRET: "",
      NANIME_ANILIST_REDIRECT_URI: "",
      NANIME_DATABASE: databasePath,
      NANIME_PUBLIC_ORIGIN: origin,
      NANIME_SECURE_COOKIES: "false",
      NANIME_TOKEN_ENCRYPTION_KEY: "",
      PORT: String(backendPort),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = captureProcessOutput(server.stdout);
  const stderr = captureProcessOutput(server.stderr);
  await waitForServer(backendOrigin, server);
  seedFixtureMetadata(databasePath);
  const proxy = await startHarnessProxy(publicPort, backendOrigin, origin);
  await createAdmin(origin);
  return {
    browserPath,
    origin,
    temporaryRoot,
    serverLog: () => `${stdout.output()}\n${stderr.output()}\n${proxy.output.output()}`,
    openApp: () => openApp({ browserPath, origin }),
    openPlayer: (rel, options) => openPlayer({
      browserPath,
      origin,
      failNextManifest: proxy.failNextManifest,
    }, rel, options),
    close: async () => {
      await stopProcess(proxy.process);
      await stopProcess(server);
      await Promise.all([stdout.completed, stderr.completed, proxy.output.completed]);
      const logs = `${stdout.output()}\n${stderr.output()}\n${proxy.output.output()}`;
      await Bun.write(join(temporaryRoot, "server.log"), logs);
      await rm(temporaryRoot, { recursive: true, force: true });
    },
  };
}

export function playerState(view: Bun.WebView): Promise<PlayerState | null> {
  return view.evaluate<PlayerState | null>(`(() => {
    const video = document.querySelector("video");
    const timeline = document.querySelector("#player-playback-position");
    const player = document.querySelector("[data-player-controls-visible]");
    if (!(video instanceof HTMLVideoElement) || !(timeline instanceof HTMLInputElement)) return null;
    const bufferedEnd = video.buffered.length === 0 ? 0 : video.buffered.end(video.buffered.length - 1);
    const text = document.body.innerText;
    return {
      bufferedEnd,
      controlsVisible: player?.getAttribute("data-player-controls-visible") === "true",
      duration: timeline.max === "" ? 0 : Number(timeline.max),
      error: text.includes("Video playback failed") || text.includes("HLS playback failed")
        ? text.slice(-2000) : null,
      paused: video.paused,
      readyState: video.readyState,
      timelinePosition: Number(timeline.value),
      videoTime: video.currentTime,
    };
  })()`);
}

export async function waitForPlayerState(options: WaitForPlayerStateOptions): Promise<PlayerState> {
  const { description, predicate, view } = options;
  const timeout = options.timeout ?? 30_000;
  const deadline = Date.now() + timeout;
  let latest: PlayerState | null = null;
  while (Date.now() < deadline) {
    latest = await playerState(view);
    if (latest !== null && predicate(latest)) {
      return latest;
    }
    await Bun.sleep(100);
  }
  throw new Error(`Timed out waiting for ${description}; last state: ${JSON.stringify(latest)}`);
}

export function timelineBounds(view: Bun.WebView): Promise<{
  readonly left: number; readonly top: number; readonly width: number; readonly height: number;
}> {
  return view.evaluate(`(() => {
    const timeline = document.querySelector("#player-playback-position");
    if (!(timeline instanceof HTMLInputElement) || timeline.parentElement === null) {
      throw new Error("Player timeline is missing");
    }
    const bounds = timeline.parentElement.getBoundingClientRect();
    return { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height };
  })()`);
}

export async function captureFailure(options: CaptureFailureOptions): Promise<never> {
  const { error, name, player, serverLog } = options;
  const directory = join(process.cwd(), "test-results");
  await mkdir(directory, { recursive: true });
  const screenshot = join(directory, `${name}.png`);
  await Bun.write(screenshot, await player.view.screenshot());
  const diagnostic = {
    consoleErrors: player.consoleErrors,
    manifestRequests: player.manifestRequests,
    networkResponses: player.networkResponses,
    serverLog,
  };
  throw new Error(`${String(error)}\nPlayer harness diagnostic: ${JSON.stringify(diagnostic, null, 2)}\nScreenshot: ${screenshot}`);
}
