const CACHE_PREFIX = "nanime-app-";
const CACHE_NAME = `${CACHE_PREFIX}v1`;
const APP_SHELL = [
  "/",
  "/manifest.webmanifest",
  "/favicon.svg",
  "/icon-180.png",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-512.png",
];
const UNCACHED_PREFIXES = [
  "/api/",
  "/hls/",
  "/stream",
  "/subtitle",
  "/thumbnail",
  "/trickplay/",
  "/transcode",
];

function isCacheableAsset(url) {
  return url.pathname.startsWith("/assets/") || APP_SHELL.includes(url.pathname);
}

function isMediaOrApi(url) {
  return UNCACHED_PREFIXES.some((prefix) => url.pathname.startsWith(prefix));
}

async function cacheResponse(request, response) {
  if (response.ok) {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response.clone());
  }
  return response;
}

async function networkFirstNavigation(request) {
  try {
    const response = await fetch(request);
    return cacheResponse("/", response);
  } catch {
    return (await caches.match("/")) ?? Response.error();
  }
}

async function cacheFirstAsset(request) {
  const cached = await caches.match(request);
  return cached ?? cacheResponse(request, await fetch(request));
}

async function installWorker() {
  const cache = await caches.open(CACHE_NAME);
  await cache.addAll(APP_SHELL);
  await globalThis.skipWaiting();
}

async function activateWorker() {
  const names = await caches.keys();
  const oldCaches = names.filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME);
  await Promise.all(oldCaches.map((name) => caches.delete(name)));
  await globalThis.clients.claim();
}

globalThis.addEventListener("install", (event) => {
  event.waitUntil(installWorker());
});

globalThis.addEventListener("activate", (event) => {
  event.waitUntil(activateWorker());
});

globalThis.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== globalThis.location.origin || isMediaOrApi(url)) {
    return;
  }
  if (request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(request));
  } else if (isCacheableAsset(url)) {
    event.respondWith(cacheFirstAsset(request));
  }
});
