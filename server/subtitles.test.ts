import { describe, expect, test } from "bun:test";
import { shiftWebVtt } from "./subtitles.ts";

describe("subtitle shifting", () => {
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
