import { expect, test } from "bun:test";
import { isolatedEnvironment, runHarness, withTemporaryDirectory } from "./testProcess.ts";

test("durable recovery excludes source, destination and ancestors from every shared admission", async () => {
  await withTemporaryDirectory("nanime-recovery-admission-", async (directory) => {
    const result = await runHarness("libraryRecoveryAdmissionHarness.ts", [directory], isolatedEnvironment(directory));
    expect(result).toEqual({ code: 0, output: "recovery admission passed\n", error: "" });
  });
}, 30_000);
