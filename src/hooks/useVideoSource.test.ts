import { describe, expect, mock, test } from "bun:test";
import { attachNativeHls, type NativeHlsVideo } from "../lib/nativeHlsPlayback.ts";
import {
  attachDirectVideoSource,
  type DirectVideoElement,
} from "../lib/directVideoPlayback.ts";
import { selectHlsPlaybackEngine } from "../lib/hlsPlaybackSelection.ts";

function nativeVideo(supported = true) {
  const play = mock(() => Promise.resolve());
  const load = mock(() => undefined);
  const pause = mock(() => undefined);
  const removeAttribute = mock((_name: string) => undefined);
  const video: NativeHlsVideo = Object.assign(new EventTarget(), {
    currentTime: 0,
    src: "",
    canPlayType: () => supported ? "maybe" as const : "" as const,
    load,
    pause,
    play,
    removeAttribute,
  });
  return {
    video, play, load, pause, removeAttribute,
    loadedMetadata: () => video.dispatchEvent(new Event("loadedmetadata")),
  };
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

  test("stops native loading and removes delayed metadata work on detach", () => {
    const native = nativeVideo();
    const detach = attachNativeHls({
      video: native.video,
      url: "/hls",
      onError: () => undefined,
      resumeAt: 20,
    });

    detach?.();
    native.loadedMetadata();

    expect(native.pause).toHaveBeenCalledTimes(1);
    expect(native.removeAttribute).toHaveBeenCalledWith("src");
    expect(native.load).toHaveBeenCalledTimes(1);
    expect(native.play).toHaveBeenCalledTimes(1);
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

describe("HLS playback engine selection", () => {
  test("prefers hls.js when Chrome claims native HLS might work", () => {
    expect(selectHlsPlaybackEngine(true, true)).toBe("hls.js");
  });

  test("uses native HLS only when MSE playback is unavailable", () => {
    expect(selectHlsPlaybackEngine(false, true)).toBe("native");
    expect(selectHlsPlaybackEngine(false, false)).toBe("unsupported");
  });
});

describe("direct video playback", () => {
  test("enables CORS mode before attaching an offline service-worker URL", async () => {
    const assignments: string[] = [];
    const play = mock(() => Promise.resolve());
    let crossOrigin: string | null = null;
    let src = "";
    const video: DirectVideoElement = {
      play,
      get crossOrigin() {
        return crossOrigin;
      },
      set crossOrigin(value: string | null) {
        crossOrigin = value;
        assignments.push(`crossOrigin:${value ?? ""}`);
      },
      get src() {
        return src;
      },
      set src(value: string) {
        src = value;
        assignments.push(`src:${value}`);
      },
    };

    attachDirectVideoSource(video, "/offline-download/episode-1/media");
    await Promise.resolve();

    expect(assignments).toEqual([
      "crossOrigin:anonymous",
      "src:/offline-download/episode-1/media",
    ]);
    expect(play).toHaveBeenCalledTimes(1);
  });
});
