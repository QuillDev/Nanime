import { expect, test } from "bun:test";
import { HlsStoppingCapacity } from "./hlsCapacity.ts";

test("stopping HLS encoders remain counted until their process exits", () => {
  const stopping = new HlsStoppingCapacity();
  const finishFirst = stopping.begin(7);
  const finishSecond = stopping.begin(8);
  expect(stopping.count()).toBe(2);
  expect(stopping.count(7)).toBe(1);
  finishFirst();
  finishFirst();
  expect(stopping.count()).toBe(1);
  expect(stopping.count(7)).toBe(0);
  finishSecond();
  expect(stopping.count()).toBe(0);
});
