import type { NyaaSearchResult } from "../../src/types.ts";

export const results: NyaaSearchResult[] = [1, 2, 3, 4, 5].map((id) => ({
  id: String(id), name: `Fixture ${String(id)}`, magnet: `magnet:?xt=urn:btih:${String(id).repeat(40)}`,
  detailsUrl: `https://nyaa.si/view/${String(id)}`, category: "Anime", size: "1 GiB",
  seeders: 10, leechers: 0, downloads: 1, publishedAt: "2026-01-01", trusted: false, remake: false,
}));

export class TorrentFixture {
  public readonly added: { magnet: string; showFolder: string }[] = [];
  public rejectSecond = true;
  public maximumActive = 0;
  private active = 0;

  public async add(request: Request): Promise<Response> {
    const body = await request.json() as { magnet: string; showFolder: string };
    this.active += 1;
    this.maximumActive = Math.max(this.maximumActive, this.active);
    await Bun.sleep(500);
    this.active -= 1;
    if (body.magnet === results[1]?.magnet && this.rejectSecond) {
      return Response.json({ message: "Fixture provider unavailable" }, { status: 502 });
    }
    this.added.push(body);
    return Response.json({ success: true });
  }
}

async function buildFixture(): Promise<string> {
  const build = Bun.spawn([process.execPath, "build", new URL("searchFixture.tsx", import.meta.url).pathname, "--target", "browser"], { stdout: "pipe", stderr: "pipe" });
  const script = await new Response(build.stdout).text();
  if (await build.exited !== 0) {
    throw new Error(await new Response(build.stderr).text());
  }
  return script;
}

async function fixtureCss(): Promise<string> {
  const files = [...new Bun.Glob("dist/assets/*.css").scanSync()];
  const styles = await Promise.all(files.map((file) => Bun.file(file).text()));
  return styles.join("\n");
}

export async function startFixture(provider: TorrentFixture): Promise<Bun.Server<undefined>> {
  const script = await buildFixture();
  const css = await fixtureCss();
  return Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/fixture.js") {
      return new Response(script, { headers: { "content-type": "text/javascript" } });
    }
    if (url.pathname === "/fixture.css") {
      return new Response(css, { headers: { "content-type": "text/css" } });
    }
    if (url.pathname === "/api/torrents/search") {
      return Response.json(results);
    }
    if (url.pathname === "/api/torrents" && request.method === "POST") {
      return provider.add(request);
    }
    return new Response('<html><head><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>', { headers: { "content-type": "text/html" } });
  } });
}

export async function waitFor(view: Bun.WebView, expression: string, deadline = Date.now() + 10_000): Promise<void> {
  if (await view.evaluate<boolean>(expression)) {
    return;
  }
  if (Date.now() >= deadline) {
    throw new Error(`Timed out: ${expression}`);
  }
  await Bun.sleep(20);
  await waitFor(view, expression, deadline);
}

export async function click(view: Bun.WebView, label: string): Promise<void> {
  const selector = `[aria-label=${JSON.stringify(label)}]`;
  await waitFor(view, `document.querySelector(${JSON.stringify(selector)}) !== null`);
  await view.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
}

export async function downloadSelected(view: Bun.WebView): Promise<void> {
  await view.evaluate('Array.from(document.querySelectorAll("button")).find(button => button.textContent.includes("Download selected")).click()');
}

export async function screenshot(view: Bun.WebView, name: string): Promise<void> {
  const directory = Bun.env["NANIME_NYAA_SCREENSHOTS"];
  if (directory !== undefined) {
    await Bun.write(`${directory}/${name}.png`, await view.screenshot());
  }
}

export async function runFixture(verify: (view: Bun.WebView, provider: TorrentFixture) => Promise<void>): Promise<void> {
  const provider = new TorrentFixture();
  const server = await startFixture(provider);
  const view = openBrowser();
  try {
    await view.navigate(server.url.href);
    await verify(view, provider);
  } finally {
    view.close();
    await server.stop(true);
  }
}

export function openBrowser(): Bun.WebView {
  const browserUrl = Bun.env["NANIME_CHROME_URL"];
  return new Bun.WebView({ width: 1200, height: 900, backend: browserUrl ? { type: "chrome", url: browserUrl } : { type: "chrome", path: Bun.env["NANIME_CHROME_PATH"] ?? Bun.which("google-chrome") ?? Bun.which("chromium") ?? "chromium", argv: ["--no-sandbox"] } });
}
