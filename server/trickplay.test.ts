import { expect, test } from "bun:test";
import { trickplayPlan } from "./trickplay.ts";

test("uses a dense interval for episodes and bounds long-video frame counts", () => {
  expect(trickplayPlan(24 * 60)).toEqual({ interval: 5, frameCount: 288, sheetCount: 12 });
  expect(trickplayPlan(3 * 60 * 60)).toEqual({ interval: 40, frameCount: 270, sheetCount: 11 });
});
