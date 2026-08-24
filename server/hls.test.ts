import { expect, test } from "bun:test";
import { rewritePlaylist, transcodeArgs } from "./hls.ts";

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
});
