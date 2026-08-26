import { describe, expect, test } from "bun:test";
import { shiftWebVtt } from "./subtitles.ts";

describe("HLS subtitle timeline shifting", () => {
  test("shifts cues by the exact playback-session origin", () => {
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

  test("drops cues ending at the restart boundary", () => {
    const source = "WEBVTT\n\n00:08.000 --> 00:10.000\nGone\n\n00:10.000 --> 00:11.000\nVisible";

    expect(shiftWebVtt(source, 10)).toBe(
      "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nVisible",
    );
  });

  test("preserves cue identifiers, settings, and text", () => {
    const source = [
      "WEBVTT",
      "",
      "cue-42",
      "01:02.500 --> 01:05.250 position:25% align:start",
      "First line",
      "Second line",
    ].join("\n");

    expect(shiftWebVtt(source, 60)).toContain(
      "cue-42\n00:00:02.500 --> 00:00:05.250 position:25% align:start\nFirst line\nSecond line",
    );
  });

  test("leaves an unshifted subtitle document byte-for-byte unchanged", () => {
    const source = "WEBVTT\n\nNOTE metadata\n\nmalformed timing block";

    expect(shiftWebVtt(source, 0)).toBe(source);
  });
});
