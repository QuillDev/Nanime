import { describe, expect, test } from "bun:test";
import { chooseAudioTrack, type AudioTrack } from "./audioTracks.ts";

const TRACKS: readonly AudioTrack[] = [
  { index: 1, codec: "aac", language: "eng", label: "English", channels: 2, isDefault: true },
  { index: 2, codec: "aac", language: "jpn", label: "Japanese", channels: 2, isDefault: false },
];

describe("audio track selection", () => {
  test("prefers Japanese metadata over the container default", () => {
    expect(chooseAudioTrack(TRACKS, null, "ja")?.index).toBe(2);
  });

  test("falls back to the container default when the preference is unavailable", () => {
    expect(chooseAudioTrack(TRACKS, null, "ko")?.index).toBe(1);
  });

  test("lets an explicit player selection override the account preference", () => {
    expect(chooseAudioTrack(TRACKS, 1, "ja")?.index).toBe(1);
    expect(chooseAudioTrack(TRACKS, 99, "ja")).toBeNull();
  });
});
