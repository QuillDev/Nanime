export interface MediaEntry {
  readonly rel: string;
  readonly name: string;
  readonly folder: string;
  readonly size: number;
  readonly direct: boolean;
}

export interface PlaybackProgress {
  readonly rel: string;
  readonly position: number;
  readonly duration: number;
  readonly completed: boolean;
  readonly updatedAt: number;
  readonly dismissedAt: number | null;
}

export interface AuthUser {
  readonly id: number;
  readonly username: string;
  readonly isAdmin: boolean;
}

export interface AniListListEntry {
  readonly id: number;
  readonly mediaId: number;
  readonly status: string;
  readonly progress: number;
  readonly score: number;
}

export interface TorrentStatus {
  readonly hash: string;
  readonly name: string;
  readonly progress: number;
  readonly downloadSpeed: number;
  readonly eta: number;
  readonly completed: number;
  readonly size: number;
  readonly state: string;
  readonly addedOn: number;
}

export type TranscodePreset = "space-saver" | "compatibility";

export interface TvmazeEpisode {
  readonly id: number;
  readonly season: number;
  readonly number: number | null;
  readonly type: string;
  readonly title: string;
  readonly summary: string | null;
  readonly airDate: string | null;
  readonly thumbnail: string | null;
}

export interface TvmazeMatch {
  readonly id: number;
  readonly name: string;
  readonly siteUrl: string;
  readonly premiered: string | null;
  readonly episodes: readonly TvmazeEpisode[];
}

export interface NyaaSearchResult {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly size: string;
  readonly seeders: number;
  readonly leechers: number;
  readonly downloads: number;
  readonly publishedAt: string;
  readonly trusted: boolean;
  readonly remake: boolean;
  readonly detailsUrl: string;
  readonly magnet: string;
}
