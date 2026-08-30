export interface DirectVideoElement {
  crossOrigin: string | null;
  src: string;
  play: () => Promise<void>;
}

function tryPlay(video: DirectVideoElement): void {
  void (async (): Promise<void> => {
    try {
      await video.play();
    } catch {
      // Autoplay may be blocked by the browser; the user can press play.
    }
  })();
}

export function attachDirectVideoSource(video: DirectVideoElement, url: string): void {
  // Media elements must use CORS mode for their range requests to be routed
  // through the service worker that exposes browser-stored offline episodes.
  video.crossOrigin = "anonymous";
  video.src = url;
  tryPlay(video);
}
