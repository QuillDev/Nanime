import { expect, test } from "bun:test";
import { trickplayTile } from "./trickplay.ts";

const manifest = {
  status: "ready",
  version: "version",
  interval: 5,
  width: 240,
  height: 136,
  columns: 5,
  rows: 5,
  frameCount: 53,
  sheetCount: 3,
} as const;

test("maps absolute playback time to a sprite tile", () => {
  expect(trickplayTile(manifest, 0)).toEqual({ sheet: 0, x: 0, y: 0 });
  expect(trickplayTile(manifest, 30)).toEqual({ sheet: 0, x: 240, y: 136 });
  expect(trickplayTile(manifest, 125)).toEqual({ sheet: 1, x: 0, y: 0 });
});

test("clamps preview times to the available frames", () => {
  expect(trickplayTile(manifest, -10)).toEqual({ sheet: 0, x: 0, y: 0 });
  expect(trickplayTile(manifest, 10_000)).toEqual({ sheet: 2, x: 480, y: 0 });
});
