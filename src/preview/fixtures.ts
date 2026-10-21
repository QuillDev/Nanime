import type { AniListMedia, AuthUser, MediaEntry, PlaybackProgressMap, TranscodeJob } from "../types.ts";
import type { ShowGroup } from "../lib/library.ts";
import type { PlaybackReadiness, PlaybackReadinessBatch } from "../libraryApi.ts";

// The preview turns on TV behavior the same way the app does (`NanimeTV/` in the user agent).
export { installTvRemote } from "../lib/tvRemote.ts";

// Fictional fixtures by default. A real-show snapshot from
// server/capturePreviewSnapshot.ts (gitignored src/preview/snapshot/) replaces them when present.
const fictionalThumbnails = import.meta.glob<string>("./assets/ep*.jpg", { eager: true, query: "?url", import: "default" });
const [fictionalBanner = null] = Object.values(import.meta.glob<string>("./assets/banner.jpg", { eager: true, query: "?url", import: "default" }));
const snapshotImages = import.meta.glob<string>("./snapshot/*.jpg", { eager: true, query: "?url", import: "default" });
const snapshotFiles = import.meta.glob<PreviewSnapshot>("./snapshot/snapshot.json", { eager: true, import: "default" });

interface PreviewSnapshot {
  readonly key: string;
  readonly show: string;
  readonly media: AniListMedia;
  readonly episodes: readonly { readonly entry: MediaEntry; readonly thumbnail: string; readonly title: string }[];
}

export const previewUser: AuthUser = { id: 1, username: "preview", isAdmin: true, preferredAudioLanguage: null };

const SHOW = "Lantern Street Detectives";
const titles = [
  "The Case of the Paper Moon", "A Ledger in the Rain", "Midnight at the Ferry", "Two Keys, One Lock",
  "The Quiet Apprentice", "Smoke over the Canal", "Lanterns Out", "The Clockmaker's Alibi",
  "Night Market Nocturne", "A Map Without Names", "The Last Tram", "Lantern Street",
];

function fictionalSnapshot(): PreviewSnapshot {
  const episodes = titles.map((title, index) => {
    const number = String(index + 1).padStart(2, "0");
    return {
      entry: { rel: `${SHOW}/${SHOW} - S01E${number}.mkv`, name: `${SHOW} - S01E${number}.mkv`, folder: SHOW, size: 1, direct: false },
      thumbnail: fictionalThumbnails[`./assets/ep${number}.jpg`] ?? "",
      title: `Episode ${String(index + 1)} - ${title}`,
    };
  });
  const media: AniListMedia = {
    provider: "anilist", id: 1, anilistId: null, idMal: null,
    title: { english: SHOW, romaji: "Rantan-dōri Tantei-dan", native: null },
    description: "A trio of night-shift detectives solves small mysteries in a canal city where every street lamp keeps a secret. Fictional preview data.",
    coverImage: { extraLarge: null, large: null, color: null },
    bannerImage: fictionalBanner, episodes: episodes.length, duration: 24, season: "SPRING", seasonYear: 2026,
    startDate: null, format: "TV", status: "FINISHED", genres: ["Mystery", "Slice of Life", "Comedy"],
    averageScore: 81, siteUrl: "https://anilist.co", streamingEpisodes: [],
  };
  return { key: `show:${SHOW}`, show: SHOW, media, episodes };
}

/** Local snapshot images resolve to bundled URLs; the preview never requests the real library. */
function localSnapshot(snapshot: PreviewSnapshot): PreviewSnapshot {
  const banner = snapshotImages["./snapshot/banner.jpg"] ?? null;
  return {
    ...snapshot,
    media: { ...snapshot.media, anilistId: null, bannerImage: banner },
    episodes: snapshot.episodes.map((episode) => ({ ...episode, thumbnail: snapshotImages[`./snapshot/${episode.thumbnail}`] ?? "" })),
  };
}

const [snapshotFile] = Object.values(snapshotFiles);
const snapshot = snapshotFile === undefined ? fictionalSnapshot() : localSnapshot(snapshotFile);
const entries: readonly MediaEntry[] = snapshot.episodes.map((episode) => episode.entry);

export const previewMedia: AniListMedia = {
  ...snapshot.media,
  streamingEpisodes: snapshot.episodes.map((episode) => ({ title: episode.title, thumbnail: episode.thumbnail, site: "preview" })),
};

export const previewShow: ShowGroup = {
  name: snapshot.media.title.english ?? snapshot.show,
  sourceNames: [snapshot.show],
  seasons: [{ name: snapshot.show, sourceShow: snapshot.show, entries }],
  entries,
};

export const previewMetadata = { [snapshot.key]: previewMedia };

export type PreviewState = "loading" | "needs" | "partial" | "transcoding" | "ready";

function readiness(index: number, state: PreviewState): PlaybackReadiness {
  const path = entries[index]?.rel ?? "";
  if (state === "ready" || (state !== "needs" && index < 5)) {
    return { path, ready: true, transcode: { status: "complete", progress: 1, remainingSeconds: null } };
  }
  if (state === "transcoding" && (index === 5 || index === 6)) {
    const progress = index === 5 ? 0.71 : 0.24;
    return { path, ready: false, transcode: { status: "processing", progress, remainingSeconds: index === 5 ? 720 : 1860 } };
  }
  if (state === "transcoding") {
    return { path, ready: false, transcode: { status: "queued", progress: 0, remainingSeconds: null } };
  }
  return { path, ready: false, transcode: null };
}

export function previewReadiness(state: PreviewState): PlaybackReadinessBatch {
  return { workers: 2, items: entries.map((_, index) => readiness(index, state)) };
}

export function previewJobs(state: PreviewState): readonly TranscodeJob[] {
  return previewReadiness(state).items.flatMap((item, index) => {
    const job = item.transcode;
    if (job === null || (job.status !== "processing" && job.status !== "queued")) {
      return [];
    }
    return [{
      id: `job-${String(index)}`, sourcePath: item.path, preset: "compatibility", status: job.status,
      inputSize: 1, outputSize: null, progress: job.progress, speed: 0, startedAt: null, error: null,
      originalDeleted: false, createdAt: index, updatedAt: index,
    }];
  });
}

export function previewProgress(state: PreviewState): PlaybackProgressMap {
  const first = entries[0]?.rel;
  const second = entries[1]?.rel;
  if (state !== "ready" || first === undefined || second === undefined) {
    return {};
  }
  return {
    [first]: { rel: first, position: 1440, duration: 1440, completed: true, updatedAt: 1, dismissedAt: null },
    [second]: { rel: second, position: 600, duration: 1440, completed: false, updatedAt: 2, dismissedAt: null },
  };
}
