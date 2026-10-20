import { t } from "elysia";

const array = t.Array;
const boolean = t.Boolean;
const literal = t.Literal;
const nullValue = t.Null;
const number = t.Number;
const object = t.Object;
const string = t.String;
const union = t.Union;

const nullableString = union([string(), nullValue()]);
const nullableNumber = union([number(), nullValue()]);
const lockSourceSchema = union([
  literal("offline"), literal("recovery"), literal("symlink"), literal("torrent"),
  literal("torrent-unavailable"), literal("transcode"), literal("upload"),
]);
const lockSchema = object({
  source: lockSourceSchema,
  reason: string(),
  tone: union([literal("busy"), literal("locked")]),
});
const mediaSchema = union([literal("other"), literal("subtitle"), literal("video"), nullValue()]);

const itemSchema = object({
  id: string(),
  parentId: nullableString,
  path: string(),
  name: string(),
  kind: union([literal("file"), literal("folder")]),
  media: mediaSchema,
  size: nullableNumber,
  modifiedAt: number(),
  lock: union([lockSchema, nullValue()]),
});

export const librarySnapshotSchema = object({
  items: array(itemSchema),
  torrentOwnership: union([literal("available"), literal("unavailable"), literal("unconfigured")]),
  generatedAt: number(),
});

export const fileOperationKindSchema = union([
  literal("create-folder"), literal("move"), literal("rename"), literal("revert"), literal("trash"),
]);

export const fileMovementSchema = object({ from: nullableString, to: string() });

export const fileOperationResultSchema = object({
  operationId: string(),
  kind: fileOperationKindSchema,
  entries: array(fileMovementSchema),
  revertible: boolean(),
});

const referenceSchema = object({
  path: string({ minLength: 1, maxLength: 4096 }),
  id: string({ minLength: 1, maxLength: 64 }),
});
const nullableReferenceSchema = union([referenceSchema, nullValue()]);
const referencesSchema = array(referenceSchema, { minItems: 1, maxItems: 500 });
const nameSchema = string({ minLength: 1, maxLength: 255 });

export const createFolderBodySchema = object({ parent: nullableReferenceSchema, name: nameSchema });
export const renameBodySchema = object({ item: referenceSchema, name: nameSchema });
export const moveBodySchema = object({ items: referencesSchema, target: nullableReferenceSchema });
export const trashBodySchema = object({ items: referencesSchema });

const pathSchema = string({ minLength: 1, maxLength: 4096 });
const nullableNameSchema = union([nameSchema, nullValue()]);
export const episodeNamesBodySchema = object({
  folder: pathSchema,
  showFolder: nullableNameSchema,
  seasonFolder: nullableNameSchema,
  episodes: array(object({ rel: pathSchema, name: nameSchema }), { maxItems: 500 }),
});
export const episodeNamesResultSchema = object({ folder: string(), stoppedSeeding: boolean() });
