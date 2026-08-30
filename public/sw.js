importScripts("/swCore.js", "/swStorage.js");

const worker = globalThis.NanimeOfflineWorker;
const storage = globalThis.NanimeOfflineStorage;
const dependencies = {
  caches,
  fetch: (request) => fetch(request),
  loadOfflineMedia: storage.loadOfflineMedia,
};

async function installWorker() {
  const cache = await caches.open(worker.CACHE_NAME);
  await cache.addAll(worker.APP_SHELL);
  await globalThis.skipWaiting();
}

async function activateWorker() {
  const names = await caches.keys();
  const oldCaches = names.filter((name) => (
    name.startsWith(worker.CACHE_PREFIX) && name !== worker.CACHE_NAME
  ));
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
  const route = worker.requestRoute(request, globalThis.location.origin);
  if (route.kind === "none") {
    return;
  }
  event.respondWith(worker.routeResponse(route, request, dependencies));
});
