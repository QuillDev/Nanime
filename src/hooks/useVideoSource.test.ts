import { describe, expect, mock, test } from "bun:test";
import { attachNativeHls, type NativeHlsVideo } from "../lib/nativeHlsPlayback.ts";

function nativeVideo(supported = true) {
  const play = mock(() => Promise.resolve());
  const video: NativeHlsVideo = Object.assign(new EventTarget(), {
    currentTime: 0,
    src: "",
    canPlayType: () => supported ? "maybe" as const : "" as const,
    play,
  });
  return { video, play, loadedMetadata: () => video.dispatchEvent(new Event("loadedmetadata")) };
}

describe("native HLS playback adapter", () => {
  test("positions Safari-style native HLS at the requested VOD time", () => {
    const native = nativeVideo();
    const onError = mock((_message: string) => undefined);

    attachNativeHls({
      video: native.video,
      url: "/hls?start=367",
      onError,
      resumeAt: 367,
      timelineOffset: 366,
    });

    expect(native.video.src).toBe("/hls?start=367");
    expect(native.play).toHaveBeenCalledTimes(1);
    native.loadedMetadata();
    expect(native.video.currentTime).toBe(1);
    expect(native.play).toHaveBeenCalledTimes(2);
    expect(onError).not.toHaveBeenCalled();
  });

  test("loads a paused replacement without forcing playback", () => {
    const native = nativeVideo();

    attachNativeHls({
      video: native.video,
      url: "/hls",
      onError: () => undefined,
      resumeAt: 901,
      shouldPlay: false,
      timelineOffset: 900,
    });
    native.loadedMetadata();

    expect(native.video.currentTime).toBe(1);
    expect(native.play).not.toHaveBeenCalled();
  });

  test("reports unsupported native playback without attaching a source", () => {
    const native = nativeVideo(false);
    const onError = mock((_message: string) => undefined);

    attachNativeHls({ video: native.video, url: "/hls", onError });

    expect(native.video.src).toBe("");
    expect(native.play).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith("This browser does not support HLS video playback.");
  });
});
