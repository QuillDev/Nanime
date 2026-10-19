import { expect, test } from "bun:test";
import {
  hlsSessionPlan,
  playlistReadyToServe,
  rewritePlaylist,
  safeSegmentName,
  transcodeArgs,
} from "./hls.ts";

test("builds one continuous HLS transcode from the resume boundary", () => {
  const args = transcodeArgs({
    abs: "/media/example.mkv",
    audioTrack: undefined,
    directory: "/cache/session",
    duration: 1420,
    hardwareAcceleration: "",
    segmentIndex: 61,
    start: 366,
    vaapiDevice: "",
  });

  expect(args).toContain("hls");
  expect(args).toContain("independent_segments+temp_file");
  expect(args.slice(args.indexOf("-hls_time"), args.indexOf("-hls_time") + 2))
    .toEqual(["-hls_time", "2"]);
  expect(args.slice(args.indexOf("-hls_playlist_type"), args.indexOf("-hls_playlist_type") + 2))
    .toEqual(["-hls_playlist_type", "event"]);
  expect(args).toContain("/cache/session/segment-%06d.ts");
  expect(args.slice(args.indexOf("-start_number"), args.indexOf("-start_number") + 2))
    .toEqual(["-start_number", "61"]);
  expect(args.slice(args.indexOf("-output_ts_offset"), args.indexOf("-output_ts_offset") + 2))
    .toEqual(["-output_ts_offset", "366"]);
});

test("places hardware decoding options before the media input", () => {
  const args = transcodeArgs({
    abs: "/media/example.mkv",
    audioTrack: undefined,
    directory: "/cache/session",
    duration: 60,
    hardwareAcceleration: "vaapi",
    segmentIndex: 0,
    start: 0,
    vaapiDevice: "/dev/dri/renderD128",
  });

  expect(args.indexOf("-hwaccel")).toBeLessThan(args.indexOf("-i"));
  expect(args.indexOf("-vf")).toBeGreaterThan(args.indexOf("-i"));
});

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
