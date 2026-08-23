export interface MediaEntry {
  readonly rel: string;
  readonly name: string;
  readonly folder: string;
  readonly size: number;
  readonly direct: boolean;
}

export interface SubtitleTrack {
  readonly index: number;
  readonly codec: string;
  readonly language: string;
  readonly label: string;
}

export interface AniListTitle {
  readonly english: string | null;
  readonly romaji: string;
  readonly native: string | null;
}

export interface AniListCoverImage {
  readonly extraLarge: string | null;
  readonly large: string | null;
  readonly color: string | null;
}

export interface AniListEpisode {
  readonly title: string;
  readonly thumbnail: string | null;
  readonly site: string;
}

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

export interface AniListMedia {
  readonly id: number;
  readonly idMal: number | null;
  readonly title: AniListTitle;
  readonly description: string | null;
  readonly coverImage: AniListCoverImage;
  readonly bannerImage: string | null;
  readonly episodes: number | null;
  readonly duration: number | null;
  readonly season: string | null;
  readonly seasonYear: number | null;
  readonly format: string | null;
  readonly status: string | null;
  readonly genres: readonly string[];
  readonly averageScore: number | null;
  readonly siteUrl: string;
  readonly streamingEpisodes: readonly AniListEpisode[];
  readonly tvmaze?: TvmazeMatch | null;
  readonly tvmazeCheckedAt?: number;
}

export type ShowMetadata = Readonly<Record<string, AniListMedia>>;

export interface PlaybackProgress {
  readonly rel: string;
  readonly position: number;
  readonly duration: number;
  readonly completed: boolean;
  readonly updatedAt: number;
}

export interface AniListPlaybackTarget {
  readonly mediaId: number;
  readonly episode: number;
  readonly totalEpisodes: number | null;
}

export type PlaybackProgressMap = Readonly<Record<string, PlaybackProgress>>;

export interface AuthUser {
  readonly id: number;
  readonly username: string;
  readonly isAdmin: boolean;
}

export interface AniListAuthConfig {
  readonly enabled: boolean;
}

export interface AniListAccountStatus {
  readonly configured: boolean;
  readonly connected: boolean;
  readonly account: {
    readonly id: number;
    readonly name: string;
    readonly avatarUrl: string | null;
    readonly expiresAt: number;
  } | null;
}

export type AniListWatchStatus =
  | "NONE"
  | "CURRENT"
  | "PLANNING"
  | "COMPLETED"
  | "DROPPED"
  | "PAUSED"
  | "REPEATING";

export interface AniListListEntry {
  readonly id: number;
  readonly mediaId: number;
  readonly status: string;
  readonly progress: number;
  readonly score: number;
}

export interface ProvisionedUser extends AuthUser {
  readonly passwordSet: boolean;
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
