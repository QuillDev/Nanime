import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { MediaEntry } from "../types.ts";
import { absolutePlaybackPosition } from "./mediaTimeline.ts";

// Without MediaSource the player falls back to the browser's native HLS
// engine; pin that third-party capability so the real attachment path runs.
mock.module("hls.js", () => ({ default: { isSupported: () => false } }));
const { restartHls } = await import("./videoSourceRestart.ts");
type SourceState = Parameters<typeof restartHls>[0]["source"];

/** A media element holding the state a viewer sees: source URL, time, paused. */
class FakeVideo extends EventTarget {
  currentTime = 0;
  src = "";
  paused: boolean;
  ended = false;

  constructor(paused: boolean) {
    super();
    this.paused = paused;
  }

  canPlayType(): CanPlayTypeResult {
    return "maybe";
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

const ENTRY: MediaEntry = {
  rel: "Example/Episode 01.mkv",
  name: "Episode 01.mkv",
  folder: "Example",
  size: 1,
  direct: false,
};

/** The HLS server: records lease releases, the only request a restart sends. */
const released: Record<string, string>[] = [];
const originalFetch = globalThis.fetch;

beforeEach(() => {
  released.length = 0;
  globalThis.fetch = Object.assign((input: string | URL | Request): Promise<Response> => {
    const { searchParams } = new URL(String(input), "https://nanime.invalid");
    released.push(Object.fromEntries(searchParams));
    return Promise.resolve(new Response(null, { status: 204 }));
  }, { preconnect: originalFetch.preconnect });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

/** Waits for the asynchronously loaded HLS engine to attach a new stream URL. */
async function attachedStream(video: FakeVideo, previous: string, deadline: number): Promise<URLSearchParams> {
  if (video.src !== "" && video.src !== previous) {
    return new URL(video.src, "https://nanime.invalid").searchParams;
  }
  if (Date.now() > deadline) {
    throw new Error("restart never attached a stream");
  }
  await Bun.sleep(1);
  return attachedStream(video, previous, deadline);
}

function player(paused = false) {
  const video = new FakeVideo(paused);
  const offsets: number[] = [];
  const errors: (string | null)[] = [];
  const source: SourceState = {
    detach: undefined,
    hiddenAt: null,
    recoveryPending: false,
    selectedAudio: null,
    pendingPosition: null,
    playerId: "player-1",
    timelineOffset: 0,
    // eslint-disable-next-line anti-slop/no-chained-type-assertions
    video: video as unknown as HTMLVideoElement,
  };
  const restart = (position: number, audioTrack: number | null = null): Promise<URLSearchParams> => {
    const previous = video.src;
    restartHls({
      audioTrack,
      entry: ENTRY,
      position,
      setError: (error) => errors.push(error),
      setOffset: (offset) => offsets.push(offset),
      source,
    });
    return attachedStream(video, previous, Date.now() + 2000);
  };
  return { video, source, offsets, errors, restart };
}

describe("HLS restarts", () => {
  test("a distant seek restarts the stream at the segment boundary it falls in", async () => {
    const { offsets, restart } = player();

    const stream = await restart(901);

    expect(stream.get("path")).toBe(ENTRY.rel);
    expect(stream.get("start")).toBe("901");
    expect(offsets).toEqual([900]);
  });

  test("the player reports the requested absolute time before and after the new stream loads", async () => {
    const { video, source, restart } = player();

    await restart(901);
    expect(absolutePlaybackPosition(video.currentTime, source.timelineOffset, source.pendingPosition)).toBe(901);

    video.loadedMetadata();
    expect(video.currentTime).toBe(1);
    expect(video.paused).toBe(false);
    expect(absolutePlaybackPosition(video.currentTime, source.timelineOffset, null)).toBe(901);
  });

  test("switching audio while paused loads the new track without starting playback", async () => {
    const { video, restart } = player(true);

    const switched = await restart(121, 3);
    video.loadedMetadata();

    expect(switched.get("audio")).toBe("3");
    expect(video.paused).toBe(true);
  });

  test("a later seek keeps the chosen audio track and the paused state", async () => {
    const { video, source, restart } = player(true);
    await restart(121, 3);

    const sought = await restart(601, source.selectedAudio);
    video.loadedMetadata();

    expect(sought.get("audio")).toBe("3");
    expect(sought.get("start")).toBe("601");
    expect(video.currentTime).toBe(1);
    expect(video.paused).toBe(true);
  });

  test("restarting releases the replaced stream's lease, never the new one", async () => {
    const { restart } = player();

    const first = await restart(30);
    expect(released).toEqual([]);
    const second = await restart(600);

    expect(released).toEqual([{ player: "player-1", lease: first.get("lease") ?? "" }]);
    expect(second.get("lease")).not.toBe(first.get("lease"));
  });
});
