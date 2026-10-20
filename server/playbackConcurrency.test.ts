import { expect, test } from "bun:test";
import { isolatedEnvironment, runHarness, withTemporaryDirectory } from "./testProcess.ts";

const scenarios = ["watched", "progress", "restore"].flatMap((kind) => ["rename", "trash", "reuse", "failures"].map((action) => `${kind}:${action}`));
for (const scenario of scenarios) {
  test(`playback concurrency outcomes: ${scenario}`, async () => {
    await withTemporaryDirectory("nanime-playback-concurrency-", async (directory) => {
      const result = await runHarness("playbackConcurrencyHarness.ts", [directory, scenario], isolatedEnvironment(directory));
      expect(result).toEqual({ code: 0, output: "playback concurrency passed\n", error: "" });
    });
  }, 20_000);
}
