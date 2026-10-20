import type { AniListMedia, MediaEntry } from "../types.ts";
import { numberedName } from "../../shared/numberedName.ts";
import { pathParts } from "../../shared/folderIdentity.ts";
import { episodeMetadata, episodeNumber, mediaTitle } from "./anilist.ts";
import type { SeasonGroup } from "./library.ts";

export interface NameChange {
  readonly from: string;
  readonly to: string;
}

export interface EpisodeRename extends NameChange {
  readonly rel: string;
}

/**
 * Renames that organize one season: its episodes become `NNN. Title.ext` and
 * its folder `NNN. Season Title`. A release folder at the library's top level
 * moves into `showFolder` (the show's name as Nanime already shows it).
 */
export interface SeasonRenamePlan {
  readonly folder: string;
  readonly showFolder: string | null;
  readonly seasonFolder: NameChange | null;
  readonly episodes: readonly EpisodeRename[];
  /** New names more than one episode would take. */
  readonly conflicts: readonly string[];
}

export interface SeasonRenameInput {
  readonly season: SeasonGroup;
  /** The season's match, or the show's when the season has none. */
  readonly media: AniListMedia | undefined;
  readonly showMedia: AniListMedia | undefined;
  readonly seasonNumber: number;
  /** Season folder title when there's no match. */
  readonly fallbackTitle: string;
}

function extension(name: string): string {
  return /\.[^.]+$/u.exec(name)?.[0] ?? "";
}

/** `NNN. Title.ext` for an episode, or null when the title is unusable. */
export function episodeFileName(entry: MediaEntry, number: number, title: string): string | null {
  const name = numberedName(number, title);
  return name === null ? null : `${name}${extension(entry.name)}`;
}

function episodeRenames(input: SeasonRenameInput): readonly EpisodeRename[] {
  const context = { showMedia: input.showMedia, season: input.seasonNumber };
  return input.season.entries.flatMap((entry, index) => {
    const number = episodeNumber(entry) ?? index + 1;
    const title = episodeMetadata(entry, input.media, context)?.title ?? `Episode ${String(number)}`;
    const to = episodeFileName(entry, number, title);
    return to === null || to === entry.name ? [] : [{ rel: entry.rel, from: entry.name, to }];
  });
}

function conflicts(input: SeasonRenameInput, episodes: readonly EpisodeRename[]): readonly string[] {
  const renamed = new Map(episodes.map((episode) => [episode.rel, episode.to]));
  const names = input.season.entries.map((entry) => renamed.get(entry.rel) ?? entry.name);
  return [...new Set(names.filter((name, index) => names.indexOf(name) !== index))];
}

interface FolderPlan {
  readonly showFolder: string | null;
  readonly seasonFolder: NameChange | null;
}

function folderPlan(input: SeasonRenameInput, folder: string): FolderPlan {
  const parts = pathParts(folder);
  const current = parts.at(-1) ?? folder;
  const title = input.media === undefined ? input.fallbackTitle : mediaTitle(input.media);
  const to = numberedName(input.seasonNumber, title);
  // A plain top-level folder is already the show; its episodes stay where they are.
  if (to === null || (parts.length === 1 && input.season.sourceShow === current)) {
    return { showFolder: null, seasonFolder: null };
  }
  return {
    showFolder: parts.length === 1 ? input.season.sourceShow : null,
    seasonFolder: to === current ? null : { from: current, to },
  };
}

/** Null when the season's episodes sit in more than one folder. */
export function seasonRenamePlan(input: SeasonRenameInput): SeasonRenamePlan | null {
  const folders = [...new Set(input.season.entries.map((entry) => entry.folder))];
  const [folder] = folders;
  if (folder === undefined || folders.length > 1) {
    return null;
  }
  const episodes = episodeRenames(input);
  return { folder, ...folderPlan(input, folder), episodes, conflicts: conflicts(input, episodes) };
}

export function planChanges(plan: SeasonRenamePlan): boolean {
  return plan.showFolder !== null || plan.seasonFolder !== null || plan.episodes.length > 0;
}
