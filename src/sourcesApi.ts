import { api, unwrap } from "./api.ts";

/** Mangayomi-compatible source plugins: repositories, installed sources, search and episode downloads. */
export interface InstalledSourceView {
  readonly id: string;
  readonly repoUrl: string;
  readonly name: string;
  readonly lang: string;
  readonly version: string;
  readonly iconUrl: string | null;
  readonly nsfw: boolean;
}

export interface AvailableSourceView extends InstalledSourceView {
  readonly installedVersion: string | null;
}

export interface SourceRepoView {
  readonly url: string;
  readonly sources: readonly AvailableSourceView[];
  readonly error: string | null;
}

export interface SourcesOverview {
  readonly sources: readonly InstalledSourceView[];
  readonly repos: readonly SourceRepoView[];
}

export interface SourceResult {
  readonly name: string;
  readonly imageUrl: string | null;
  readonly link: string;
}

export interface SourceEpisode {
  readonly name: string;
  readonly url: string;
  readonly number: number;
}

export interface SourceShow {
  readonly name: string;
  readonly imageUrl: string | null;
  readonly description: string | null;
  readonly genres: readonly string[];
  readonly episodes: readonly SourceEpisode[];
}

export type SourceSettingValue = string | boolean | readonly string[] | null;

export interface SourceSetting {
  readonly key: string;
  readonly kind: "list" | "multi" | "toggle" | "text";
  readonly title: string;
  readonly summary: string;
  readonly options: readonly { readonly label: string; readonly value: string }[];
  readonly value: SourceSettingValue;
}

export async function fetchSources(signal: AbortSignal): Promise<SourcesOverview> {
  return unwrap(await api.api.sources.get({ query: {}, fetch: { signal } }), "Loading sources");
}

export async function searchSource(id: string, query: string, signal: AbortSignal): Promise<readonly SourceResult[]> {
  const found = unwrap(await api.api.sources.search.get({ query: { id, q: query }, fetch: { signal } }), "Searching");
  return found.results;
}

export async function fetchSourceShow(id: string, url: string, signal: AbortSignal): Promise<SourceShow> {
  return unwrap(await api.api.sources.detail.get({ query: { id, url }, fetch: { signal } }), "Listing episodes");
}

export async function fetchSourceSettings(id: string, signal: AbortSignal): Promise<readonly SourceSetting[]> {
  return unwrap(await api.api.sources.settings.get({ query: { id }, fetch: { signal } }), "Loading settings");
}

export async function addSourceRepo(url: string): Promise<void> {
  unwrap(await api.api.sources.repos.post({ url }), "Adding repository");
}

export async function removeSourceRepo(url: string): Promise<void> {
  unwrap(await api.api.sources.repos.remove.post({ url }), "Removing repository");
}

export async function installSource(id: string): Promise<void> {
  unwrap(await api.api.sources.install.post({ id }), "Installing source");
}

export async function uninstallSource(id: string): Promise<void> {
  unwrap(await api.api.sources.uninstall.post({ id }), "Removing source");
}

export async function saveSourceSetting(id: string, key: string, value: SourceSettingValue): Promise<void> {
  const sent = typeof value === "object" && value !== null ? [...value] : value;
  unwrap(await api.api.sources.settings.post({ id, key, value: sent }), "Saving setting");
}

/** Queues episodes into one show folder; each downloads through the shared download list. */
export async function downloadEpisodes(id: string, showFolder: string, episodes: readonly SourceEpisode[]): Promise<number> {
  const queued = unwrap(await api.api.sources.download.post({
    id, showFolder, episodes: episodes.map(({ url, number }) => ({ url, number })),
  }), "Downloading episodes");
  return queued.added;
}
