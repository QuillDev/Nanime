import { expect, test } from "bun:test";
import { installWriterTools } from "./libraryWriterTestTools.ts";
import { isolatedEnvironment, runHarness, withTemporaryDirectory } from "./testProcess.ts";

const scenarios = ["delete", "audio", "prune", "subtitle", "offline", "transcode", "aliases", "trash", "writer-first", "torrent", "torrent-visible", "torrent-visible-alias", "torrent-delayed", "torrent-late", "torrent-outage", "upload", "detach-alias", "offline-setup", "offline-requeue", "offline-replaced", "audio-first", "prune-first", "promotion", "transcode-canonical"];
for (const scenario of scenarios) {
  test(`library writer regression: ${scenario}`, async () => {
    await withTemporaryDirectory("nanime-writer-regression-", async (directory) => {
      const path = await installWriterTools(directory);
      const result = await runHarness("libraryWriterRegressionHarness.ts", [directory, scenario], isolatedEnvironment(directory, { PATH: path, NANIME_TORRENT_RECONCILE_MS: "100" }));
      expect(result).toEqual({ code: 0, output: "writer regressions passed\n", error: "" });
    });
  }, 30_000);
}
