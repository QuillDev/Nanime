import { describe, expect, test } from "bun:test";
import { attachNativeHls, type NativeHlsVideo } from "../lib/nativeHlsPlayback.ts";
import {
  attachDirectVideoSource,
  type DirectVideoElement,
} from "../lib/directVideoPlayback.ts";
import { selectHlsPlaybackEngine } from "../lib/hlsPlaybackSelection.ts";
import { backgroundRecoveryDue } from "./useHlsBackgroundRecovery.ts";

/** A media element that keeps the state a viewer would see: source, time, paused. */
class FakeNativeVideo extends EventTarget implements NativeHlsVideo {
  currentTime = 0;
  src = "";
  paused = true;
  private readonly hlsSupport: CanPlayTypeResult;

  constructor(hlsSupport: CanPlayTypeResult) {
    super();
    this.hlsSupport = hlsSupport;
  }

  canPlayType(): CanPlayTypeResult {
    return this.hlsSupport;
  }

  load(): void {
    this.currentTime = 0;
  }

  pause(): void {
    this.paused = true;
  }

  play(): Promise<void> {
    this.paused = this.src === "";
    return Promise.resolve();
  }

  removeAttribute(name: string): void {
    if (name === "src") {
      this.src = "";
    }
  }

  loadedMetadata(): void {
    this.dispatchEvent(new Event("loadedmetadata"));
  }
}

describe("native HLS playback adapter", () => {
  test("positions Safari-style native HLS at the requested VOD time", () => {
    const video = new FakeNativeVideo("maybe");
    const errors: string[] = [];

    attachNativeHls({
      video,
      url: "/hls?start=367",
      onError: (message) => errors.push(message),
      resumeAt: 367,
      timelineOffset: 366,
    });
    video.loadedMetadata();

    expect(video.src).toBe("/hls?start=367");
    expect(video.currentTime).toBe(1);
    expect(video.paused).toBe(false);
    expect(errors).toEqual([]);
  });

  test("loads a paused replacement without forcing playback", () => {
    const video = new FakeNativeVideo("maybe");

    attachNativeHls({
      video,
      url: "/hls",
      onError: () => undefined,
      resumeAt: 901,
      shouldPlay: false,
      timelineOffset: 900,
    });
    video.loadedMetadata();

    expect(video.currentTime).toBe(1);
    expect(video.paused).toBe(true);
  });

  test("detaching stops playback, unloads the source and ignores late metadata", () => {
    const video = new FakeNativeVideo("maybe");
    const detach = attachNativeHls({
      video,
      url: "/hls",
      onError: () => undefined,
      resumeAt: 20,
    });

    detach?.();
    video.loadedMetadata();

    expect(video.paused).toBe(true);
    expect(video.src).toBe("");
    expect(video.currentTime).toBe(0);
  });

  test("reports unsupported native playback without attaching a source", () => {
    const video = new FakeNativeVideo("");
    const errors: string[] = [];

    attachNativeHls({ video, url: "/hls", onError: (message) => errors.push(message) });

    expect(video.src).toBe("");
    expect(video.paused).toBe(true);
    expect(errors).toEqual(["This browser does not support HLS video playback."]);
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

describe("HLS background recovery", () => {
  test("renews only after a background interval can expire the server lease", () => {
    expect(backgroundRecoveryDue(null, 100_000)).toBe(false);
    expect(backgroundRecoveryDue(40_001, 100_000)).toBe(false);
    expect(backgroundRecoveryDue(40_000, 100_000)).toBe(true);
    expect(backgroundRecoveryDue(10_000, 100_000)).toBe(true);
  });
});

describe("direct video playback", () => {
  test("enables CORS mode before attaching an offline service-worker URL, then plays", async () => {
    // The browser fixes the request mode when src is assigned, so the order
    // of these assignments is the contract with the media element.
    const assignments: string[] = [];
    let crossOrigin: string | null = null;
    let src = "";
    let playing = false;
    const video: DirectVideoElement = {
      play: () => {
        playing = src !== "";
        return Promise.resolve();
      },
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
    expect(playing).toBe(true);
  });
});
