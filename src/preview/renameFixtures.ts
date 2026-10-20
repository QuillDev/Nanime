import type { MediaEntry } from "../types.ts";
import type { ShowGroup } from "../lib/library.ts";
import type { PlaybackReadinessBatch } from "../libraryApi.ts";
import { previewMedia, previewShow } from "./fixtures.ts";

// A raw release folder (the worst-case name) and the same season once organized.
const SHOW = previewShow.sourceNames[0] ?? previewShow.name;
const RELEASE = `[Judas] ${SHOW} (Season 02) [1080p][HEVC x265 10bit][Dual-Audio][Multi-Subs]`;
const ORGANIZED = `${SHOW}/002. ${previewMedia.title.english ?? SHOW}`;

function episodeTitle(index: number): string {
  return previewMedia.streamingEpisodes[index]?.title.replace(/^Episode\s+\d+\s*-\s*/u, "") ?? `Episode ${String(index + 1)}`;
}

function showWith(folder: string, season: string, name: (index: number) => string): ShowGroup {
  const entries: readonly MediaEntry[] = previewShow.entries.map((entry, index) => ({
    ...entry, rel: `${folder}/${name(index)}`, name: name(index), folder,
  }));
  return { ...previewShow, seasons: [{ name: season, sourceShow: SHOW, entries }], entries };
}

export const releaseShow = showWith(RELEASE, "Season 2", (index) => `[Judas] ${SHOW} - S02E${String(index + 1).padStart(2, "0")}v2.mkv`);

export const organizedShow = showWith(ORGANIZED, ORGANIZED.split("/")[1] ?? "", (index) => `${String(index + 1).padStart(3, "0")}. ${episodeTitle(index)}.mkv`);

/** The release folder for the rename dialogs, the organized season for "organized". */
export function renameStateShow(state: string): ShowGroup | null {
  if (state === "rename-episodes" || state === "rename-episode") {
    return releaseShow;
  }
  return state === "organized" ? organizedShow : null;
}

export function readyReadiness(show: ShowGroup): PlaybackReadinessBatch {
  return { workers: 2, items: show.entries.map((entry) => ({ path: entry.rel, ready: true, transcode: null })) };
}
