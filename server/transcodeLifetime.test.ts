import { expect, test } from "bun:test";
import { installTranscodeLifetimeTools } from "./transcodeLifetimeTools.ts";
import { isolatedEnvironment, runHarness, withTemporaryDirectory } from "./testProcess.ts";

const scenarios = ["resolve", "output", "probe", "processing-exit", "cleanup", "validation", "queued-unstarted", "failed-admission", "handoff", "handoff-bulk", "queued-delete", "progress-failure"];
for (const scenario of scenarios) {
  test(`transcode cancellation retains source until worker settles: ${scenario}`, async () => {
    await withTemporaryDirectory("nanime-transcode-lifetime-", async (directory) => {
      const path = await installTranscodeLifetimeTools(directory);
      const result = await runHarness("transcodeLifetimeHarness.ts", [directory, scenario], isolatedEnvironment(directory, { PATH: path, NANIME_TRANSCODE_WORKERS: "1" }));
      expect(result).toEqual({ code: 0, output: "transcode lifetime passed\n", error: "" });
    });
  }, 30_000);
}
