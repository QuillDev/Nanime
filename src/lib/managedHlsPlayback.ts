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

export interface ManagedHlsAttachment extends HlsAttachment {
  /** Receives the episode time of the session's local zero once the server reports it. */
  readonly onTimelineOffset?: (offset: number) => void;
  /** The codec the session streams untouched (`hevc`, `av1`), or null when it's converted. */
  readonly onPassthroughCodec?: (codec: string | null) => void;
}

interface SessionDetails {
  readonly offset: number | null;
  readonly passthroughCodec: string | null;
}

/**
 * Where a session's playlist begins is the server's call: passthrough and
 * converted-on-demand playlists span the whole episode, live ones start at the
 * requested segment boundary. Opening the session up front reads that start
 * (and whether the video comes untouched); the player then loads the same,
 * already-running session.
 */
async function sessionDetails(url: string): Promise<SessionDetails> {
  const response = await fetch(url, { credentials: "same-origin" });
  if (!response.ok) {
    return { offset: null, passthroughCodec: null };
  }
  await response.text();
  const start = Number(response.headers.get("x-nanime-hls-start") ?? Number.NaN);
  return {
    offset: Number.isFinite(start) ? start : null,
    passthroughCodec: response.headers.get("x-nanime-hls-passthrough"),
  };
}

async function resolvedAttachment(options: ManagedHlsAttachment): Promise<HlsAttachment> {
  const { offset, passthroughCodec } = await sessionDetails(options.url);
  options.onPassthroughCodec?.(passthroughCodec);
  if (offset === null) {
    return options;
  }
  options.onTimelineOffset?.(offset);
  return { ...options, timelineOffset: offset };
}

async function releaseSafely(lease: HlsPlaybackLease): Promise<void> {
  try {
    await releaseHlsPlayback(lease);
  } catch {
    // Idle expiry is the fallback when the best-effort release cannot arrive.
  }
}

export function attachManagedHls(options: ManagedHlsAttachment, playerId: string): () => void {
  const lease: HlsPlaybackLease = { playerId, leaseId: crypto.randomUUID() };
  const lifecycle = attachmentLifecycle(() => {
    void releaseSafely(lease);
  });
  const leasedOptions = {
    ...options,
    url: leasedHlsUrl(options.url, lease),
    onError: (message: string, kind?: "media") => {
      if (lifecycle.active()) {
        options.onError(message, kind);
      }
    },
  };
  void (async (): Promise<void> => {
    try {
      const [module, attachment] = await Promise.all([
        import("./hlsPlayback.ts"),
        resolvedAttachment(leasedOptions),
      ]);
      if (lifecycle.active()) {
        lifecycle.attach(attachLoadedHls(module, attachment));
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
