import { expect, test } from "bun:test";
import { join } from "node:path";
import { makeClip, probeStreams, run } from "./testMedia.ts";
import { withTemporaryDirectory } from "./testProcess.ts";
import { trickplayFrameArgs, trickplayPlan, trickplaySheetArgs } from "./trickplay.ts";

test("uses a dense interval for episodes and bounds long-video frame counts", () => {
  expect(trickplayPlan(24 * 60)).toEqual({ interval: 5, frameCount: 288, sheetCount: 12 });
  expect(trickplayPlan(3 * 60 * 60)).toEqual({ interval: 40, frameCount: 270, sheetCount: 11 });
});

test("a contact sheet is one 5x5 grid of 240x136 tiles, letterboxing non-16:9 video", async () => {
  await withTemporaryDirectory("nanime-trickplay-sheet-", async (directory) => {
    const abs = await makeClip(join(directory, "square.mkv"), { seconds: 12, size: "320x320" });
    const output = join(directory, "sheet-000.jpg");
    await run(["ffmpeg", ...trickplaySheetArgs({ abs, output, start: 0, duration: 12, interval: 5 })]);

    expect(await probeStreams(output)).toMatchObject([{ codec_name: "mjpeg", width: 1200, height: 680 }]);
  });
}, 30_000);

test("a live fallback frame is a single 240x136 JPEG", async () => {
  await withTemporaryDirectory("nanime-trickplay-frame-", async (directory) => {
    const abs = await makeClip(join(directory, "episode.mkv"), { seconds: 6 });
    const output = join(directory, "frame.jpg");
    await Bun.write(output, await run(["ffmpeg", ...trickplayFrameArgs(abs, 3)]));

    expect(await probeStreams(output)).toMatchObject([{ codec_name: "mjpeg", width: 240, height: 136 }]);
  });
}, 30_000);
