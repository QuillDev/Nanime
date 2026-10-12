import { t } from "elysia";
import { fileMovementSchema, fileOperationKindSchema } from "./libraryFilesSchemas.ts";

const array = t.Array;
const boolean = t.Boolean;
const composite = t.Composite;
const file = t.File;
const integer = t.Integer;
const literal = t.Literal;
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
  preferredAudioLanguage: union([literal("en"), literal("ja"), nullValue()]),
});
export const aniListAuthConfigSchema = object({ enabled: boolean() });
const aniListAccountDetailsSchema = object({
  id: number(),
  name: string(),
  avatarUrl: nullableString,
  expiresAt: number(),
});
export const aniListAccountSchema = object({
  configured: boolean(),
  connected: boolean(),
  account: union([aniListAccountDetailsSchema, nullValue()]),
});
export const aniListListEntrySchema = object({
  id: number(),
  mediaId: number(),
  status: string(),
  progress: number(),
  score: number(),
});
export const provisionedUserSchema = object({
  id: number(), username: string(), isAdmin: boolean(), passwordSet: boolean(),
});
export const mediaEntrySchema = object({
  rel: string(), name: string(), folder: string(), size: number(), direct: boolean(),
  mediaIdentity: optional(string()),
});
export const offlineMediaArtifactSchema = object({
  id: string(),
  path: string(),
  status: union([
    literal("failed"), literal("preparing"), literal("queued"), literal("ready"),
  ]),
  progress: number(),
  speed: number(),
  sourceSizeBytes: number(),
  sizeBytes: nullableNumber,
  duration: number(),
  mimeType: string(),
  mediaUrl: nullableString,
  error: nullableString,
  createdAt: number(),
  updatedAt: number(),
});
export const libraryStatusSchema = object({
  entryCount: number(), lastScannedAt: nullableNumber, scanning: boolean(),
});
export const metadataRefreshStatusSchema = object({
  state: union([literal("complete"), literal("idle"), literal("running")]),
  total: number(), completed: number(), failed: number(),
  startedAt: nullableNumber, completedAt: nullableNumber, error: nullableString,
});
export const subtitleTrackSchema = object({
  index: number(), codec: string(), language: string(), label: string(), sizeBytes: nullableNumber,
});
export const audioTrackSchema = object({
  index: number(),
  codec: string(),
  language: string(),
  label: string(),
  channels: number(),
  isDefault: boolean(),
  sizeBytes: nullableNumber,
});
export const playbackProgressSchema = object({
  rel: string(),
  position: number(),
  duration: number(),
  completed: boolean(),
  updatedAt: number(),
  dismissedAt: nullableNumber,
});
const nullablePlaybackProgressSchema = union([playbackProgressSchema, nullValue()]);
export const playbackAuditEventSchema = object({
  id: number(),
  userId: number(),
  actorUserId: nullableNumber,
  actorUsername: string(),
  rel: string(),
  action: union([
    literal("completed"), literal("playback-started"), literal("playback-stopped"),
    literal("restored"),
    literal("snapshot-imported"), literal("watched"), literal("unwatched"),
  ]),
  origin: union([
    literal("episode-menu"), literal("history"), literal("home"),
    literal("media-library"), literal("migration"), literal("player"),
    literal("season-menu"), literal("series-menu"),
  ]),
  previous: nullablePlaybackProgressSchema,
  next: nullablePlaybackProgressSchema,
  anilistMediaId: nullableNumber,
  episode: nullableNumber,
  totalEpisodes: nullableNumber,
  sessionSeconds: nullableNumber,
  revertsEventId: nullableNumber,
  createdAt: number(),
});
const mappingActivityStateSchema = object({
  kind: literal("mapping"),
  key: string(),
  provider: string(),
  mediaId: number(),
  anilistId: nullableNumber,
  title: string(),
});
const uploadActivityStateSchema = object({
  kind: literal("upload"),
  path: string(),
  size: number(),
});
const mappingMovementSchema = object({ from: string(), to: string() });
const fileOperationActivityStateSchema = object({
  kind: literal("files"),
  operationId: string(),
  operation: fileOperationKindSchema,
  entries: array(fileMovementSchema),
  mappings: array(mappingMovementSchema),
  revertsOperationId: nullableString,
});
const libraryActivityStateSchema = union([
  fileOperationActivityStateSchema,
  mappingActivityStateSchema,
  uploadActivityStateSchema,
]);
export const libraryActivityEventSchema = object({
  id: number(),
  actorUserId: number(),
  actorUsername: string(),
  action: union([
    literal("files-moved"), literal("files-renamed"), literal("files-reverted"), literal("files-trashed"),
    literal("folder-created"), literal("mapping-updated"), literal("media-uploaded"),
  ]),
  subject: string(),
  previous: union([libraryActivityStateSchema, nullValue()]),
  next: libraryActivityStateSchema,
  createdAt: number(),
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
const mediaDateSchema = object({
  year: nullableNumber,
  month: nullableNumber,
  day: nullableNumber,
});
const optionalTvmazeSchema = optional(union([tvmazeMatchSchema, nullValue()]));
export const aniListMediaSchema = object({
  provider: union([literal("anilist"), literal("jikan")]),
  id: number(),
  anilistId: nullableNumber,
  idMal: nullableNumber,
  title: aniListTitleSchema,
  description: nullableString,
  coverImage: aniListCoverSchema,
  bannerImage: nullableString,
  episodes: nullableNumber,
  duration: nullableNumber,
  season: nullableString,
  seasonYear: nullableNumber,
  startDate: union([mediaDateSchema, nullValue()]),
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
  showFolder: nullableString,
  progress: number(),
  downloadSpeed: number(),
  eta: number(),
  completed: number(),
  size: number(),
  state: string(),
  addedOn: number(),
});
export const storageStatusSchema = object({
  totalBytes: number(),
  availableBytes: number(),
});
export const transcodeJobSchema = object({
  id: string(),
  sourcePath: string(),
  preset: union([literal("space-saver"), literal("compatibility")]),
  status: union([
    literal("cancelled"),
    literal("complete"),
    literal("failed"),
    literal("processing"),
    literal("queued"),
  ]),
  inputSize: number(), outputSize: nullableNumber, error: nullableString,
  progress: number(), speed: number(), startedAt: nullableNumber,
  originalDeleted: boolean(), createdAt: number(), updatedAt: number(),
});
export const mediaScanSchema = object({
  sourcePath: string(),
  status: union([
    literal("complete"),
    literal("failed"),
    literal("queued"),
    literal("scanning"),
  ]),
  fileSize: number(),
  duration: nullableNumber,
  formatName: nullableString, videoCodec: nullableString,
  width: nullableNumber, height: nullableNumber,
  audioBytes: number(), subtitleBytes: number(), scannedAt: nullableNumber,
  error: nullableString, updatedAt: number(),
});
const trickplayPendingSchema = object({
  status: union([literal("generating"), literal("unavailable")]),
});
const trickplayReadySchema = object({
  status: literal("ready"),
  version: string(),
  interval: number({ minimum: 1 }),
  width: integer({ minimum: 1 }),
  height: integer({ minimum: 1 }),
  columns: integer({ minimum: 1 }),
  rows: integer({ minimum: 1 }),
  frameCount: integer({ minimum: 1 }),
  sheetCount: integer({ minimum: 1 }),
});
export const trickplayManifestSchema = union([trickplayReadySchema, trickplayPendingSchema]);
export const nyaaSearchResultSchema = object({
  id: string(),
  name: string(),
  category: string(),
  size: string(),
  seeders: number(),
  leechers: number(),
  downloads: number(),
  publishedAt: string(),
  trusted: boolean(),
  remake: boolean(),
  detailsUrl: string(),
  magnet: string(),
});
export const credentialsSchema = object({ username: string(), password: string() });

export const schema = {
  array,
  boolean,
  composite,
  file,
  integer,
  literal,
  nullValue,
  number,
  object,
  optional,
  record,
  string,
  union,
};
