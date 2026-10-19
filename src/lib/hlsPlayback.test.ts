import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

interface FakeHlsConfig {
  readonly autoStartLoad: boolean;
  readonly enableWorker: boolean;
  readonly maxBufferLength: number;
  readonly maxMaxBufferLength: number;
  readonly manifestLoadPolicy: {
    readonly default: {
      readonly errorRetry: {
        readonly maxNumRetry: number;
        readonly shouldRetry: (...arguments_: [
          config: { readonly maxNumRetry: number },
          retryCount: number,
          isTimeout: boolean,
          response: { readonly code: number },
          retry: boolean,
        ]) => boolean;
      };
    };
  };
  readonly startPosition: number;
}

interface FakeEventData {
  readonly details?: string;
  readonly error?: Error;
  readonly fatal?: boolean;
  readonly response?: { readonly code: number; readonly url: string };
  readonly stats?: { readonly loaded: number; readonly retry: number };
  readonly type?: string;
}

type HlsHandler = (event: string, data: FakeEventData) => void;

class FakeHls {
  static readonly Events = { ERROR: "error", MANIFEST_PARSED: "manifest" };
  static readonly ErrorTypes = { MEDIA_ERROR: "mediaError" };
  static supported = true;
  static instances: FakeHls[] = [];

  readonly handlers = new Map<string, HlsHandler[]>();
  readonly config: FakeHlsConfig;
  readonly startLoads: number[] = [];
  source: string | null = null;
  media: HTMLVideoElement | null = null;
  destroyed = false;
  recoveries = 0;

  constructor(config: FakeHlsConfig) {
    this.config = config;
    FakeHls.instances.push(this);
  }

  static isSupported(): boolean {
    return FakeHls.supported;
  }

  on(event: string, handler: HlsHandler): void {
    this.handlers.set(event, [...this.handlers.get(event) ?? [], handler]);
  }

  emit(event: string, data: FakeEventData = {}): void {
    for (const handler of this.handlers.get(event) ?? []) {
      handler(event, data);
    }
  }

  startLoad(position: number): void {
    this.startLoads.push(position);
  }

  loadSource(url: string): void {
    this.source = url;
  }

  attachMedia(media: HTMLVideoElement): void {
    this.media = media;
  }

  recoverMediaError(): void {
    this.recoveries += 1;
  }

  destroy(): void {
    this.destroyed = true;
  }
}

mock.module("hls.js", () => ({ default: FakeHls }));
const { attachHls } = await import("./hlsPlayback.ts");

/** A media element whose paused state follows play requests, like a browser's. */
function fakeVideo() {
  const video = Object.assign(new EventTarget(), {
    ended: false,
    paused: true,
    play: () => {
      video.paused = false;
      return Promise.resolve();
    },
  });
  // eslint-disable-next-line anti-slop/no-chained-type-assertions
  return video as unknown as HTMLVideoElement;
}

function fatalError(type: string) {
  return {
    fatal: true,
    type,
    details: "bufferStalledError",
    error: new Error("decoder failed"),
    response: { code: 500, url: "https://example.test/segment.ts" },
    stats: { loaded: 12, retry: 2 },
  };
}

interface FakePage extends EventTarget {
  visibilityState: DocumentVisibilityState;
}

function installFakePage(): FakePage {
  const page = Object.assign(new EventTarget(), { visibilityState: "visible" as const });
  Object.defineProperty(globalThis, "document", { configurable: true, value: page });
  return page;
}

function setPageVisibility(page: FakePage, visibility: DocumentVisibilityState): void {
  page.visibilityState = visibility;
  page.dispatchEvent(new Event("visibilitychange"));
}

function expectForegroundResume(fixture: ReturnType<typeof attachedFixture>): void {
  expect(fixture.hls?.startLoads).toEqual([1, -1]);
  expect(fixture.video.paused).toBe(false);
}

function expectDetachedLifecycle(fixture: ReturnType<typeof attachedFixture>, page: FakePage): void {
  fixture.detach?.();
  setPageVisibility(page, "hidden");
  setPageVisibility(page, "visible");
  expect(fixture.hls?.startLoads).toEqual([1, -1]);
}

beforeEach(() => {
  FakeHls.supported = true;
  FakeHls.instances = [];
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, "document");
});

function attachedFixture() {
  const video = fakeVideo();
  const onError = mock((_message: string) => undefined);
  const detach = attachHls({
    video,
    url: "/hls?path=episode.mkv",
    onError,
    resumeAt: 367,
    timelineOffset: 366,
  });
  const [hls] = FakeHls.instances;
  return { detach, hls, onError, video };
}

function expectInitialAttachment(fixture: ReturnType<typeof attachedFixture>): void {
  expect(fixture.hls?.config).toEqual({
    autoStartLoad: false,
    maxBufferLength: 30,
    maxMaxBufferLength: 30,
    enableWorker: true,
    manifestLoadPolicy: expect.any(Object),
    startPosition: 1,
  });
  expect({ media: fixture.hls?.media, source: fixture.hls?.source }).toEqual({
    media: fixture.video,
    source: "/hls?path=episode.mkv",
  });
  expect(fixture.video.paused).toBe(false);
}

describe("hls.js playback adapter", () => {
  test("attaches a bounded-buffer HLS engine and starts at local resume time", () => {
    const fixture = attachedFixture();
    expectInitialAttachment(fixture);
    fixture.hls?.emit(FakeHls.Events.MANIFEST_PARSED);
    expect(fixture.hls?.startLoads).toEqual([1]);
    expect(fixture.video.paused).toBe(false);
    fixture.detach?.();
    expect(fixture.hls?.destroyed).toBe(true);
    expect(fixture.onError).not.toHaveBeenCalled();
  });

  test("keeps a paused stream paused while loading a replacement source", () => {
    const video = fakeVideo();
    attachHls({
      video,
      url: "/hls",
      onError: () => undefined,
      resumeAt: 20,
      shouldPlay: false,
      timelineOffset: 20,
    });

    const [hls] = FakeHls.instances;
    hls?.emit(FakeHls.Events.MANIFEST_PARSED);
    expect(video.paused).toBe(true);
    expect(hls?.startLoads).toEqual([0]);
  });

  test("resumes HLS loading once when a playing page returns to the foreground", () => {
    const page = installFakePage();
    const fixture = attachedFixture();
    fixture.hls?.emit(FakeHls.Events.MANIFEST_PARSED);
    setPageVisibility(page, "hidden");
    setPageVisibility(page, "visible");
    setPageVisibility(page, "visible");
    expectForegroundResume(fixture);
    expectDetachedLifecycle(fixture, page);
  });

  test("retries a transient missing manifest without retrying permanent client errors", () => {
    const fixture = attachedFixture();
    const retry = fixture.hls?.config.manifestLoadPolicy.default.errorRetry;
    expect(retry?.shouldRetry(retry, 0, false, { code: 404 }, false)).toBe(true);
    expect(retry?.shouldRetry(retry, 3, false, { code: 404 }, false)).toBe(false);
    expect(retry?.shouldRetry(retry, 0, false, { code: 401 }, false)).toBe(false);
    expect(retry?.shouldRetry(retry, 0, false, { code: 500 }, true)).toBe(true);
  });

  test("recovers one fatal media error before surfacing a diagnostic", () => {
    const onError = mock((_message: string) => undefined);
    attachHls({ video: fakeVideo(), url: "/hls", onError });
    const [hls] = FakeHls.instances;

    hls?.emit(FakeHls.Events.ERROR, fatalError(FakeHls.ErrorTypes.MEDIA_ERROR));
    expect({ errors: onError.mock.calls.length, recoveries: hls?.recoveries })
      .toEqual({ errors: 0, recoveries: 1 });

    hls?.emit(FakeHls.Events.ERROR, fatalError(FakeHls.ErrorTypes.MEDIA_ERROR));
    expect(onError).toHaveBeenCalledTimes(1);
    const [call] = onError.mock.calls;
    expect(call?.[0]).toContain("HTTP status: 500");
    expect(call?.[0]).toContain("Retries: 2");
  });

  test("ignores nonfatal errors and reports fatal network failures", () => {
    const onError = mock((_message: string) => undefined);
    attachHls({ video: fakeVideo(), url: "/hls", onError });
    const [hls] = FakeHls.instances;
    const nonfatal = { ...fatalError("networkError"), fatal: false };

    hls?.emit(FakeHls.Events.ERROR, nonfatal);
    expect(onError).not.toHaveBeenCalled();
    hls?.emit(FakeHls.Events.ERROR, fatalError("networkError"));
    expect(onError).toHaveBeenCalledTimes(1);
    const [call] = onError.mock.calls;
    expect(call?.[0]).toContain("Type: networkError");
  });

  test("fails cleanly when MediaSource playback is unavailable", () => {
    FakeHls.supported = false;
    const onError = mock((_message: string) => undefined);

    expect(attachHls({ video: fakeVideo(), url: "/hls", onError })).toBeUndefined();
    expect(FakeHls.instances).toHaveLength(0);
    expect(onError).toHaveBeenCalledWith("This browser does not support HLS video playback.");
  });
});
