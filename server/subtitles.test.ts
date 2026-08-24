import { expect, test } from "bun:test";
import { shiftWebVtt } from "./subtitles.ts";

test("shifts subtitle cues by the exact playback-session origin", () => {
  const source = [
    "WEBVTT",
    "",
    "05:57.730 --> 06:02.920",
    "Earlier cue",
    "",
    "06:04.690 --> 06:08.840",
    "Overlapping cue",
    "",
    "06:10.050 --> 06:12.000 align:start",
    "Later cue",
    "",
  ].join("\n");

  expect(shiftWebVtt(source, 366)).toBe([
    "WEBVTT",
    "",
    "00:00:00.000 --> 00:00:02.840",
    "Overlapping cue",
    "",
    "00:00:04.050 --> 00:00:06.000 align:start",
    "Later cue",
    "",
  ].join("\n"));
});
