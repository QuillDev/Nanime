import Hls, { type ErrorData } from "hls.js";

export interface HlsAttachment {
  readonly video: HTMLVideoElement;
  readonly url: string;
  readonly onError: (message: string) => void;
  readonly resumeAt?: number;
  readonly shouldPlay?: boolean;
  readonly timelineOffset?: number;
}

export function hlsJsSupported(): boolean {
  return Hls.isSupported();
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

function bindHlsEvents(hls: Hls, options: HlsAttachment): void {
  const { video, onError, resumeAt = 0, shouldPlay = true, timelineOffset = 0 } = options;
  let recoveredMediaError = false;
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
    onError(hlsErrorDetail(data));
  });
}

export function attachHls(options: HlsAttachment): (() => void) | undefined {
  if (!hlsJsSupported()) {
    options.onError("This browser does not support HLS video playback.");
    return undefined;
  }
  const hls = new Hls({
    autoStartLoad: false,
    maxBufferLength: 30,
    maxMaxBufferLength: 30,
    enableWorker: true,
    startPosition: options.resumeAt === undefined
      ? -1
      : Math.max(0, options.resumeAt - (options.timelineOffset ?? 0)),
  });
  bindHlsEvents(hls, options);
  hls.loadSource(options.url);
  hls.attachMedia(options.video);
  if (options.shouldPlay ?? true) {
    tryPlay(options.video);
  }
  return () => {
    hls.destroy();
  };
}
