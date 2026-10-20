export type MetadataProvider = "anilist";

export interface MediaDate {
  readonly year: number | null;
  readonly month: number | null;
  readonly day: number | null;
}

export interface AnimeMetadata {
  readonly provider: MetadataProvider;
  readonly id: number;
  readonly anilistId: number | null;
  readonly idMal: number | null;
  readonly title: {
    readonly english: string | null;
    readonly romaji: string;
    readonly native: string | null;
  };
  readonly description: string | null;
  readonly coverImage: {
    readonly extraLarge: string | null;
    readonly large: string | null;
    readonly color: string | null;
  };
  readonly bannerImage: string | null;
  readonly episodes: number | null;
  readonly duration: number | null;
  readonly season: string | null;
  readonly seasonYear: number | null;
  readonly startDate: MediaDate | null;
  readonly format: string | null;
  readonly status: string | null;
  readonly genres: readonly string[];
  readonly averageScore: number | null;
  readonly siteUrl: string;
  readonly streamingEpisodes: readonly {
    readonly title: string;
    readonly thumbnail: string | null;
    readonly site: string;
  }[];
}

export type MetadataStore = Record<string, AnimeMetadata>;
