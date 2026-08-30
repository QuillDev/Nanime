import {
  leasedHlsUrl,
  releaseHlsPlayback,
  type HlsPlaybackLease,
} from "../hlsApi.ts";
import type { HlsAttachment } from "./hlsPlayback.ts";
import { selectHlsPlaybackEngine } from "./hlsPlaybackSelection.ts";
import { attachNativeHls } from "./nativeHlsPlayback.ts";
import { attachmentLifecycle } from "./attachmentLifecycle.ts";

interface LoadedHlsModule {
  readonly attachHls: (options: HlsAttachment) => (() => void) | undefined;
  readonly hlsJsSupported: () => boolean;
}

function attachLoadedHls(
  module: LoadedHlsModule,
  options: HlsAttachment,
): (() => void) | undefined {
  const native = options.video.canPlayType("application/vnd.apple.mpegurl") !== "";
  const engine = selectHlsPlaybackEngine(module.hlsJsSupported(), native);
  if (engine === "hls.js") {
    return module.attachHls(options);
  }
  if (engine === "native") {
    return attachNativeHls(options);
  }
  options.onError("This browser does not support HLS video playback.");
  return undefined;
}

async function releaseSafely(lease: HlsPlaybackLease): Promise<void> {
  try {
    await releaseHlsPlayback(lease);
  } catch {
    // Idle expiry is the fallback when the best-effort release cannot arrive.
  }
}

export function attachManagedHls(options: HlsAttachment, playerId: string): () => void {
  const lease: HlsPlaybackLease = { playerId, leaseId: crypto.randomUUID() };
  const lifecycle = attachmentLifecycle(() => {
    void releaseSafely(lease);
  });
  const leasedOptions = {
    ...options,
    url: leasedHlsUrl(options.url, lease),
    onError: (message: string) => {
      if (lifecycle.active()) {
        options.onError(message);
      }
    },
  };
  void (async (): Promise<void> => {
    try {
      const module = await import("./hlsPlayback.ts");
      if (lifecycle.active()) {
        lifecycle.attach(attachLoadedHls(module, leasedOptions));
      }
    } catch (error: unknown) {
      if (lifecycle.active()) {
        const detail = error instanceof Error ? error.message : "Unknown loading error";
        leasedOptions.onError(`Could not load HLS playback support: ${detail}`);
      }
    }
  })();
  return lifecycle.dispose;
}
