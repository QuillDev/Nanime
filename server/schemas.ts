import { t } from "elysia";

const array = t.Array;
const boolean = t.Boolean;
const composite = t.Composite;
const file = t.File;
const integer = t.Integer;
const nullValue = t.Null;
const number = t.Number;
const object = t.Object;
const optional = t.Optional;
const record = t.Record;
const string = t.String;
const union = t.Union;

const nullableString = union([string(), nullValue()]);
const nullableNumber = union([number(), nullValue()]);

export const authUserSchema = object({
  id: number(), username: string(), isAdmin: boolean(),
});
export const provisionedUserSchema = object({
  id: number(), username: string(), isAdmin: boolean(), passwordSet: boolean(),
});
export const mediaEntrySchema = object({
  rel: string(), name: string(), folder: string(), size: number(), direct: boolean(),
});
export const subtitleTrackSchema = object({
  index: number(), codec: string(), language: string(), label: string(),
});
export const playbackProgressSchema = object({
  rel: string(),
  position: number(),
  duration: number(),
  completed: boolean(),
  updatedAt: number(),
});

const tvmazeEpisodeSchema = object({
  id: number(),
  season: number(),
  number: nullableNumber,
  type: string(),
  title: string(),
  summary: nullableString,
  airDate: nullableString,
  thumbnail: nullableString,
});
const tvmazeMatchSchema = object({
  id: number(),
  name: string(),
  siteUrl: string(),
  premiered: nullableString,
  episodes: array(tvmazeEpisodeSchema),
});
const aniListTitleSchema = object({
  english: nullableString,
  romaji: string(),
  native: nullableString,
});
const aniListCoverSchema = object({
  extraLarge: nullableString,
  large: nullableString,
  color: nullableString,
});
const streamingEpisodeSchema = object({
  title: string(),
  thumbnail: nullableString,
  site: string(),
});
const optionalTvmazeSchema = optional(union([tvmazeMatchSchema, nullValue()]));
export const aniListMediaSchema = object({
  id: number(),
  idMal: nullableNumber,
  title: aniListTitleSchema,
  description: nullableString,
  coverImage: aniListCoverSchema,
  bannerImage: nullableString,
  episodes: nullableNumber,
  duration: nullableNumber,
  season: nullableString,
  seasonYear: nullableNumber,
  format: nullableString,
  status: nullableString,
  genres: array(string()),
  averageScore: nullableNumber,
  siteUrl: string(),
  streamingEpisodes: array(streamingEpisodeSchema),
  tvmaze: optionalTvmazeSchema,
  tvmazeCheckedAt: optional(number()),
});
export const torrentStatusSchema = object({
  hash: string(),
  name: string(),
  progress: number(),
  downloadSpeed: number(),
  eta: number(),
  completed: number(),
  size: number(),
  state: string(),
  addedOn: number(),
});
export const credentialsSchema = object({ username: string(), password: string() });

export const schema = {
  array,
  boolean,
  composite,
  file,
  integer,
  nullValue,
  number,
  object,
  optional,
  record,
  string,
  union,
};
