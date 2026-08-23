import type {
  AniListMedia,
  AniListPlaybackTarget,
  MediaEntry,
  ShowMetadata,
} from "../types.ts";
import { episodeNumber } from "./anilist.ts";

export interface SeasonGroup {
  readonly name: string;
  readonly sourceShow: string;
  readonly entries: readonly MediaEntry[];
}

export interface ShowGroup {
  readonly name: string;
  readonly sourceNames: readonly string[];
  readonly seasons: readonly SeasonGroup[];
  readonly entries: readonly MediaEntry[];
}

const nameCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

export function showMetadataKey(show: string): string {
  return `show:${show}`;
}

export function seasonMetadataKey(show: string, season: string): string {
  return `season:${show} / ${season}`;
}

export function seasonMetadata(
  metadata: ShowMetadata,
  show: string,
  season: string,
): AniListMedia | undefined {
  return metadata[seasonMetadataKey(show, season)] ?? metadata[`${show} / ${season}`];
}

export function seasonNumber(
  season: SeasonGroup,
  media: AniListMedia | undefined,
): number {
  const linkedTitle = media?.title.english ?? media?.title.romaji ?? "";
  const match = /(?:Season|S)\s*0*(?<number>\d+)/iu.exec(season.name)
    ?? /(?:Season|S)\s*0*(?<number>\d+)/iu.exec(season.sourceShow)
    ?? /(?:Season|S)\s*0*(?<number>\d+)/iu.exec(linkedTitle);
  const number = match?.groups?.["number"];
  return number === undefined ? 1 : Number(number);
}

function pathParts(folder: string): readonly string[] {
  return folder.split("/").filter((part) => part !== "");
}

export function sourceShowFolders(entries: readonly MediaEntry[]): readonly string[] {
  return [...new Set(entries.flatMap((entry) => pathParts(entry.folder).slice(0, 1)))]
    .toSorted((a, b) => nameCollator.compare(a, b));
}

interface FolderIdentity {
  readonly show: string;
  readonly season: string;
}

function releaseTitle(folder: string, seasonIndex: number): string {
  const beforeSeason = folder.slice(0, seasonIndex).trim();
  const alias = /\((?<title>[^()]*)\)$/u.exec(beforeSeason)?.groups?.["title"];
  return alias?.trim() || beforeSeason.replace(/^\[[^\]]+\]\s*/u, "");
}

function folderIdentity(entry: MediaEntry): FolderIdentity {
  const parts = pathParts(entry.folder);
  const top = parts[0] ?? "Unsorted";
  const nested = parts.slice(1).join(" / ");
  if (nested !== "") {
    return { show: top, season: nested };
  }
  const match = /\(Season\s+0*(?<number>\d+)\)/iu.exec(top);
  const number = match?.groups?.["number"];
  if (match === null || number === undefined) {
    return { show: top, season: "Episodes" };
  }
  return {
    show: releaseTitle(top, match.index),
    season: `Season ${String(Number(number))}`,
  };
}

function showName(entry: MediaEntry): string {
  return folderIdentity(entry).show;
}

function seasonName(entry: MediaEntry): string {
  return folderIdentity(entry).season;
}

function groupSeasons(entries: readonly MediaEntry[]): readonly SeasonGroup[] {
  const groups = new Map<string, {
    readonly name: string;
    readonly sourceShow: string;
    readonly entries: MediaEntry[];
  }>();
  for (const entry of entries) {
    const sourceShow = showName(entry);
    const name = seasonName(entry);
    const key = `${sourceShow}\0${name}`;
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, { name, sourceShow, entries: [entry] });
    } else {
      group.entries.push(entry);
    }
  }
  return [...groups.values()]
    .map((group) => ({
      name: group.name,
      sourceShow: group.sourceShow,
      entries: group.entries.toSorted((a, b) => nameCollator.compare(a.name, b.name)),
    }))
    .toSorted((a, b) => nameCollator.compare(a.name, b.name));
}

function mergeSeasons(
  seasons: readonly SeasonGroup[],
  metadata: ShowMetadata,
): readonly SeasonGroup[] {
  const merged = new Map<string, SeasonGroup>();
  for (const season of seasons) {
    const media = seasonMetadata(metadata, season.sourceShow, season.name);
    const key = media === undefined
      ? `local:${season.sourceShow}/${season.name}`
      : `anilist:${String(media.id)}`;
    const existing = merged.get(key);
    merged.set(key, existing === undefined ? season : {
      ...existing,
      entries: [...existing.entries, ...season.entries]
        .toSorted((a, b) => nameCollator.compare(a.name, b.name)),
    });
  }
  return [...merged.values()].toSorted((a, b) => {
    const order = seasonOrder(a, metadata) - seasonOrder(b, metadata);
    return order === 0 ? nameCollator.compare(a.name, b.name) : order;
  });
}

function seasonOrder(season: SeasonGroup, metadata: ShowMetadata): number {
  const linked = seasonMetadata(metadata, season.sourceShow, season.name);
  const title = linked?.title.english ?? linked?.title.romaji ?? "";
  const match = /(?:Season|S)\s*0*(?<number>\d+)/iu.exec(
    `${season.name} ${season.sourceShow} ${title}`,
  );
  const number = match?.groups?.["number"];
  return number === undefined ? Number.POSITIVE_INFINITY : Number(number);
}

export function groupShows(
  entries: readonly MediaEntry[],
  metadata: ShowMetadata = {},
): readonly ShowGroup[] {
  return mergeShows(localShowGroups(entries), metadata);
}

export function aniListPlaybackTarget(
  entries: readonly MediaEntry[] | undefined,
  selected: MediaEntry | null,
  metadata: ShowMetadata,
): AniListPlaybackTarget | null {
  if (entries === undefined || selected === null) {
    return null;
  }
  const show = groupShows(entries, metadata).find((candidate) => (
    candidate.entries.some((entry) => entry.rel === selected.rel)
  ));
  const season = show?.seasons.find((candidate) => (
    candidate.entries.some((entry) => entry.rel === selected.rel)
  ));
  const number = episodeNumber(selected);
  if (season === undefined || number === null) {
    return null;
  }
  const media = seasonMetadata(metadata, season.sourceShow, season.name) ??
    metadata[showMetadataKey(season.sourceShow)];
  return media === undefined
    ? null
    : { mediaId: media.id, episode: number, totalEpisodes: media.episodes };
}

function localShowGroups(entries: readonly MediaEntry[]): readonly ShowGroup[] {
  const groups = new Map<string, MediaEntry[]>();
  for (const entry of entries) {
    const name = showName(entry);
    const group = groups.get(name);
    if (group === undefined) {
      groups.set(name, [entry]);
    } else {
      group.push(entry);
    }
  }
  return [...groups.entries()].map(([name, items]) => ({
    name,
    sourceNames: [name],
    seasons: groupSeasons(items),
    entries: items,
  }));
}

function mergeShows(
  localShows: readonly ShowGroup[],
  metadata: ShowMetadata,
): readonly ShowGroup[] {
  const merged = new Map<string, ShowGroup>();
  for (const show of localShows) {
    const media = metadata[showMetadataKey(show.name)];
    const key = media === undefined ? `local:${show.name}` : `anilist:${String(media.id)}`;
    const existing = merged.get(key);
    merged.set(key, existing === undefined ? show : {
      ...existing,
      sourceNames: [...existing.sourceNames, show.name],
      seasons: mergeSeasons([...existing.seasons, ...show.seasons], metadata),
      entries: [...existing.entries, ...show.entries],
    });
  }
  return [...merged.values()]
    .toSorted((a, b) => nameCollator.compare(a.name, b.name));
}

export function nextEpisode(
  entries: readonly MediaEntry[],
  currentRel: string,
  metadata: ShowMetadata = {},
): MediaEntry | null {
  const show = groupShows(entries, metadata).find((candidate) => (
    candidate.entries.some((entry) => entry.rel === currentRel)
  ));
  if (show === undefined) {
    return null;
  }
  const ordered = show.seasons.flatMap((season) => season.entries);
  const currentIndex = ordered.findIndex((entry) => entry.rel === currentRel);
  return ordered[currentIndex + 1] ?? null;
}

export function previousEpisode(
  entries: readonly MediaEntry[],
  currentRel: string,
  metadata: ShowMetadata = {},
): MediaEntry | null {
  const show = groupShows(entries, metadata).find((candidate) => (
    candidate.entries.some((entry) => entry.rel === currentRel)
  ));
  if (show === undefined) {
    return null;
  }
  const ordered = show.seasons.flatMap((season) => season.entries);
  const currentIndex = ordered.findIndex((entry) => entry.rel === currentRel);
  return currentIndex > 0 ? ordered[currentIndex - 1] ?? null : null;
}
