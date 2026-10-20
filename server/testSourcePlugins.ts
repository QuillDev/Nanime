// Test-only support: a fictional Mangayomi-style repository and the site its
// plugins scrape, served by a FakeSource. The plugins are written the way real
// Mangayomi JS extensions are: MProvider subclasses using Client, Document,
// SharedPreferences and the source's baseUrl.
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { makeClip, run } from "./testMedia.ts";
import { temporaryDirectory } from "./testProcess.ts";
import { SOURCE_HEADER, type FakeSource } from "./testSource.ts";

export const SHOW_TITLE = "Lantern Ferry Club";
export const MAGNET_HASH = "cd".repeat(20);

/** A site scraper: search pages per audio setting, a show page, and one JSON stream link per episode. */
const LANTERN_PLUGIN = String.raw`
const mangayomiSources = [{ "name": "Lantern Stream" }];

class DefaultExtension extends MProvider {
  getHeaders() {
    return { "x-source-key": "${SOURCE_HEADER["x-source-key"]}" };
  }

  async page(path) {
    const response = await new Client().get(this.source.baseUrl + path, this.getHeaders());
    if (response.statusCode !== 200) throw new Error("site answered " + response.statusCode);
    return response.body;
  }

  async search(query, page, filters) {
    const audio = new SharedPreferences().get("audio");
    const document = new Document(await this.page("/search-" + audio + ".html?q=" + encodeURIComponent(query)));
    const list = document.select("li.show").map((item) => ({
      name: item.selectFirst("a").text.trim(),
      link: item.selectFirst("a").getHref,
      imageUrl: item.selectFirst("img").attr("src"),
    }));
    return { list, hasNextPage: filters.length === 1 && page === 1 };
  }

  async getDetail(url) {
    const document = new Document(await this.page(url));
    return {
      name: document.selectFirst("h1").text,
      description: document.selectFirst("p.synopsis").text.substringBefore(" (more)"),
      genre: document.select("span.genre").map((genre) => genre.text),
      episodes: document.select("a.episode").map((episode) => ({ name: episode.text, url: episode.attr("href") })),
    };
  }

  async getVideoList(url) {
    if (url.startsWith("magnet-")) {
      return [{ url: "magnet:?xt=urn:btih:${MAGNET_HASH}&dn=Lantern%20Ferry%20Club%20Batch", originalUrl: url, quality: "1080p" }];
    }
    const stream = JSON.parse(await this.page(url));
    return [
      { url: "", originalUrl: "", quality: "broken server" },
      {
        url: this.source.baseUrl + stream.file,
        originalUrl: this.source.baseUrl + stream.file,
        quality: "1080p",
        headers: this.getHeaders(),
        subtitles: stream.subtitle === undefined ? [] : [{ file: this.source.baseUrl + stream.subtitle, label: "English" }],
      },
    ];
  }

  getFilterList() {
    return [{ type_name: "SelectFilter", name: "Type", state: 0, values: [] }];
  }

  getSourcePreferences() {
    return [{
      key: "audio",
      listPreference: { title: "Audio", summary: "", valueIndex: 0, entries: ["Subtitled", "Dubbed"], entryValues: ["sub", "dub"] },
    }];
  }
}
`;

/** Reports what the sandbox exposes; on request reads a local file or never finishes. */
const PROBE_PLUGIN = String.raw`
class DefaultExtension extends MProvider {
  async search(query) {
    const globals = ["require", "process", "Bun", "fetch", "XMLHttpRequest", "Deno"].map((name) => name + ":" + typeof globalThis[name]);
    if (query === "file") {
      await new Client().get("file:///etc/passwd");
    }
    if (query === "forever") {
      for (;;) {}
    }
    if (query === "dates") {
      const dates = [
        ["1696172400", "", ""], ["2023-10-01T12:00:00Z", "", ""], ["October 1st, 2023", "MMMM d, yyyy", "en"], ["10/01/2023", "MM/dd/yyyy", "en"],
        ["12 octobre 2023", "", ""], ["3 days ago", "", ""], ["not a date at all", "", ""],
      ];
      return { list: dates.map(([date, format, locale]) => ({ name: parseDates([date], format, locale)[0], link: "/" + date })), hasNextPage: false };
    }
    return { list: globals.map((name) => ({ name, link: "/" + name })), hasNextPage: false };
  }
}
`;

const BROKEN_PLUGIN = "class DefaultExtension extends MProvider { search( {";

const searchPage = (title: string): string => `<html><body><ul>
  <li class="show"><a href="/show/lantern">  ${title}  </a><img src="/covers/lantern.jpg"></li>
  <li class="show"><a href="/show/other">Moth Harbor</a><img src="/covers/moth.jpg"></li>
</ul></body></html>`;

const SHOW_PAGE = `<html><body>
  <h1>${SHOW_TITLE}</h1>
  <p class="synopsis">Ferries cross a lantern-lit bay. (more)</p>
  <span class="genre">Slice of Life</span><span class="genre">Drama</span>
  <a class="episode" href="/watch/2">Episode 2</a>
  <a class="episode" href="/watch/1">Episode 1</a>
</body></html>`;

// Newest first, with names that carry no numbers: the order says which is episode 1.
const OTHER_SHOW_PAGE = `<html><body>
  <h1>Moth Harbor</h1><p class="synopsis">Moths. (more)</p>
  <a class="episode" href="/watch/3">The Tide Comes Back</a>
  <a class="episode" href="/watch/2">Paper Moths</a>
  <a class="episode" href="/watch/1">Harbor Lights</a>
</body></html>`;

const SUBTITLE = "WEBVTT\n\n00:00:00.500 --> 00:00:02.000\nThe last ferry leaves at dusk.\n";

interface IndexEntry {
  readonly id: number;
  readonly name: string;
  readonly code: string;
  readonly itemType?: number;
  readonly sourceCodeLanguage?: number;
}

export interface FakeRepository {
  readonly indexUrl: string;
  /** Repository ids Nanime gives each source, by name. */
  readonly ids: Readonly<Record<string, string>>;
}

async function writeIndex(site: FakeSource, directory: string, entries: readonly IndexEntry[]): Promise<FakeRepository> {
  await mkdir(join(directory, "src"), { recursive: true });
  await Promise.all(entries.map((entry) => writeFile(join(directory, "src", `${String(entry.id)}.js`), entry.code)));
  const index = entries.map((entry) => ({
    id: entry.id, name: entry.name, lang: "en", baseUrl: site.url("/site"), apiUrl: "", iconUrl: "", version: "0.1.0",
    isNsfw: false, itemType: entry.itemType ?? 1, sourceCodeLanguage: entry.sourceCodeLanguage ?? 1,
    sourceCodeUrl: `src/${String(entry.id)}.js`,
  }));
  await writeFile(join(directory, "index.json"), JSON.stringify(index));
  site.serveDirectory("repo", directory, true);
  const indexUrl = site.url("/repo/index.json");
  return { indexUrl, ids: Object.fromEntries(entries.map((entry) => [entry.name, `${indexUrl}#${String(entry.id)}`])) };
}

/** The fictional site: pages, two short HLS episodes and an English WebVTT track. */
async function writeSite(site: FakeSource, directory: string): Promise<void> {
  const pages = {
    "search-sub.html": searchPage(SHOW_TITLE),
    "search-dub.html": searchPage(`${SHOW_TITLE} (Dub)`),
    "show/lantern": SHOW_PAGE,
    "show/other": OTHER_SHOW_PAGE,
    "watch/1": JSON.stringify({ file: "/streams/1/index.m3u8", subtitle: "/subs/1.vtt" }),
    // A playlist link without the .m3u8 extension, as some hosts serve.
    "watch/2": JSON.stringify({ file: "/streams/2/play" }),
    "subs/1.vtt": SUBTITLE,
  };
  for (const [path, body] of Object.entries(pages)) {
    await mkdir(join(directory, path, ".."), { recursive: true });
    await writeFile(join(directory, path), body);
  }
  for (const episode of ["1", "2"]) {
    const stream = join(directory, "streams", episode);
    await mkdir(stream, { recursive: true });
    const clip = await makeClip(join(stream, "clip.mp4"), { seconds: 2, audio: ["jpn"] });
    await run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", clip, "-c", "copy", "-f", "hls", "-hls_time", "1", "-hls_playlist_type", "vod", join(stream, "index.m3u8")]);
    await copyFile(join(stream, "index.m3u8"), join(stream, "play"));
  }
  site.serveDirectory("site", directory);
}

/**
 * Publishes the repository: "Lantern Stream" (the site scraper), "Probe" (sandbox checks),
 * "Broken" (a syntax error), plus a Dart source and a manga source Nanime must not offer.
 */
export async function publishFakeRepository(site: FakeSource): Promise<FakeRepository> {
  const directory = await temporaryDirectory("nanime-source-repo-");
  await writeSite(site, join(directory, "site"));
  return await writeIndex(site, join(directory, "repo"), [
    { id: 101, name: "Lantern Stream", code: LANTERN_PLUGIN },
    { id: 102, name: "Probe", code: PROBE_PLUGIN },
    { id: 103, name: "Broken", code: BROKEN_PLUGIN },
    { id: 104, name: "Dart Source", code: "// dart", sourceCodeLanguage: 0 },
    { id: 105, name: "Manga Source", code: LANTERN_PLUGIN, itemType: 0 },
  ]);
}
