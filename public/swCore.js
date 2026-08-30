const NANIME_CACHE_PREFIX = "nanime-app-";
const NANIME_CACHE_NAME = `${NANIME_CACHE_PREFIX}v2`;
const NANIME_APP_SHELL = Object.freeze([
  "/",
  "/manifest.webmanifest",
  "/favicon.svg",
  "/icon-180.png",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-512.png",
]);
const NANIME_GATEWAY_FAILURES = new Set([502, 503, 504]);
const NANIME_OFFLINE_MEDIA_PATH = /^\/offline-download\/(?<id>[^/]+)\/media$/u;
const NANIME_OFFLINE_ASSET_PATHS = new Set(["/api/subtitles", "/subtitle", "/thumbnail"]);

function nanimeUnsatisfiableRange() {
  return { kind: "unsatisfiable" };
}

function nanimeSuffixRange(text, size) {
  const length = Number(text);
  return Number.isSafeInteger(length) && length > 0
    ? { kind: "partial", start: Math.max(0, size - length), end: size - 1 }
    : nanimeUnsatisfiableRange();
}

function nanimeExplicitRange(startText, endText, size) {
  const start = Number(startText);
  const requestedEnd = endText === "" ? size - 1 : Number(endText);
  const invalid = !Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) ||
    start < 0 || requestedEnd < start || start >= size;
  return invalid
    ? nanimeUnsatisfiableRange()
    : { kind: "partial", start, end: Math.min(requestedEnd, size - 1) };
}

function nanimeByteRange(header, size) {
  if (header === null) {
    return { kind: "full", start: 0, end: Math.max(0, size - 1) };
  }
  const match = /^bytes=(?<start>\d*)-(?<end>\d*)$/u.exec(header.trim());
  if (match === null || size <= 0) {
    return nanimeUnsatisfiableRange();
  }
  const startText = match.groups?.["start"] ?? "";
  const endText = match.groups?.["end"] ?? "";
  if (startText === "" && endText === "") {
    return nanimeUnsatisfiableRange();
  }
  return startText === ""
    ? nanimeSuffixRange(endText, size)
    : nanimeExplicitRange(startText, endText, size);
}

function nanimeOfflineDownloadId(url) {
  const id = NANIME_OFFLINE_MEDIA_PATH.exec(url.pathname)?.groups?.["id"];
  if (id === undefined) {
    return null;
  }
  try {
    return decodeURIComponent(id);
  } catch {
    return null;
  }
}

function nanimeAssetRoute(request, url) {
  return request.method === "GET" &&
    (url.pathname.startsWith("/assets/") || NANIME_APP_SHELL.includes(url.pathname));
}

function nanimeNonMediaRoute(request, url) {
  if (request.method === "GET" && request.mode === "navigate") {
    return { kind: "navigation" };
  }
  return nanimeAssetRoute(request, url) ? { kind: "asset" } : { kind: "none" };
}

function nanimeRequestRoute(request, origin) {
  const url = new URL(request.url);
  if (url.origin !== origin || request.method !== "GET" && request.method !== "HEAD") {
    return { kind: "none" };
  }
  const downloadId = nanimeOfflineDownloadId(url);
  if (downloadId !== null) {
    return { kind: "offline-media", downloadId };
  }
  if (request.method === "GET" && NANIME_OFFLINE_ASSET_PATHS.has(url.pathname)) {
    return { kind: "offline-asset" };
  }
  return nanimeNonMediaRoute(request, url);
}

function nanimeMediaHeaders(media, length) {
  return new Headers({
    "accept-ranges": "bytes",
    "cache-control": "private, no-store",
    "content-length": String(length),
    "content-type": media.contentType || "application/octet-stream",
  });
}

function nanimeRangeError(media) {
  media.close?.();
  return new Response("Range Not Satisfiable", {
    status: 416,
    headers: {
      "accept-ranges": "bytes",
      "content-range": `bytes */${String(media.size)}`,
    },
  });
}

async function nanimeMediaBody(request, media, range) {
  if (request.method === "HEAD") {
    media.close?.();
    return null;
  }
  return await media.read(range.start, range.end + 1);
}

async function nanimeValidMediaResponse(request, media, range) {
  const length = range.end - range.start + 1;
  const headers = nanimeMediaHeaders(media, length);
  if (range.kind === "partial") {
    headers.set("content-range", `bytes ${String(range.start)}-${String(range.end)}/${String(media.size)}`);
  }
  return new Response(await nanimeMediaBody(request, media, range), {
    status: range.kind === "partial" ? 206 : 200,
    headers,
  });
}

async function nanimeOfflineMediaResponse(request, downloadId, loadOfflineMedia) {
  const media = await loadOfflineMedia(downloadId);
  if (media === null || media.size <= 0) {
    return new Response("Offline download not found", { status: 404 });
  }
  const range = nanimeByteRange(request.headers.get("range"), media.size);
  if (range.kind === "unsatisfiable") {
    return nanimeRangeError(media);
  }
  return await nanimeValidMediaResponse(request, media, range);
}

async function nanimeCacheResponse(cacheStorage, key, response) {
  if (response.ok) {
    const cache = await cacheStorage.open(NANIME_CACHE_NAME);
    await cache.put(key, response.clone());
  }
  return response;
}

async function nanimeNavigationResponse(request, dependencies) {
  try {
    const response = await dependencies.fetch(request);
    if (!NANIME_GATEWAY_FAILURES.has(response.status)) {
      return await nanimeCacheResponse(dependencies.caches, "/", response);
    }
  } catch {
    // A cached shell is the expected fallback when the network is unavailable.
  }
  return await dependencies.caches.match("/") ?? Response.error();
}

async function nanimeAssetResponse(request, dependencies) {
  const cached = await dependencies.caches.match(request);
  if (cached !== undefined) {
    return cached;
  }
  return await nanimeCacheResponse(
    dependencies.caches,
    request,
    await dependencies.fetch(request),
  );
}

async function nanimeOfflineAssetResponse(request, dependencies) {
  const cached = await dependencies.caches.match(request);
  if (cached !== undefined) {
    return cached;
  }
  return await dependencies.fetch(request);
}

async function nanimeRouteResponse(route, request, dependencies) {
  switch (route.kind) {
    case "offline-media": {
      return await nanimeOfflineMediaResponse(
        request,
        route.downloadId,
        dependencies.loadOfflineMedia,
      );
    }
    case "navigation": {
      return await nanimeNavigationResponse(request, dependencies);
    }
    case "offline-asset": {
      return await nanimeOfflineAssetResponse(request, dependencies);
    }
    case "asset": {
      return await nanimeAssetResponse(request, dependencies);
    }
    default: {
      return Response.error();
    }
  }
}

globalThis.NanimeOfflineWorker = Object.freeze({
  APP_SHELL: NANIME_APP_SHELL,
  CACHE_NAME: NANIME_CACHE_NAME,
  CACHE_PREFIX: NANIME_CACHE_PREFIX,
  byteRange: nanimeByteRange,
  offlineDownloadId: nanimeOfflineDownloadId,
  offlineMediaResponse: nanimeOfflineMediaResponse,
  requestRoute: nanimeRequestRoute,
  routeResponse: nanimeRouteResponse,
});
