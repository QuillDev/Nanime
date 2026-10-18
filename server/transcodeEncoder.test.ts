import { expect, test } from "bun:test";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCpuList, reapStrayEncoders, transcodeWorkerBudget } from "./transcodeEncoder.ts";

test("stored transcodes share a quarter of the host across parallel workers", () => {
  expect(transcodeWorkerBudget(16, Number.NaN)).toEqual({ cpus: 4, workers: 2, threadsPerWorker: 2 });
  expect(transcodeWorkerBudget(32, Number.NaN)).toEqual({ cpus: 8, workers: 4, threadsPerWorker: 2 });
  expect(transcodeWorkerBudget(4, Number.NaN)).toEqual({ cpus: 1, workers: 1, threadsPerWorker: 1 });
});

test("a configured worker count never exceeds the quarter budget", () => {
  expect(transcodeWorkerBudget(16, 4)).toEqual({ cpus: 4, workers: 4, threadsPerWorker: 1 });
  expect(transcodeWorkerBudget(16, 9)).toEqual({ cpus: 4, workers: 4, threadsPerWorker: 1 });
  expect(transcodeWorkerBudget(8, 3)).toEqual({ cpus: 2, workers: 2, threadsPerWorker: 1 });
});

test("reads kernel CPU lists", () => {
  expect(parseCpuList("0-3,8,10-11\n")).toEqual([0, 1, 2, 3, 8, 10, 11]);
  expect(parseCpuList("")).toEqual([]);
});

test("reaps only encoders writing into the private output directory", async () => {
  const directory = await mkdtemp(join(tmpdir(), "nanime-reap-"));
  const output = join(directory, ".nanime-transcodes");
  const tail = Bun.which("tail");
  if (tail === null) {
    throw new Error("tail is required");
  }
  await symlink(tail, join(directory, "ffmpeg"));
  await writeFile(join(directory, "watched"), "");
  const stray = Bun.spawn([join(directory, "ffmpeg"), "-f", join(directory, "watched"), `${output}/partial.mkv`], { stdout: "ignore", stderr: "ignore" });
  const bystander = Bun.spawn([tail, "-f", join(directory, "watched"), `${output}/partial.mkv`], { stdout: "ignore", stderr: "ignore" });
  try {
    await Bun.sleep(100);
    expect(await reapStrayEncoders(output)).toBe(1);
    expect(await stray.exited).not.toBe(0);
    expect(bystander.exitCode).toBeNull();
  } finally {
    stray.kill("SIGKILL");
    bystander.kill("SIGKILL");
    await rm(directory, { recursive: true, force: true });
  }
});
