import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { database, db, execute, queryOne, queryRows, sql, UserRowSchema, type WatchTogetherMemberRow, WatchTogetherMemberRowSchema, type WatchTogetherRow, WatchTogetherRowSchema } from "./database.ts";
import { PARTY_HOST_GRACE, PARTY_IDLE_TIMEOUT, type PartyMemberCredentials, type PartyState } from "../shared/watchTogether.ts";

export interface PartyActor extends PartyMemberCredentials {
  readonly id: string;
  readonly userId: number;
}
type Member = WatchTogetherMemberRow;
type Room = WatchTogetherRow;
const MemberIdSchema = WatchTogetherMemberRowSchema.pick({ id: true });
const UsernameSchema = UserRowSchema.pick({ username: true });
const MemberNameSchema = MemberIdSchema.extend({ username: z.string() });

function hash(token: string): string { return createHash("sha256").update(token).digest("hex"); }
function roomFor(id: string): Room | null {
  return queryOne(db.selectFrom("watch_together").selectAll().where("id", "=", id), WatchTogetherRowSchema);
}
function memberFor(actor: PartyActor): Member | null {
  return queryOne(db.selectFrom("watch_together_members").selectAll()
    .where("room_id", "=", actor.id).where("token_hash", "=", hash(actor.memberToken)), WatchTogetherMemberRowSchema);
}
function authenticatedMember(actor: PartyActor): Member | null {
  const member = memberFor(actor);
  return member !== null && member.left_at === null && member.user_id === actor.userId &&
    member.connection_id === actor.connectionId && member.incarnation === actor.incarnation ? member : null;
}
function addMember(actor: PartyActor, now: number): string {
  const id = randomUUID();
  execute(db.insertInto("watch_together_members").values({
    id, room_id: actor.id, user_id: actor.userId, token_hash: hash(actor.memberToken), connection_id: actor.connectionId,
    incarnation: actor.incarnation, joined_at: now, seen_at: now,
  }));
  return id;
}
export function createHostMembership(actor: PartyActor, now: number): void {
  const memberId = addMember(actor, now);
  execute(db.updateTable("watch_together").set({ host_member_id: memberId, active_at: now }).where("id", "=", actor.id));
}
function resumeMember(actor: PartyActor, member: Member, now: number): boolean {
  if (member.left_at !== null || member.user_id !== actor.userId || actor.incarnation < member.incarnation) { return false; }
  if (actor.incarnation === member.incarnation && actor.connectionId !== member.connection_id) { return false; }
  if (actor.incarnation > member.incarnation) {
    execute(sql`UPDATE watch_together SET generation = generation + 1 WHERE id = ${actor.id} AND host_member_id = ${member.id}`);
  }
  execute(sql`UPDATE watch_together_members SET connection_id = ${actor.connectionId}, incarnation = ${actor.incarnation}, seen_at = ${now},
    joined_at = CASE WHEN seen_at < ${now - PARTY_HOST_GRACE} THEN ${now} ELSE joined_at END WHERE id = ${member.id}`);
  return true;
}
function heldPosition(room: Room, now: number): number {
  return room.position + (room.paused === 1 ? 0 : Math.min(Math.max(now - room.updated_at, 0), 5000) / 1000 * room.rate);
}
function transferHost(room: Room, now: number): void {
  const next = queryOne(sql`SELECT id FROM watch_together_members
    WHERE room_id = ${room.id} AND left_at IS NULL AND seen_at >= ${now - PARTY_HOST_GRACE} ORDER BY joined_at, id LIMIT 1`, MemberIdSchema);
  const position = heldPosition(room, now);
  execute(sql`UPDATE watch_together SET host_member_id = ${next?.id ?? null}, generation = generation + 1,
    position = ${position}, paused = 1, updated_at = ${now} WHERE id = ${room.id}`);
}
function electHost(room: Room, now: number): void {
  const current = queryOne(db.selectFrom("watch_together_members").selectAll().where("id", "=", room.host_member_id ?? ""), WatchTogetherMemberRowSchema);
  if (current !== null && current.left_at === null && current.seen_at >= now - PARTY_HOST_GRACE) { return; }
  // Let an existing, pre-membership host finish upgrading during the grace period.
  if (room.host_member_id === null && room.generation === 1 && room.updated_at >= now - PARTY_HOST_GRACE) { return; }
  transferHost(room, now);
}
function reply(room: Room, memberId: string, now: number): PartyState {
  const host = queryOne(sql`SELECT users.username FROM users
    JOIN watch_together_members ON users.id = watch_together_members.user_id WHERE watch_together_members.id = ${room.host_member_id ?? ""}`, UsernameSchema);
  const members = queryRows(sql`SELECT m.id, users.username
    FROM watch_together_members m JOIN users ON users.id = m.user_id
    WHERE m.room_id = ${room.id} AND m.left_at IS NULL AND m.seen_at >= ${now - PARTY_HOST_GRACE} ORDER BY m.joined_at, m.id`, MemberNameSchema);
  const stale = now - room.updated_at > 5000;
  return {
    id: room.id, rel: room.rel === "" ? null : room.rel, position: stale ? heldPosition(room, now) : room.position,
    paused: room.paused === 1 || stale, rate: room.rate, updatedAt: room.updated_at, serverTime: now,
    isHost: room.host_member_id === memberId, generation: room.generation, hostName: host?.username ?? null, members: members.length,
    memberList: members.map((member) => ({ id: member.id, name: member.username, isHost: member.id === room.host_member_id, isSelf: member.id === memberId })),
  };
}

export function partyPresence(actor: PartyActor, now = Date.now()): PartyState | null {
  return database.transaction(() => {
    const room = roomFor(actor.id);
    if (room === null || now - room.active_at > PARTY_IDLE_TIMEOUT) { return null; }
    if (room.host_member_id !== null) { electHost(room, now); }
    const previous = memberFor(actor);
    if (previous !== null && !resumeMember(actor, previous, now)) { return null; }
    const memberId = previous?.id ?? addMember(actor, now);
    electHost(roomFor(actor.id) ?? room, now);
    execute(db.updateTable("watch_together").set({ active_at: now }).where("id", "=", actor.id));
    return reply(roomFor(actor.id) ?? room, memberId, now);
  })();
}

export interface PartyPlayback {
  readonly rel: string | null;
  readonly position: number;
  readonly paused: boolean;
  readonly rate: number;
  readonly generation: number;
}
export function partyPlayback(actor: PartyActor, playback: PartyPlayback, now = Date.now()): PartyState | null {
  return database.transaction(() => {
    const member = authenticatedMember(actor);
    const room = roomFor(actor.id);
    if (member === null || room === null) { return null; }
    electHost(room, now);
    const changed = execute(db.updateTable("watch_together")
      .set({ rel: playback.rel ?? "", position: playback.position, paused: Number(playback.paused), rate: playback.rate, updated_at: now, active_at: now })
      .where("id", "=", actor.id).where("host_member_id", "=", member.id).where("generation", "=", playback.generation));
    return changed === 1 ? reply(roomFor(actor.id) ?? room, member.id, now) : null;
  })();
}
export function leaveParty(actor: PartyActor, now = Date.now()): boolean {
  return database.transaction(() => {
    const member = authenticatedMember(actor);
    const room = roomFor(actor.id);
    if (member === null || room === null) { return false; }
    execute(db.updateTable("watch_together_members").set({ left_at: now }).where("id", "=", member.id));
    if (room.host_member_id === member.id) { transferHost(room, now); }
    execute(sql`DELETE FROM watch_together WHERE id = ${actor.id} AND NOT EXISTS
      (SELECT 1 FROM watch_together_members WHERE room_id = ${actor.id} AND left_at IS NULL AND seen_at >= ${now - PARTY_HOST_GRACE})`);
    return true;
  })();
}
export function endParty(actor: PartyActor, generation: number, now = Date.now()): boolean {
  return database.transaction(() => {
    const member = authenticatedMember(actor);
    const room = roomFor(actor.id);
    if (member === null || room === null) { return false; }
    electHost(room, now);
    return execute(db.deleteFrom("watch_together").where("id", "=", actor.id)
      .where("host_member_id", "=", member.id).where("generation", "=", generation)) > 0;
  })();
}

export function removePartyMember(actor: PartyActor, target: { readonly memberId: string; readonly generation: number }, now = Date.now()): boolean {
  return database.transaction(() => {
    const member = authenticatedMember(actor);
    const room = roomFor(actor.id);
    if (member === null || room === null || member.id === target.memberId) { return false; }
    electHost(room, now);
    const current = roomFor(actor.id);
    if (current?.host_member_id !== member.id || current.generation !== target.generation) { return false; }
    return execute(db.updateTable("watch_together_members").set({ left_at: now })
      .where("id", "=", target.memberId).where("room_id", "=", actor.id).where("left_at", "is", null)) === 1;
  })();
}
