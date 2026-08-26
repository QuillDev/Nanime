import { expect, test } from "bun:test";
import { trickplayFrameArgs, trickplayPlan, trickplaySheetArgs } from "./trickplay.ts";

test("uses a dense interval for episodes and bounds long-video frame counts", () => {
  expect(trickplayPlan(24 * 60)).toEqual({ interval: 5, frameCount: 288, sheetCount: 12 });
  expect(trickplayPlan(3 * 60 * 60)).toEqual({ interval: 40, frameCount: 270, sheetCount: 11 });
});

test("builds one low-resolution contact sheet at a time", () => {
  const args = trickplaySheetArgs({
    abs: "/media/example.mkv",
    output: "/cache/sheet-000.jpg",
    start: 125,
    duration: 125,
    interval: 5,
  });
  expect(args.slice(args.indexOf("-ss"), args.indexOf("-ss") + 2)).toEqual(["-ss", "125"]);
  expect(args).toContain("fps=1/5,scale=240:136:force_original_aspect_ratio=decrease,pad=240:136:(ow-iw)/2:(oh-ih)/2:black,setsar=1,tile=5x5");
  expect(args).toContain("/cache/sheet-000.jpg");
});

test("uses input seeking for responsive live fallback frames", () => {
  const args = trickplayFrameArgs("/media/example.mkv", 365);
  expect(args.indexOf("-ss")).toBeLessThan(args.indexOf("-i"));
  expect(args).toContain("image2pipe");
});
