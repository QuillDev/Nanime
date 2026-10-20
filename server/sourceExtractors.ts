/**
 * Mangayomi's video host extractors (sibnetExtractor, voeExtractor, ...),
 * which it implements natively and hands to JS extensions as globals. These
 * are JavaScript ports of its Dart versions (lib/services/anime_extractors,
 * Apache-2.0) and run inside the sandbox on the same bridge as the plugin.
 * Each answers a list of videos ({url, originalUrl, quality, headers,
 * subtitles}) and an empty list when the host has nothing usable. Unlike
 * Mangayomi, `url` is always the playable link (Nanime downloads `url`).
 * Not ported: the Quark/UC cloud drives (they need account cookies) and
 * GogoCDN (the site is gone).
 */
export const SOURCE_EXTRACTORS = String.raw`
function __video(url, quality, headers, subtitles) {
  return { url: url, originalUrl: url, quality: quality, headers: headers || {}, subtitles: subtitles || [] };
}

function __host(url) {
  return url.substringAfter("://").substringBefore("/");
}

function __resolve(base, relative) {
  if (/^https?:/.test(relative)) return relative;
  if (relative.startsWith("/")) return base.substring(0, base.indexOf("/", 8)) + relative;
  return base.substring(0, base.lastIndexOf("/") + 1) + relative;
}

/** One video per variant of an HLS master playlist; the playlist itself when it has no variants. */
async function __hlsVariants(masterUrl, name, headers, subtitles) {
  const res = await new Client().get(masterUrl, headers);
  const parts = res.body.split("#EXT-X-STREAM-INF").slice(1);
  if (parts.length === 0) return [__video(masterUrl, name, headers, subtitles)];
  return parts.map((part) => {
    const height = part.substringAfter("RESOLUTION=").substringAfter("x").substringBefore(",").substringBefore("\n").trim();
    const line = part.substringAfter("\n").substringBefore("\n").trim();
    return __video(__resolve(masterUrl, line), name + " - " + height + "p", headers, subtitles);
  });
}

function __script(html, needle) {
  return new Document(html).select("script").map((script) => script.text).find((text) => text.includes(needle)) || "";
}

async function __safely(extract) {
  try {
    return await extract();
  } catch (_) {
    return [];
  }
}

function sibnetExtractor(url, prefix) {
  return __safely(async () => {
    const res = await new Client().get(url);
    if (res.statusCode !== 200) return [];
    const slug = res.body.substringAfter("player.src").substringAfter("src:").substringAfter('"').substringBefore('"');
    const video = slug.includes("http") ? slug : "https://" + __host(url) + slug;
    return [__video(video, (prefix || "") + " - Sibnet", { Referer: url })];
  });
}

function myTvExtractor(url) {
  return __safely(async () => {
    const script = __script((await new Client().get(url)).body, 'CreatePlayer("v');
    if (script === "") return [];
    const video = decodeURIComponent(script.substringAfter('"v=').substringBefore("\\u0026tp=video"));
    return [__video(video, video.includes("https:") ? "Mytv" : "Stream")];
  });
}

function okruExtractor(url) {
  return __safely(async () => {
    const options = new Document((await new Client().get(url)).body).selectFirst("div[data-options]").attr("data-options");
    if (!options.includes("ondemandHls")) return [];
    const playlist = JSON.parse(JSON.parse(options).flashvars.metadata).ondemandHls;
    return __hlsVariants(playlist, "Okru", {});
  });
}

function vidBomExtractor(url) {
  return __safely(async () => {
    const script = __script((await new Client().get(url)).body, "sources");
    const data = script.substringAfter("sources: [").substringBefore("],");
    return data.split('file:"').slice(1).map((source) => {
      const label = source.substringAfter('label:"').substringBefore('"');
      return __video(source.substringBefore('"'), label.length > 6 ? "Vidshare - 480p" : "Vidbom - " + label);
    });
  });
}

function yourUploadExtractor(url, headers, name, prefix) {
  return __safely(async () => {
    const withReferer = Object.assign({}, headers || {}, { referer: "https://www.yourupload.com/" });
    const script = __script((await new Client().get(url, withReferer)).body, "jwplayerOptions");
    if (script === "") return [];
    return [__video(script.substringAfter("file: '").substringBefore("',"), (prefix || "") + (name || "YourUpload"), withReferer)];
  });
}

function streamTapeExtractor(url, quality) {
  return __safely(async () => {
    const embed = url.startsWith("https://streamtape.com/e/") ? url : "https://streamtape.com/e/" + url.split("/")[4];
    const target = "document.getElementById('robotlink')";
    const script = __script((await new Client().get(embed)).body, target);
    if (script === "") return [];
    const tail = script.split(target + ".innerHTML = '").pop();
    const video = "https:" + tail.substringBefore("'") + tail.substringAfter("+ ('xcd").substringBefore("'");
    return [__video(video, quality || "StreamTape")];
  });
}

function doodExtractor(url, quality) {
  return __safely(async () => {
    const client = new Client();
    const res = await client.get(url);
    const page = res.request && res.request.url ? res.request.url : url;
    if (!res.body.includes("'/pass_md5/")) return [];
    const host = __host(page);
    const md5 = res.body.substringAfter("'/pass_md5/").substringBefore("',");
    const start = (await client.get("https://" + host + "/pass_md5/" + md5, { Referer: page })).body;
    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let random = "";
    for (let i = 0; i < 10; i++) random += letters[Math.floor(Math.random() * letters.length)];
    const video = start + random + "?token=" + md5.substring(md5.lastIndexOf("/") + 1) + "&expiry=" + Date.now();
    return [__video(video, quality || "Doodstream mirror", { Referer: "https://" + host + "/" })];
  });
}

function mp4UploadExtractor(url, headers, prefix, suffix) {
  return __safely(async () => {
    const withReferer = Object.assign({}, headers || {}, { referer: "https://mp4upload.com/" });
    const html = (await new Client().get(url, withReferer)).body;
    const packed = __script(html, "p,a,c,k,e,d");
    const script = packed !== "" ? unpackJs(packed) : __script(html, "player.src");
    if (script === "") return [];
    const video = script.substringAfter(".src(").substringBefore(")").substringAfter("src:").substringAfter('"').substringBefore('"');
    const height = (/\WHEIGHT=(\d+)/.exec(script) || [])[1] || "Unknown resolution";
    return [__video(video, ((prefix || "") + " Mp4Upload - " + height + "p " + (suffix || "")).trim(), withReferer)];
  });
}

function streamWishExtractor(url, prefix) {
  return __safely(async () => {
    const script = __script((await new Client().get(url)).body, "m3u8");
    if (script === "") return [];
    const plain = script.includes("function(p,a,c") ? unpackJs(script) : script;
    const master = plain.substringAfter("source").substringAfter('file:"').substringBefore('"');
    if (master === "") return [];
    const headers = { Accept: "*/*", Origin: "https://" + __host(url), Referer: "https://" + __host(url) + "/" };
    return __hlsVariants(master, prefix || "StreamWish", headers);
  });
}

function filemoonExtractor(url, prefix, suffix) {
  return __safely(async () => {
    const headers = { Referer: url, Origin: "https://" + __host(url) };
    const unpacked = unpackJs(__script((await new Client().get(url)).body, "eval"));
    const master = unpacked.substringAfter('{file:"').substringBefore('"}');
    if (master === "" || master === unpacked) return [];
    const subtitleUrl = unpacked.includes("fetch('") ? unpacked.substringAfter("fetch('").substringBefore("').") : "";
    let subtitles = [];
    if (subtitleUrl !== "") {
      try {
        subtitles = JSON.parse((await new Client().get(subtitleUrl, headers)).body).map((item) => ({ file: item.file, label: item.label }));
      } catch (_) {
        subtitles = [];
      }
    }
    return __hlsVariants(master, ((prefix || "Filemoon") + " " + (suffix || "")).trim(), headers, subtitles);
  });
}

function sendVidExtractor(url, headers, prefix) {
  return __safely(async () => {
    const master = new Document((await new Client().get(url)).body).selectFirst("source#video_source").attr("src");
    if (master === "") return [];
    const extra = typeof headers === "string" ? JSON.parse(headers || "{}") : headers || {};
    const withOrigin = Object.assign({}, extra, { Accept: "*/*", Origin: "https://" + __host(url), Referer: "https://" + __host(url) + "/" });
    return __hlsVariants(master, (prefix ? prefix + " - " : "") + "Sendvid", withOrigin);
  });
}

function voeExtractor(url, prefix) {
  return __safely(async () => {
    const client = new Client();
    let page = url;
    let html = (await client.get(page)).body;
    const redirect = new Document(html).selectFirst("script").text;
    if (redirect.includes("if (typeof localStorage !== 'undefined')")) {
      page = redirect.substringAfter("window.location.href = '").substringBefore("';");
      html = (await client.get(page)).body;
    }
    const playlist = await __voePlaylist(html, page) || __voeLegacy(html);
    return playlist ? __hlsVariants(playlist, (prefix || "") + "Voe", {}) : [];
  });
}

/** Current VOE pages: a JSON payload decoded with ROT13, a marker table from the loader script, and two base64 rounds. */
async function __voePlaylist(html, page) {
  const doc = new Document(html);
  const payload = doc.selectFirst('script[type="application/json"]').text;
  const loader = doc.selectFirst('script[type="application/json"] + script[src]').attr("src");
  if (payload === "" || loader === "") return null;
  const first = JSON.parse(payload)[0];
  if (typeof first !== "string") return null;
  const script = (await new Client().get(__resolve(page, loader))).body;
  const table = /\[(?:'\W{2}'\s*(?:,\s*|\])){1,9}/.exec(script);
  if (!table) return null;
  let encoded = first.replace(/[a-zA-Z]/g, (letter) => {
    const base = letter <= "Z" ? 65 : 97;
    return String.fromCharCode(((letter.charCodeAt(0) - base + 13) % 26) + base);
  });
  for (const marker of (table[0].match(/'([^']+)'/g) || []).map((m) => m.slice(1, -1))) encoded = encoded.split(marker).join("");
  const shifted = __call("base64_decode", [encoded]);
  const reversed = shifted.split("").map((c) => String.fromCharCode(c.charCodeAt(0) - 3)).reverse().join("");
  const decoded = JSON.parse(__call("base64_decode", [reversed]));
  return decoded.source || decoded.file || decoded.direct_access_url || null;
}

/** Older VOE pages carried the playlist in an inline script. */
function __voeLegacy(html) {
  const script = new Document(html).select("script").map((s) => s.text).find((t) => t.includes("sources") || t.includes("wc0")) || "";
  if (script.includes("sources")) {
    const link = script.substringAfter("hls': '").substringBefore("'");
    return /^https?:\/\//.test(link) ? link : __call("base64_decode", [link]);
  }
  const encoded = /'.*'/.exec(script);
  return encoded ? JSON.parse(__call("base64_decode", [encoded[0].slice(1, -1)])).file : null;
}

function streamlareExtractor(url, prefix, suffix) {
  return __safely(async () => {
    const name = ((prefix ? prefix + " " : "") + "Streamlare" + (suffix ? " " + suffix : ""));
    const answer = (await new Client().post("https://slwatch.co/api/video/stream/get", { "Content-Type": "application/json" }, JSON.stringify({ id: url.split("/").pop() }))).body;
    if (answer.substringAfter('"type":"').substringBefore('"') === "hls") {
      return __hlsVariants(answer.substringAfter('"file":"').substringBefore('"').split("\\/").join("/"), name, {});
    }
    const videos = [];
    for (const part of answer.split('"label":"').slice(1)) {
      const res = await new Client().post(part.substringAfter('"file":"').substringBefore('",').split("\\").join(""));
      videos.push(__video(res.request.url, name + ":" + part.substringBefore('",')));
    }
    return videos;
  });
}

for (const name of ["quarkVideosExtractor", "ucVideosExtractor", "quarkFilesExtractor", "ucFilesExtractor", "gogoCdnExtractor"]) {
  globalThis[name] = async () => [];
}
`;
