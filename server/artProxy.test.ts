import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { artResponse } from "./artProxy.ts";
import { withFakeUpstream } from "./testFetch.ts";
import { probeStreams } from "./testMedia.ts";
import { withTemporaryDirectory } from "./testProcess.ts";

async function bannerJpeg(): Promise<Uint8Array> {
  return await withTemporaryDirectory("nanime-art-", async (directory) => {
    const path = join(directory, "banner.jpg");
    const ffmpeg = Bun.spawn(["ffmpeg", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=1900x600", "-frames:v", "1", path], { stdin: "ignore" });
    expect(await ffmpeg.exited).toBe(0);
    return new Uint8Array(await readFile(path));
  });
}

function artUrl(source: string, width: number): URL {
  return new URL(`http://nanime.test/api/art?${new URLSearchParams({ src: source, w: String(width) }).toString()}`);
}

async function widthOf(response: Response): Promise<number | undefined> {
  return await withTemporaryDirectory("nanime-art-out-", async (directory) => {
    const path = join(directory, "art.webp");
    await Bun.write(path, await response.arrayBuffer());
    const [stream] = await probeStreams(path);
    return stream?.width;
  });
}

test("show art is served resized to the asked width as WebP, made once and then read from disk", async () => {
  const banner = await bannerJpeg();
  const source = `https://s4.anilist.co/file/anilistcdn/media/anime/banner/${crypto.randomUUID()}.jpg`;
  let fetches = 0;
  await withFakeUpstream((url) => {
    fetches += 1;
    return url.href === source
      ? new Response(banner, { headers: { "content-type": "image/jpeg" } })
      : new Response("missing", { status: 404 });
  }, async () => {
    const small = await artResponse(artUrl(source, 640));
    expect(small.status).toBe(200);
    expect(small.headers.get("content-type")).toBe("image/webp");
    expect(small.headers.get("cache-control")).toContain("immutable");
    expect(await widthOf(small)).toBe(640);

    // Never upscaled past the original.
    const large = await artResponse(artUrl(source, 1920));
    expect(await widthOf(large)).toBe(1900);
    expect(fetches).toBe(2);
    const again = await artResponse(artUrl(source, 640));
    expect(await widthOf(again)).toBe(640);
    expect(fetches).toBe(2);
  });
}, 30_000);

test("art outside AniList or at an unlisted width is refused, and an unreachable image falls back to the original", async () => {
  const refused = await Promise.all([
    artResponse(artUrl("https://example.com/cover.jpg", 320)),
    artResponse(artUrl("http://s4.anilist.co/cover.jpg", 320)),
    artResponse(artUrl("https://s4.anilist.co/cover.jpg", 333)),
  ]);
  expect(refused.map((response) => response.status)).toEqual([400, 400, 400]);
  const missing = `https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/${crypto.randomUUID()}.png`;
  await withFakeUpstream(() => new Response("gone", { status: 404 }), async () => {
    const response = await artResponse(artUrl(missing, 320));
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(missing);
  });
});
