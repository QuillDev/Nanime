import { link, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { assertPublicUrl } from "./sourceHttp.ts";
import type { SubtitleLink } from "./downloadStore.ts";

/**
 * Saves a source episode's separate subtitle tracks next to its video as
 * `<episode>.<language>.srt`, the sidecar form Nanime's player reads (sites
 * usually serve WebVTT, which ffmpeg converts). A track that fails is skipped:
 * the episode still lands.
 */
const MAX_SUBTITLE_BYTES = 5 * 1024 * 1024;
const LANGUAGES = new Map(Object.entries({
  english: "en", japanese: "ja", spanish: "es", portuguese: "pt", french: "fr", german: "de", italian: "it",
  arabic: "ar", russian: "ru", indonesian: "id", thai: "th", vietnamese: "vi", korean: "ko", chinese: "zh",
  turkish: "tr", polish: "pl", hindi: "hi", malay: "ms", dutch: "nl",
}));

/** A sidecar suffix for a track label: the language code when the label names one, else the label itself. */
function subtitleSuffix(label: string, index: number): string {
  const lower = label.toLowerCase();
  const known = [...LANGUAGES].find(([name]) => lower.includes(name))?.[1];
  const slug = lower.replaceAll(/[^a-z0-9]+/gu, "-").replaceAll(/^-|-$/gu, "");
  return known ?? (slug === "" ? `track-${String(index + 1)}` : slug.slice(0, 40));
}

async function convert(input: string, output: string): Promise<boolean> {
  const process = Bun.spawn(["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", input, "-c:s", "srt", "-f", "srt", output], {
    stdin: "ignore", stdout: "ignore", stderr: "ignore",
  });
  return await process.exited === 0;
}

interface SubtitleSave {
  readonly track: SubtitleLink;
  readonly index: number;
  readonly headers: Readonly<Record<string, string>>;
  /** Where temporary files go (Nanime's private download folder). */
  readonly scratch: string;
  /** The episode's path without its extension. */
  readonly stem: string;
}

async function saveOne(save: SubtitleSave): Promise<string | null> {
  const url = new URL(save.track.url);
  await assertPublicUrl(url);
  const response = await fetch(url, { headers: save.headers, signal: AbortSignal.timeout(30_000) });
  const bytes = response.ok ? await response.bytes() : null;
  if (bytes === null || bytes.byteLength > MAX_SUBTITLE_BYTES) {
    return null;
  }
  const input = join(save.scratch, `${crypto.randomUUID()}.subtitle`);
  const output = `${input}.srt`;
  try {
    await writeFile(input, bytes, { mode: 0o600 });
    if (!await convert(input, output)) {
      return null;
    }
    const destination = `${save.stem}.${subtitleSuffix(save.track.label, save.index)}.srt`;
    await link(output, destination);
    return destination;
  } finally {
    await Promise.all([unlink(input).catch(() => undefined), unlink(output).catch(() => undefined)]);
  }
}

/** Saves every track it can; returns the paths written. */
export async function saveSubtitles(tracks: readonly SubtitleLink[], options: Omit<SubtitleSave, "track" | "index">): Promise<readonly string[]> {
  const saved = await Promise.all(tracks.map((track, index) => saveOne({ ...options, track, index }).catch(() => null)));
  return saved.filter((path) => path !== null);
}
