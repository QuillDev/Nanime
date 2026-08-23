interface ProbeSubtitleStream {
  readonly index?: unknown;
  readonly codec_name?: unknown;
  readonly tags?: {
    readonly language?: unknown;
    readonly title?: unknown;
  };
}

interface ProbeResult {
  readonly streams?: readonly ProbeSubtitleStream[];
}

export interface SubtitleTrack {
  readonly index: number;
  readonly codec: string;
  readonly language: string;
  readonly label: string;
}

const TEXT_SUBTITLE_CODECS = new Set([
  "ass",
  "ssa",
  "subrip",
  "webvtt",
  "mov_text",
  "text",
]);
const trackCache = new Map<string, Promise<readonly SubtitleTrack[]>>();
const subtitleCache = new Map<string, Promise<string | null>>();

function parseProbeResult(text: string): ProbeResult {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null ? value as ProbeResult : {};
  } catch {
    return {};
  }
}

function subtitleTrack(stream: ProbeSubtitleStream): SubtitleTrack | null {
  if (typeof stream.index !== "number" || typeof stream.codec_name !== "string") {
    return null;
  }
  if (!TEXT_SUBTITLE_CODECS.has(stream.codec_name)) {
    return null;
  }
  const language = typeof stream.tags?.language === "string" ? stream.tags.language : "und";
  const label = typeof stream.tags?.title === "string"
    ? stream.tags.title
    : `${language.toUpperCase()} subtitles`;
  return { index: stream.index, codec: stream.codec_name, language, label };
}

async function probeSubtitleTracks(abs: string): Promise<readonly SubtitleTrack[]> {
  const proc = Bun.spawn([
    "ffprobe", "-v", "error", "-select_streams", "s",
    "-show_entries", "stream=index,codec_name:stream_tags=language,title",
    "-of", "json", abs,
  ], { stdout: "pipe", stderr: "ignore" });
  const [text, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    proc.exited,
  ]);
  return exitCode === 0
    ? (parseProbeResult(text).streams ?? []).flatMap((stream) => {
        const track = subtitleTrack(stream);
        return track === null ? [] : [track];
      })
    : [];
}

export function subtitleTracks(abs: string): Promise<readonly SubtitleTrack[]> {
  const pending = trackCache.get(abs) ?? probeSubtitleTracks(abs);
  trackCache.set(abs, pending);
  return pending;
}

export async function subtitleTracksResponse(abs: string): Promise<Response> {
  return Response.json(await subtitleTracks(abs));
}

async function convertSubtitle(abs: string, index: number): Promise<string | null> {
  const proc = Bun.spawn([
    "ffmpeg", "-hide_banner", "-loglevel", "error", "-i", abs,
    "-map", `0:${String(index)}`, "-f", "webvtt", "pipe:1",
  ], { stdout: "pipe", stderr: "ignore" });
  const text = await new Response(proc.stdout).text();
  return await proc.exited === 0 && text.startsWith("WEBVTT") ? text : null;
}

export async function subtitleResponse(abs: string, index: number): Promise<Response> {
  const tracks = await subtitleTracks(abs);
  if (!tracks.some((track) => track.index === index)) {
    return new Response("Subtitle track not found", { status: 404 });
  }
  const key = `${abs}:${String(index)}`;
  const pending = subtitleCache.get(key) ?? convertSubtitle(abs, index);
  subtitleCache.set(key, pending);
  const text = await pending;
  if (text === null) {
    subtitleCache.delete(key);
    return new Response("Subtitle conversion failed", { status: 500 });
  }
  return new Response(text, {
    headers: {
      "content-type": "text/vtt; charset=utf-8",
      "cache-control": "private, max-age=604800",
    },
  });
}
