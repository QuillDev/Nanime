import { expect, test } from "bun:test";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeClip, run, runText, withTemporaryDirectory } from "./testMedia.ts";
import { parseCpuList, presetArgs, reapStrayEncoders, transcodeWorkerBudget } from "./transcodeEncoder.ts";

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

test("compatibility copies cap their bitrate so heavy scenes stay streamable", async () => {
  await withTemporaryDirectory("nanime-preset-bitrate-", async (directory) => {
    // Full-frame noise: uncapped CRF 20 lands near 30 Mbps at this size.
    const seconds = 4;
    const source = await makeClip(join(directory, "noise.mkv"), { seconds, size: "640x360", filter: "noise=alls=60:allf=t" });
    const output = join(directory, "stored.mkv");
    await run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", source, ...presetArgs("compatibility"), output]);

    const packets = await runText(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "packet=size", "-of", "csv=p=0", output]);
    const bytes = packets.trim().split("\n").reduce((sum, line) => sum + Number(line), 0);
    // A 6 Mbps VBV cap with a 12 Mbit buffer bounds any window to 6 Mbps × T + 12 Mbit.
    expect(bytes * 8).toBeLessThanOrEqual(6_000_000 * seconds + 12_000_000);
  });
}, 60_000);

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
