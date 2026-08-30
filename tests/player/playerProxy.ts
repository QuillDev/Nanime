export const PLAYER_PROXY_ENTRYPOINT = import.meta.filename;

function startProxy(): void {
  const port = Number(Bun.env["PORT"] ?? "0");
  const backendOrigin = Bun.env["BACKEND_ORIGIN"] ?? "";
  if (port <= 0 || backendOrigin === "") {
    throw new Error("Player proxy requires PORT and BACKEND_ORIGIN");
  }
  let failedManifestPath: string | null = null;

  Bun.serve({
    hostname: "127.0.0.1",
    port,
    fetch(request) {
      const source = new URL(request.url);
      if (source.pathname === "/__player-harness/health") {
        return new Response("ok");
      }
      if (source.pathname === "/__player-harness/fail-next-manifest") {
        failedManifestPath = source.searchParams.get("path");
        return new Response(null, { status: 204 });
      }
      if (failedManifestPath !== null && source.pathname === "/hls/index" &&
        source.searchParams.get("path") === failedManifestPath) {
        failedManifestPath = null;
        return new Response("Not found", { status: 404 });
      }
      const destination = new URL(`${source.pathname}${source.search}`, backendOrigin);
      return fetch(new Request(destination, request));
    },
  });
}

if (import.meta.main) {
  startProxy();
}
