export interface OAuthConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
  readonly tokenKey: Uint8Array;
  readonly appOrigin: string;
}

export interface OAuthStateRow {
  readonly user_id: number | null;
  readonly expires_at: number;
}

export interface AniListAccountRow {
  readonly user_id: number;
  readonly anilist_id: number;
  readonly anilist_name: string;
  readonly avatar_url: string | null;
  readonly encrypted_token: string;
  readonly token_expires_at: number;
}

export interface SyncRow {
  readonly progress: number;
  readonly status: string;
}

export interface ViewerData {
  readonly Viewer: {
    readonly id: number;
    readonly name: string;
    readonly avatar: { readonly large: string | null };
  };
}

export interface AniListListEntry {
  readonly id: number;
  readonly mediaId: number;
  readonly status: string;
  readonly progress: number;
  readonly score: number;
}

export interface MediaListData {
  readonly Media: {
    readonly mediaListEntry: AniListListEntry | null;
  } | null;
}

export interface SaveMediaListData {
  readonly SaveMediaListEntry: AniListListEntry;
}

export interface DeleteMediaListData {
  readonly DeleteMediaListEntry: { readonly deleted: boolean };
}

export interface TokenResponse {
  readonly access_token?: unknown;
  readonly expires_in?: unknown;
}

export interface AniListPlaybackTarget {
  readonly mediaId: number;
  readonly episode: number;
  readonly totalEpisodes: number | null;
  readonly completed: boolean;
}

export interface ListUpdate {
  readonly status?: string;
  readonly progress?: number;
  readonly score?: number;
}
