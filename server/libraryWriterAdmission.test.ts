import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installWriterTools } from "./libraryWriterTestTools.ts";

const scenarios = ["delete", "audio", "prune", "subtitle", "offline", "transcode", "aliases", "trash", "writer-first", "torrent", "torrent-visible", "torrent-visible-alias", "torrent-delayed", "torrent-late", "torrent-outage", "upload", "detach-alias", "offline-setup", "offline-requeue", "offline-replaced", "audio-first", "prune-first", "promotion", "transcode-canonical"];
for (const scenario of scenarios) {
  test(`library writer regression: ${scenario}`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "nanime-writer-regression-"));
    try {
      const path = await installWriterTools(directory);
      const child = Bun.spawn([process.execPath, join(import.meta.dir, "libraryWriterRegressionHarness.ts"), directory, scenario], {
        env: {
          ...Bun.env,
          PATH: path,
          NANIME_DATABASE: join(directory, "test.sqlite"),
          NANIME_ADMIN_SETUP_TOKEN: "isolated-writer-regression-setup-token-only",
          QBITTORRENT_URL: "", QBITTORRENT_USERNAME: "", QBITTORRENT_PASSWORD: "",
          NANIME_MEDIA_DIR: join(directory, "media"), NANIME_TORRENT_RECONCILE_MS: "100",
        },
        stdout: "pipe", stderr: "pipe",
      });
      const [code, output, error] = await Promise.all([
        child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
      ]);
      expect({ code, output, error }).toEqual({ code: 0, output: "writer regressions passed\n", error: "" });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);
}
