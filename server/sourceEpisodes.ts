import { extname } from "node:path";
import { jsonObject, type JsonObject } from "./json.ts";
import { assertPublicUrl } from "./sourceHttp.ts";
import { runSource } from "./sourceRuntime.ts";
import { installedSource } from "./sourceStore.ts";
import type { ResolvedEpisode, SourceEpisode, SubtitleLink } from "./downloadStore.ts";

/**
 * Turns a source episode into something to download, at the moment it starts:
 * the plugin's first video (plugins list their preferred quality and audio
 * first, which is also what Mangayomi plays), either a magnet for qBittorrent
 * or a link Nanime fetches, with its headers and subtitle tracks.
 */
const MAX_SUBTITLES = 20;
const PLAIN_VIDEO = new Set([".mp4", ".mkv", ".webm", ".m4v", ".mov", ".avi"]);

class EpisodeResolveError extends Error {
  override name = "EpisodeResolveError";
}

function stringRecord(value: unknown): Readonly<Record<string, string>> {
  const object = jsonObject(value);
  return object === null ? {} : Object.fromEntries(Object.entries(object).flatMap(([key, entry]) => (typeof entry === "string" ? [[key, entry]] : [])));
}

function subtitleLinks(value: unknown): readonly SubtitleLink[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((track) => {
    const object = jsonObject(track);
    const url = typeof object?.["file"] === "string" ? URL.parse(object["file"]) : null;
    return url !== null && (url.protocol === "https:" || url.protocol === "http:")
      ? [{ url: url.href, label: typeof object?.["label"] === "string" ? object["label"] : "" }]
      : [];
  }).slice(0, MAX_SUBTITLES);
}

/** HLS when the link says so, or (for links that don't) when the first bytes are a playlist. */
async function isHls(url: URL, headers: Readonly<Record<string, string>>): Promise<boolean> {
  const extension = extname(url.pathname).toLowerCase();
  if (extension === ".m3u8") {
    return true;
  }
  if (PLAIN_VIDEO.has(extension)) {
    return false;
  }
  try {
    const response = await fetch(url, { headers: { ...headers, range: "bytes=0-15" }, signal: AbortSignal.timeout(20_000) });
    const bytes = await response.bytes();
    return new TextDecoder().decode(bytes.subarray(0, 16)).trimStart().startsWith("#EXTM3U");
  } catch {
    return false;
  }
}

async function fileEpisode(video: JsonObject, url: URL): Promise<ResolvedEpisode> {
  await assertPublicUrl(url);
  const headers = stringRecord(video["headers"]);
  const hls = await isHls(url, headers);
  const extension = extname(url.pathname).toLowerCase();
  return {
    kind: "file", url: url.href, headers, format: hls ? "hls" : "file",
    extension: !hls && PLAIN_VIDEO.has(extension) ? extension : ".mp4",
    subtitles: subtitleLinks(video["subtitles"]),
  };
}

export async function resolveEpisode(episode: SourceEpisode): Promise<ResolvedEpisode> {
  const source = installedSource(episode.sourceId);
  if (source === null) {
    throw new EpisodeResolveError("Its source was removed");
  }
  const videos = await runSource(source, `extention.getVideoList(${JSON.stringify(episode.url)})`, "finding the episode's video");
  const candidates = Array.isArray(videos) ? videos.flatMap((video) => {
    const object = jsonObject(video);
    const url = object?.["url"];
    return object !== null && typeof url === "string" ? [{ video: object, url }] : [];
  }) : [];
  const usable = candidates.find((video) => video.url.startsWith("magnet:") || /^https?:/iu.test(video.url));
  const url = usable === undefined || usable.url.startsWith("magnet:") ? null : URL.parse(usable.url);
  if (usable?.url.startsWith("magnet:") === true) {
    return { kind: "torrent", magnet: usable.url };
  }
  if (usable === undefined || url === null) {
    throw new EpisodeResolveError(`${source.name} found no video for this episode`);
  }
  return await fileEpisode(usable.video, url);
}
