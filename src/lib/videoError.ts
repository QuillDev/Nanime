function mediaErrorName(code: number): string {
  switch (code) {
    case 1: {
      return "MEDIA_ERR_ABORTED";
    }
    case 2: {
      return "MEDIA_ERR_NETWORK";
    }
    case 3: {
      return "MEDIA_ERR_DECODE";
    }
    case 4: {
      return "MEDIA_ERR_SRC_NOT_SUPPORTED";
    }
    default: {
      return "MEDIA_ERR_UNKNOWN";
    }
  }
}

export function videoErrorDetail(video: HTMLVideoElement): string {
  const { error } = video;
  const code = error?.code ?? 0;
  const name = mediaErrorName(code);
  const message = error?.message.trim() ?? "";
  return [
    "Video playback failed.",
    `MediaError: ${name} (${String(code)})${message === "" ? "" : ` — ${message}`}`,
    `Network state: ${String(video.networkState)}`,
    `Ready state: ${String(video.readyState)}`,
    `Current time: ${String(video.currentTime)}`,
    `Source: ${video.currentSrc || video.src || "Unavailable"}`,
    `Browser: ${navigator.userAgent}`,
    `Time: ${new Date().toISOString()}`,
  ].join("\n");
}
