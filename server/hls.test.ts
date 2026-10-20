import { expect, test } from "bun:test";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { firstVideoPacket, makeClip, run } from "./testMedia.ts";
import { withTemporaryDirectory } from "./testProcess.ts";
import {
  hlsSessionPlan,
  playlistReadyToServe,
  rewritePlaylist,
  safeSegmentName,
  transcodeArgs,
} from "./hls.ts";

test("a resumed live-encode session publishes an event playlist whose first segment starts at the resume boundary", async () => {
  await withTemporaryDirectory("nanime-hls-encode-", async (directory) => {
    const abs = await makeClip(join(directory, "episode.mkv"), { seconds: 9, audio: ["jpn"] });
    const session = join(directory, "session");
    await mkdir(session);
    await run(["ffmpeg", ...transcodeArgs({
      abs, audioTrack: undefined, directory: session, duration: 9,
      hardwareAcceleration: "", vaapiDevice: "", segmentIndex: 2, start: 4,
    })]);

    const playlist = await readFile(join(session, "index.m3u8"), "utf8");
    expect(playlist).toContain("#EXT-X-PLAYLIST-TYPE:EVENT");
    expect(playlist.split("\n").filter((line) => line.endsWith(".ts"))).toEqual(["segment-000002.ts", "segment-000003.ts", "segment-000004.ts"]);
    const first = await firstVideoPacket(join(session, "segment-000002.ts"));
    expect(first.time).toBeGreaterThanOrEqual(4);
    expect(first.time - 4).toBeLessThan(0.05);
  });
}, 30_000);

test("routes generated playlist segments through the authenticated session", () => {
  const playlist = [
    "#EXTM3U",
    "#EXT-X-MEDIA-SEQUENCE:61",
    "#EXTINF:6.006000,",
    "segment-000061.ts",
    "",
  ].join("\n");

  expect(rewritePlaylist(playlist, "session id")).toContain(
    "/hls/seg?session=session%20id&name=segment-000061.ts",
  );
  expect(rewritePlaylist(playlist, "session id", "lease id")).toContain(
    "/hls/seg?session=session%20id&lease=lease%20id&name=segment-000061.ts",
  );
});

test("aligns requested HLS starts to safe segment boundaries", () => {
  expect(hlsSessionPlan(1420, 367)).toEqual({ segmentIndex: 183, start: 366 });
  expect(hlsSessionPlan(1420, -20)).toEqual({ segmentIndex: 0, start: 0 });
  expect(hlsSessionPlan(1420, 9000)).toEqual({ segmentIndex: 709, start: 1418 });
  expect(hlsSessionPlan(1, 1)).toEqual({ segmentIndex: 0, start: 0 });
  expect(hlsSessionPlan(Number.NaN, Number.POSITIVE_INFINITY))
    .toEqual({ segmentIndex: 0, start: 0 });
});

function eventPlaylist(segments: number, ended = false): string {
  return [
    "#EXTM3U",
    "#EXT-X-TARGETDURATION:2",
    "#EXT-X-PLAYLIST-TYPE:EVENT",
    ...Array.from({ length: segments }, (_, index) => [
      "#EXTINF:2.002000,",
      `segment-${String(index).padStart(6, "0")}.ts`,
    ]).flat(),
    ...(ended ? ["#EXT-X-ENDLIST"] : []),
    "",
  ].join("\n");
}

test("holds the first playlist until playback can continue past its first segment", () => {
  expect(playlistReadyToServe(eventPlaylist(1))).toBe(false);
  expect(playlistReadyToServe(eventPlaylist(2))).toBe(false);
  expect(playlistReadyToServe(eventPlaylist(3))).toBe(true);
  expect(playlistReadyToServe(eventPlaylist(1, true))).toBe(true);
});

test("only accepts generated segment basenames", () => {
  expect(safeSegmentName("segment-000061.ts")).toBe(true);
  expect(safeSegmentName("segment-61.ts")).toBe(false);
  expect(safeSegmentName("../segment-000061.ts")).toBe(false);
  expect(safeSegmentName("segment-000061.ts/../../secret")).toBe(false);
  expect(safeSegmentName(null)).toBe(false);
});

test("rewrites segment paths without trusting playlist directories", () => {
  const playlist = "#EXTM3U\n/tmp/private/segment-000061.ts\n";

  expect(rewritePlaylist(playlist, "session/unsafe")).toBe(
    "#EXTM3U\n/hls/seg?session=session%2Funsafe&name=segment-000061.ts\n",
  );
});
