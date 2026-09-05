import { schema } from "./schemas.ts";

const sessionMedia = schema.union([schema.string({ minLength: 1, maxLength: 4096 }), schema.nullValue()]);

const playback = {
  position: schema.number({ minimum: 0, maximum: 604_800 }),
  paused: schema.boolean(),
  rate: schema.number({ minimum: 0.25, maximum: 4 }),
};
export const partyMemberSchema = schema.object({
  memberToken: schema.string({ minLength: 43, maxLength: 43 }),
  connectionId: schema.string({ minLength: 36, maxLength: 36 }),
  incarnation: schema.integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
});
export const watchCreateSchema = schema.object({
  ...playback, rel: sessionMedia, member: schema.optional(partyMemberSchema),
});
export const watchUpdateSchema = schema.object({
  ...playback, rel: schema.optional(sessionMedia), hostToken: schema.string({ minLength: 43, maxLength: 43 }),
});
export const watchEndSchema = schema.object({
  hostToken: schema.string({ minLength: 43, maxLength: 43 }),
});
export const watchCreatedSchema = schema.object({ id: schema.string(), hostToken: schema.string() });
export const watchStateSchema = schema.object({
  ...playback, id: schema.string(), rel: sessionMedia,
  updatedAt: schema.number(), serverTime: schema.number(),
});

export const partyPlaybackSchema = schema.composite([partyMemberSchema, schema.object({
  ...playback, rel: sessionMedia, generation: schema.integer({ minimum: 1 }),
})]);
export const partyEndSchema = schema.composite([partyMemberSchema, schema.object({ generation: schema.integer({ minimum: 1 }) })]);
const nullableHostName = schema.union([schema.string(), schema.nullValue()]);
const listedMember = schema.object({ id: schema.string(), name: schema.string(), isHost: schema.boolean(), isSelf: schema.boolean() });
export const partyStateSchema = schema.composite([watchStateSchema, schema.object({
  isHost: schema.boolean(), generation: schema.integer(),
  hostName: nullableHostName, members: schema.integer(), memberList: schema.array(listedMember),
})]);
export const partyRemoveSchema = schema.composite([partyEndSchema, schema.object({ memberId: schema.string({ minLength: 36, maxLength: 36 }) })]);
