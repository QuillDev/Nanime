import Hls from "hls.js";

export interface HlsAttachment {
  readonly video: HTMLVideoElement;
  readonly url: string;
  readonly onError: (message: string) => void;
  readonly resumeAt?: number;
  readonly shouldPlay?: boolean;
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

function bindHlsEvents(hls: Hls, options: HlsAttachment): void {
  const { video, onError, resumeAt = 0, shouldPlay = true } = options;
  let recoveredMediaError = false;
  hls.on(Hls.Events.MANIFEST_PARSED, () => {
    if (resumeAt > 0) {
      video.currentTime = resumeAt;
    }
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
    onError(`Playback failed: ${data.details}.`);
  });
}

export function attachHls(options: HlsAttachment): (() => void) | undefined {
  if (!Hls.isSupported()) {
    options.onError("This browser does not support HLS video playback.");
    return undefined;
  }
  const hls = new Hls({ enableWorker: true });
  bindHlsEvents(hls, options);
  hls.loadSource(options.url);
  hls.attachMedia(options.video);
  return () => {
    hls.destroy();
  };
}
