import Hls, {
  type ErrorData,
  type HlsConfig,
  type Loader,
  type LoaderCallbacks,
  type LoaderConfiguration,
  type LoaderContext,
  type LoaderStats,
  type PlaylistLoaderConstructor,
  type PlaylistLoaderContext,
  type RetryConfig,
} from "hls.js";

export interface HlsAttachment {
  readonly video: HTMLVideoElement;
  readonly url: string;
  /** `media`: the browser couldn't decode or buffer the video (as opposed to loading it). */
  readonly onError: (message: string, kind?: "media") => void;
  readonly resumeAt?: number;
  readonly shouldPlay?: boolean;
  readonly timelineOffset?: number;
  /** The playlist body already fetched from `url`, so hls.js doesn't ask the server again. */
  readonly playlist?: string;
}

export function hlsJsSupported(): boolean {
  return Hls.isSupported();
}

const RETRYABLE_MANIFEST_STATUS = new Set([404, 425, 429, 503]);
type ManifestRetryArguments = Parameters<NonNullable<RetryConfig["shouldRetry"]>>;

export function retryTransientManifest(
  ...arguments_: ManifestRetryArguments
): boolean {
  const [retryConfig, retryCount, , response, retry] = arguments_;
  const retriesRemain = retryConfig !== null && retryConfig !== undefined &&
    retryCount < retryConfig.maxNumRetry;
  return retry || retriesRemain && RETRYABLE_MANIFEST_STATUS.has(response?.code ?? 0);
}

function tryPlay(video: HTMLVideoElement): void {
  void (async (): Promise<void> => {
    try {
      await video.play();
    } catch {
      // Autoplay may be blocked by the browser; the user can press play.
    }
  })();
}

function hlsErrorDetail(data: ErrorData): string {
  const { response } = data;
  return [
    "HLS playback failed.",
    `Type: ${data.type}`,
    `Details: ${data.details}`,
    `Fatal: ${String(data.fatal)}`,
    `Message: ${data.error.message}`,
    `HTTP status: ${response?.code === undefined ? "Unavailable" : String(response.code)}`,
    `URL: ${response?.url ?? data.url ?? data.frag?.url ?? "Unavailable"}`,
    `Loaded bytes: ${data.stats === undefined ? "Unavailable" : String(data.stats.loaded)}`,
    `Retries: ${data.stats === undefined ? "Unavailable" : String(data.stats.retry)}`,
    `Browser: ${navigator.userAgent}`,
    `Time: ${new Date().toISOString()}`,
  ].join("\n");
}

/**
 * A complete (VOD) playlist is the untouched source: its bitrate swings with
 * the scene, peaking at several times its average. Buffering minutes ahead
 * banks quiet scenes so a link near the average rides through the peaks.
 * Live sessions keep the short buffer, since their segments only exist as the
 * encoder reaches them.
 */
const VOD_BUFFER_SECONDS = 600;
const VOD_BUFFER_BYTES = 120 * 1000 * 1000;
const VOD_BACK_BUFFER_SECONDS = 60;

function bufferDeeplyForVod(hls: Hls): void {
  hls.on(Hls.Events.LEVEL_LOADED, (_event, data) => {
    if (data.details.live) {
      return;
    }
    hls.config.maxBufferLength = VOD_BUFFER_SECONDS;
    hls.config.maxMaxBufferLength = VOD_BUFFER_SECONDS;
    hls.config.maxBufferSize = VOD_BUFFER_BYTES;
    hls.config.backBufferLength = VOD_BACK_BUFFER_SECONDS;
  });
}

function bindHlsEvents(hls: Hls, options: HlsAttachment): void {
  const { video, onError, resumeAt = 0, shouldPlay = true, timelineOffset = 0 } = options;
  let recoveredMediaError = false;
  bufferDeeplyForVod(hls);
  hls.on(Hls.Events.MANIFEST_PARSED, () => {
    hls.startLoad(Math.max(0, resumeAt - timelineOffset));
    if (shouldPlay) {
      tryPlay(video);
    }
  });
  hls.on(Hls.Events.ERROR, (_event, data) => {
    if (!data.fatal) {
      return;
    }
    if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !recoveredMediaError) {
      recoveredMediaError = true;
      hls.recoverMediaError();
      return;
    }
    onError(hlsErrorDetail(data), data.type === Hls.ErrorTypes.MEDIA_ERROR ? "media" : undefined);
  });
}

function bindPageLifecycle(hls: Hls, video: HTMLVideoElement): () => void {
  if (typeof document === "undefined") {
    return () => undefined;
  }
  let suspended = false;
  const suspend = () => {
    suspended = true;
  };
  const resume = () => {
    if (!suspended || document.visibilityState === "hidden") {
      return;
    }
    suspended = false;
    if (!video.paused && !video.ended) {
      hls.startLoad(-1);
      tryPlay(video);
    }
  };
  const handleVisibility = () => {
    if (document.visibilityState === "hidden") {
      suspend();
    } else {
      resume();
    }
  };
  document.addEventListener("visibilitychange", handleVisibility);
  globalThis.addEventListener("pagehide", suspend);
  globalThis.addEventListener("pageshow", resume);
  return () => {
    document.removeEventListener("visibilitychange", handleVisibility);
    globalThis.removeEventListener("pagehide", suspend);
    globalThis.removeEventListener("pageshow", resume);
  };
}

function servedStats(bytes: number): LoaderStats {
  const now = performance.now();
  return {
    aborted: false, loaded: bytes, retry: 0, total: bytes, chunkCount: 0, bwEstimate: 0,
    loading: { start: now, first: now, end: now },
    parsing: { start: 0, end: 0 },
    buffering: { start: 0, first: 0, end: 0 },
  };
}

/**
 * Playlist loader that answers the first request for `url` with the body the
 * session opener already fetched (one round trip less before the first
 * segment), and loads everything else normally.
 */
function prefetchedPlaylistLoader(url: string, playlist: string): PlaylistLoaderConstructor {
  const target = new URL(url, globalThis.location.href).href;
  let unused = true;
  return class PrefetchedPlaylistLoader implements Loader<PlaylistLoaderContext> {
    context: PlaylistLoaderContext | null = null;
    stats: LoaderStats = servedStats(0);
    private readonly network: Loader<LoaderContext>;
    private timer: ReturnType<typeof setTimeout> | undefined = undefined;

    constructor(config: HlsConfig) {
      const NetworkLoader = config.loader;
      this.network = new NetworkLoader(config);
    }

    load(context: PlaylistLoaderContext, config: LoaderConfiguration, callbacks: LoaderCallbacks<PlaylistLoaderContext>): void {
      if (!unused || new URL(context.url, globalThis.location.href).href !== target) {
        this.network.load(context, config, callbacks as LoaderCallbacks<LoaderContext>);
        return;
      }
      unused = false;
      this.context = context;
      this.stats = servedStats(playlist.length);
      this.timer = setTimeout(() => {
        callbacks.onSuccess({ url: target, data: playlist, code: 200 }, this.stats, context, null);
      }, 0);
    }

    abort(): void {
      clearTimeout(this.timer);
      this.network.abort();
    }

    destroy(): void {
      clearTimeout(this.timer);
      this.network.destroy();
    }
  };
}

export function attachHls(options: HlsAttachment): (() => void) | undefined {
  if (!hlsJsSupported()) {
    options.onError("This browser does not support HLS video playback.");
    return undefined;
  }
  const config: Partial<HlsConfig> = {
    autoStartLoad: false,
    maxBufferLength: 30,
    maxMaxBufferLength: 30,
    enableWorker: true,
    manifestLoadPolicy: {
      default: {
        maxTimeToFirstByteMs: 10_000,
        maxLoadTimeMs: 20_000,
        timeoutRetry: { maxNumRetry: 2, retryDelayMs: 0, maxRetryDelayMs: 0 },
        errorRetry: {
          maxNumRetry: 3,
          retryDelayMs: 250,
          maxRetryDelayMs: 1000,
          shouldRetry: retryTransientManifest,
        },
      },
    },
    startPosition: options.resumeAt === undefined
      ? -1
      : Math.max(0, options.resumeAt - (options.timelineOffset ?? 0)),
  };
  if (options.playlist !== undefined) {
    config.pLoader = prefetchedPlaylistLoader(options.url, options.playlist);
  }
  const hls = new Hls(config);
  const unbindPageLifecycle = startHls(hls, options);
  return () => {
    unbindPageLifecycle();
    hls.destroy();
  };
}

function startHls(hls: Hls, options: HlsAttachment): () => void {
  bindHlsEvents(hls, options);
  const unbindPageLifecycle = bindPageLifecycle(hls, options.video);
  hls.loadSource(options.url);
  hls.attachMedia(options.video);
  if (options.shouldPlay ?? true) {
    tryPlay(options.video);
  }
  return unbindPageLifecycle;
}
