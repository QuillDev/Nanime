export interface NativeHlsVideo extends EventTarget {
  currentTime: number;
  src: string;
  readonly canPlayType: (type: string) => CanPlayTypeResult;
  readonly load: () => void;
  readonly pause: () => void;
  readonly play: () => Promise<void>;
  readonly removeAttribute: (name: string) => void;
}

export interface NativeHlsAttachment {
  readonly video: NativeHlsVideo;
  readonly url: string;
  readonly onError: (message: string) => void;
  readonly resumeAt?: number;
  readonly shouldPlay?: boolean;
  readonly timelineOffset?: number;
}

function tryPlay(video: NativeHlsVideo): void {
  void (async (): Promise<void> => {
    try {
      await video.play();
    } catch {
      // Autoplay may be blocked; explicit playback remains available.
    }
  })();
}

export function attachNativeHls(options: NativeHlsAttachment): (() => void) | undefined {
  const { video, url, onError, resumeAt = 0, shouldPlay = true, timelineOffset = 0 } = options;
  if (video.canPlayType("application/vnd.apple.mpegurl") === "") {
    onError("This browser does not support HLS video playback.");
    return undefined;
  }
  video.src = url;
  if (shouldPlay) {
    tryPlay(video);
  }
  const handleMetadata = () => {
    video.currentTime = Math.max(0, resumeAt - timelineOffset);
    if (shouldPlay) {
      tryPlay(video);
    }
  };
  video.addEventListener("loadedmetadata", handleMetadata, { once: true });
  return () => {
    video.removeEventListener("loadedmetadata", handleMetadata);
    video.pause();
    video.removeAttribute("src");
    video.load();
  };
}
