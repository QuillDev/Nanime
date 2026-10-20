import type { QueryClient } from "@tanstack/react-query";
import type { SourceResult, SourceSetting, SourceShow, SourcesOverview } from "../sourcesApi.ts";

/** Fictional source plugins for `/preview/?state=admin-find*`; the preview searches "ferry". */
const covers = import.meta.glob<string>("./assets/cover*.jpg", { eager: true, query: "?url", import: "default" });
const cover = (number: number): string | null => covers[`./assets/cover${String(number)}.jpg`] ?? null;

const REPO = "https://plugins.example.org/anime/index.min.json";
export const PREVIEW_SOURCE = `${REPO}#101`;
export const PREVIEW_QUERY = "ferry";

const lantern = { id: PREVIEW_SOURCE, repoUrl: REPO, name: "Lantern Stream", lang: "en", version: "0.2.2", iconUrl: null, nsfw: false };
const kite = { id: `${REPO}#102`, repoUrl: REPO, name: "Willow Archive", lang: "en", version: "1.4.0", iconUrl: null, nsfw: false };

const overview: SourcesOverview = {
  sources: [{ ...lantern, version: "0.2.1" }, kite],
  repos: [{
    url: REPO,
    error: null,
    sources: [
      { ...lantern, installedVersion: "0.2.1" },
      { ...kite, installedVersion: "1.4.0" },
      { id: `${REPO}#103`, repoUrl: REPO, name: "Moth Harbor Subs", lang: "es", version: "0.9.0", iconUrl: null, nsfw: false, installedVersion: null },
    ],
  }],
};

const TITLES = [
  "Lantern Ferry Club", "Lantern Ferry Club 2nd Season", "Ferryman of the Paper Bay",
  "The Last Ferry Leaves at Dusk: A Very Long Subtitle That Keeps Going (Uncut Director's Edition)",
  "Ferry Tales", "Night Ferry Radio", "Moth Harbor Crossing", "Ferry Lights OVA",
];
const results: readonly SourceResult[] = TITLES.map((name, index) => ({ name, imageUrl: cover((index % 9) + 1), link: `/show/${String(index)}` }));

const show: SourceShow = {
  name: "Lantern Ferry Club",
  imageUrl: cover(1),
  description: "Every evening a small club of students rows paper lanterns out to the ferry that never docks. Nobody remembers who started the club, or why the ferry waits.",
  genres: ["Slice of Life", "Mystery", "Drama"],
  episodes: Array.from({ length: 12 }, (_, index) => ({ name: `Episode ${String(index + 1)}`, url: `/watch/${String(index + 1)}`, number: index + 1 })),
};

const settings: readonly SourceSetting[] = [
  { key: "audio", kind: "list", title: "Audio", summary: "", options: [{ label: "Subtitled", value: "sub" }, { label: "Dubbed", value: "dub" }], value: "sub" },
  { key: "quality", kind: "list", title: "Preferred quality", summary: "", options: ["1080p", "720p", "480p"].map((value) => ({ label: value, value })), value: "1080p" },
  { key: "hosts", kind: "multi", title: "Video hosts", summary: "", options: ["Vidplay", "Filemoon", "Mp4upload"].map((value) => ({ label: value, value })), value: ["Vidplay", "Filemoon"] },
  { key: "skip", kind: "toggle", title: "Skip recaps", summary: "", options: [], value: true },
];

export function seedFind(client: QueryClient): void {
  client.setQueryData(["sources"], overview);
  client.setQueryData(["source-search", PREVIEW_SOURCE, PREVIEW_QUERY], results);
  client.setQueryData(["source-show", PREVIEW_SOURCE, results[0]?.link], show);
  client.setQueryData(["source-settings", PREVIEW_SOURCE], settings);
  client.setQueryData(["source-settings", kite.id], settings.slice(0, 1));
}
